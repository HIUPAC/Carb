import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { patchSkillPicker } from './patch-skill-web.mjs';

const overlay = new URL('../overlay/asar/', import.meta.url);
const mainSource = await readFile(new URL('dist/main.js', overlay), 'utf8');
const preloadSource = await readFile(new URL('dist/preload.cjs', overlay), 'utf8');
const main = patchSkillPicker('dist/main.js', mainSource);
const preload = patchSkillPicker('dist/preload.cjs', preloadSource);

const syntaxRoot = await mkdtemp(path.join(os.tmpdir(), 'carb-skill-browser-syntax-'));
try {
  const patchedMain = path.join(syntaxRoot, 'main.mjs');
  const patchedPreload = path.join(syntaxRoot, 'preload.cjs');
  await Promise.all([writeFile(patchedMain, main), writeFile(patchedPreload, preload)]);
  const { spawnSync } = await import('node:child_process');
  for (const filename of [patchedMain, patchedPreload]) {
    const checked = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
    assert.equal(checked.status, 0, `${path.basename(filename)} syntax check failed: ${checked.stderr || checked.stdout}`);
  }
} finally {
  await rm(syntaxRoot, { recursive: true, force: true });
}

assert(main.includes('ipcMain.handle("carb:openSkillBrowser"'), 'The browser window is exposed through main-process IPC');
assert(main.includes('https://findskill.com/'), 'The embedded browser opens the Skill discovery page');
assert(main.includes('let __carbSkillBrowserDownloadHandler;'), 'The browser download listener has session-owned state');
assert.equal(main.split('__carbSkillBrowserSession.on("will-download",__carbSkillBrowserDownloadHandler)').length, 2, 'The persistent session registers one stable download handler');
assert(main.includes('let activeBrowser=__carbSkillBrowserWindow'), 'The download handler resolves the current browser on every event');
assert(!main.includes('__carbSkillBrowserSession.on("will-download",(downloadEvent,item,contents)'), 'A browser-specific stale download closure is not retained');
assert(main.includes('downloadedAsZip=filename.toLowerCase().endsWith(".zip")'), 'Non-ZIP browser downloads are rejected');
assert(main.includes('__carbSkillBrowserArchives.add(destination)'), 'Completed archives are tracked before sending to the owning window');
assert(main.includes('isOwnRenderer(owner.webContents)'), 'Download notifications stay scoped to an owned Crab renderer');
assert(main.includes('removeListener("will-download",__carbSkillBrowserDownloadHandler)'), 'The session listener is removed during application shutdown');
assert(main.includes('ipcMain.handle("carb:discardSkillArchive"'), 'Temporary archive cleanup is restricted to tracked paths');
assert(preload.includes('onSkillArchiveDownloaded:listener=>'), 'The preload exposes a subscription API for downloaded archives');
assert(preload.includes('discardSkillArchive:filePath=>'), 'The preload exposes controlled temporary archive cleanup');
assert.equal(patchSkillPicker('dist/main.js', main), main, 'The main-process patch is idempotent');
assert.equal(patchSkillPicker('dist/preload.cjs', preload), preload, 'The preload patch is idempotent');

const installSource = await readFile(new URL('../overlay/asar/node_modules/@harness/server/dist/carb-skill-source.js', import.meta.url), 'utf8');
assert(installSource.includes('ZIP 文件校验失败'), 'The ZIP preview validates archive contents instead of trusting the file extension');

console.log(JSON.stringify({ checks: 18, passed: 18, browserListenerRegistrations: 1, syntax: ['main.mjs', 'preload.cjs'], result: 'passed' }, null, 2));
