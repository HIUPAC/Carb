import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const overlay = path.resolve('carb-work/overlay');
const mainPath = path.join(overlay, 'asar/dist/main.js');
const preloadPath = path.join(overlay, 'asar/dist/preload.cjs');
const menuPath = path.join(overlay, 'resources/web/assets/carb-task-interactions.js');
const main = await fs.readFile(mainPath, 'utf8');
const preload = await fs.readFile(preloadPath, 'utf8');
const menu = await fs.readFile(menuPath, 'utf8');

const start = main.indexOf('// Carb task links: only an explicit renderer click reaches these handlers.');
const end = main.indexOf('ipcMain.handle("harness:revealProjectFile"', start);
assert(start >= 0 && end > start, 'task-link main IPC handlers are present');
const handlersSource = main.slice(start, end).replaceAll(
  'await (await import("node:fs/promises")).stat(target)',
  'await fsPromises.stat(target)'
);

for (const [method, channel] of [
  ['openProjectFile', 'carb:openProjectFile'],
  ['openProjectFolder', 'carb:openProjectFolder'],
  ['openTaskExternal', 'carb:openTaskExternal'],
  ['revealProjectFile', 'harness:revealProjectFile']
]) {
  assert(preload.includes(`${method}:`), `preload exposes ${method}`);
  assert(preload.includes(`invoke("${channel}"`), `${method} dispatches ${channel}`);
}
assert(menu.includes('bridge.openProjectFile(value, projectPath)'), 'open-file menu action reaches preload');
assert(menu.includes('bridge.openProjectFolder(value, projectPath)'), 'open-folder menu action reaches preload');
assert(menu.includes('bridge.revealProjectFile(value, projectPath)'), 'reveal menu action reaches preload');
assert(menu.includes('bridge.openTaskExternal(value)'), 'external-link menu action reaches preload');

const pathHelper = menu.slice(menu.indexOf('function absoluteProjectFile('), menu.indexOf('const scriptFile ='));
const resolveFile = new vm.Script(pathHelper + '\nabsoluteProjectFile;').runInNewContext();
assert.equal(resolveFile('docs/report.docx', 'D:\\Project'), 'D:/Project/docs/report.docx');
assert.equal(resolveFile('docs/../报告.md', 'D:/Project/'), 'D:/Project/报告.md');
assert.equal(resolveFile('d:\\project\\报告.md', 'D:/Project'), 'D:/project/报告.md');
assert.equal(resolveFile('/project/docs/report.pdf', '/project'), '/project/docs/report.pdf');
assert.equal(resolveFile('docs/report.pdf', '/'), '/docs/report.pdf');
for (const invalid of ['../outside.txt', 'D:/Project-other/outside.txt', 'E:/outside.txt', '//server/share/file.txt', 'file:///D:/Project/file.txt', 'https://example.com/file.txt', 'D:relative.txt', 'docs/../../outside.txt', 'docs/invalid\n.txt']) {
  assert.equal(resolveFile(invalid, 'D:/Project'), undefined, 'copy and delivery reject ' + JSON.stringify(invalid));
}
assert.equal(resolveFile('/Project/file.txt', '/project'), undefined, 'POSIX paths remain case-sensitive');
assert.equal(resolveFile('file.txt', 'relative/project'), undefined, 'project root must be absolute');

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'carb-task-ipc-'));
try {
  const project = path.join(tempRoot, 'project');
  const folder = path.join(project, 'docs');
  await fs.mkdir(folder, { recursive: true });
  const document = path.join(folder, 'notes.txt');
  const script = path.join(folder, 'run.js');
  const pythonScript = path.join(folder, 'task.py');
  await fs.writeFile(document, 'notes');
  await fs.writeFile(script, '');
  await fs.writeFile(pythonScript, '');

  const calls = [];
  const ipcMain = { handlers: new Map(), handle(channel, handler) { this.handlers.set(channel, handler); } };
  const renderer = {};
  const context = {
    ipcMain,
    path11: path,
    fsPromises: fs,
    URL,
    requireOwnRenderer(sender) { if (sender !== renderer) throw new Error('Not allowed from this renderer'); },
    async projectFilePath(value, projectRoot) {
      const root = path.resolve(projectRoot);
      const candidate = path.resolve(value);
      const relative = path.relative(root, candidate);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('File path is outside the selected project');
      return candidate;
    },
    shell2: {
      async openPath(value) { calls.push(['openPath', value]); return ''; },
      async openExternal(value) { calls.push(['openExternal', value]); },
      showItemInFolder(value) { calls.push(['showItemInFolder', value]); }
    }
  };
  const scriptVm = new vm.Script(handlersSource);
  await scriptVm.runInNewContext(context);
  const invoke = (channel, ...args) => ipcMain.handlers.get(channel)({ sender: renderer }, ...args);

  await invoke('carb:openProjectFile', document, project);
  assert.deepEqual(calls.pop(), ['openPath', document]);
  await invoke('carb:openProjectFolder', document, project);
  assert.deepEqual(calls.pop(), ['openPath', folder]);
  await invoke('carb:openProjectFolder', folder, project);
  assert.deepEqual(calls.pop(), ['openPath', folder]);
  await assert.rejects(invoke('carb:openProjectFile', script, project), /program and script files/);
  await assert.rejects(invoke('carb:openProjectFile', pythonScript, project), /program and script files/);
  await assert.rejects(invoke('carb:openProjectFile', path.join(tempRoot, 'outside.txt'), project), /outside the selected project/);
  await invoke('carb:openTaskExternal', 'https://example.com/docs');
  assert.deepEqual(calls.pop(), ['openExternal', 'https://example.com/docs']);
  await assert.rejects(invoke('carb:openTaskExternal', 'javascript:alert(1)'), /Unsupported link/);
  await assert.rejects(invoke('carb:openTaskExternal', 'https://user:pass@example.com/'), /Unsupported link/);
  await assert.rejects(ipcMain.handlers.get('carb:openProjectFile')({ sender: {} }, document, project), /Not allowed from this renderer/);
  console.log('Task-link preload routing and native IPC handlers passed.');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
