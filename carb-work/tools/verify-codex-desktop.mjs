import assert from 'node:assert/strict';
import path from 'node:path';
import { createAgentDesktopDetector } from '../overlay/asar/node_modules/@harness/adapter-acp/dist/carb-desktop-detection.js';

const windowsEnv = {
  SystemRoot: 'C:\\Windows',
  USERPROFILE: 'C:\\Users\\Desktop Test',
  LOCALAPPDATA: 'C:\\Users\\Desktop Test\\AppData\\Local',
  ProgramFiles: 'C:\\Program Files',
};
const packageRoot = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.2.3.0_x64__publisher';
const desktopRoot = 'C:\\Users\\Desktop Test\\AppData\\Local\\Programs\\OpenAI\\Codex';
const regEntry = (name, fields) => 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + name + '\n' +
  Object.entries({ DisplayName: name, ...fields }).map(([key, value]) => `    ${key}    REG_SZ    ${value}`).join('\n');

function fixture({ platform = 'win32', env = windowsEnv, files = [], directories = [], appx = [], registry = '', fails = false } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const normalize = value => platform === 'win32' ? paths.normalize(value).toLowerCase() : value;
  const existingFiles = new Set(files.map(normalize));
  const existingDirectories = new Set(directories.map(normalize));
  const calls = [];
  let time = 0;
  const detect = createAgentDesktopDetector({
    platform, env, now: () => time,
    execute: async (command, args, options) => {
      calls.push({ command, args, options });
      assert.equal(options.windowsHide, true);
      assert(paths.isAbsolute(command), 'System executables use absolute paths');
      if (fails) throw new Error('OS integration unavailable');
      if (/powershell\.exe$/i.test(command)) {
        const script = args.at(-1);
        assert(script.includes("Get-AppxPackage -Name 'OpenAI.Codex'"), 'Only the exact desktop Store package is queried');
        assert(script.includes("$_.Name -eq 'OpenAI.Codex'"), 'PrimaryRuntime is excluded from package results');
        return { stdout: JSON.stringify(appx) };
      }
      assert(/reg\.exe$/i.test(command));
      return { stdout: registry };
    },
    statFile: async filename => {
      const key = normalize(filename);
      if (existingFiles.has(key)) return { isFile: () => true };
      if (existingDirectories.has(key)) return { isFile: () => false };
      throw Object.assign(new Error('Missing fixture path'), { code: 'ENOENT' });
    },
  });
  return { detect, calls, advance: milliseconds => { time += milliseconds; } };
}

const verified = [];
async function check(name, run) {
  await run();
  verified.push(name);
}

await check('Store desktop requires its executable, not merely package registration', async () => {
  assert.equal((await fixture({ appx: packageRoot, files: [path.win32.join(packageRoot, 'app', 'Codex.exe')] }).detect()).codex, true);
  assert.equal((await fixture({ appx: [packageRoot] }).detect()).codex, false);
  assert.equal((await fixture({ appx: [packageRoot], directories: [path.win32.join(packageRoot, 'app', 'Codex.exe')] }).detect()).codex, false);
});

await check('PrimaryRuntime and cached data do not count as desktop installation', async () => {
  const runtimeRoot = packageRoot.replace('OpenAI.Codex_', 'OpenAI.CodexPrimaryRuntime.v1_');
  const instance = fixture({
    appx: [],
    files: [path.win32.join(runtimeRoot, 'dependencies', 'bin', 'codex.exe')],
    directories: [path.win32.join(windowsEnv.LOCALAPPDATA, 'OpenAI', 'Codex')],
  });
  assert.equal((await instance.detect()).codex, false);
});

await check('Independent CLI in a conventional location is not a desktop app', async () => {
  assert.equal((await fixture({ files: [path.win32.join(desktopRoot, 'Codex.exe')] }).detect()).codex, false);
  assert.equal((await fixture({ files: [path.win32.join(desktopRoot, 'Codex.exe'), path.win32.join(desktopRoot, 'resources', 'app.asar')] }).detect()).codex, true);
  assert.equal((await fixture({ files: [path.win32.join(desktopRoot, 'Codex.exe'), path.win32.join(desktopRoot, 'resources.pak'), path.win32.join(desktopRoot, 'icudtl.dat')] }).detect()).codex, true);
});

await check('Verified registry entries preserve WorkBuddy and DeepSeek detection', async () => {
  const registry = [
    regEntry('WorkBuddy', { DisplayIcon: '"D:\\Apps\\WorkBuddy\\WorkBuddy.exe",0' }),
    regEntry('DeepSeek Harness', { InstallLocation: 'D:\\Apps\\DeepSeek Harness' }),
    regEntry('Codex', { InstallLocation: 'D:\\Apps\\Codex' }),
  ].join('\n');
  const detected = await fixture({ registry, files: [
    'D:\\Apps\\WorkBuddy\\WorkBuddy.exe', 'D:\\Apps\\DeepSeek Harness\\DeepSeek Harness.exe',
    'D:\\Apps\\Codex\\Codex.exe', 'D:\\Apps\\Codex\\resources\\app.asar',
  ] }).detect();
  assert.deepEqual(detected, { workbuddy: true, 'deepseek-harness': true, codex: true });
  assert.deepEqual(await fixture({ registry }).detect(), { workbuddy: false, 'deepseek-harness': false, codex: false });
});

await check('Missing OS integrations degrade to verified file detection', async () => {
  assert.equal((await fixture({ fails: true }).detect()).codex, false);
  assert.equal((await fixture({ fails: true, files: [path.win32.join(desktopRoot, 'Codex.exe'), path.win32.join(desktopRoot, 'resources', 'app.asar')] }).detect()).codex, true);
});

await check('Concurrent and repeated refreshes share one scan, then refresh after TTL', async () => {
  const instance = fixture({ appx: packageRoot, files: [path.win32.join(packageRoot, 'app', 'Codex.exe')] });
  const results = await Promise.all(Array.from({ length: 12 }, () => instance.detect()));
  assert.equal(instance.calls.length, 4, 'One package query plus three registry queries');
  assert(results.every(result => result.codex));
  results[0].codex = false;
  assert.equal((await instance.detect()).codex, true, 'Callers cannot mutate cached state');
  instance.advance(14_999);
  await instance.detect();
  assert.equal(instance.calls.length, 4);
  instance.advance(2);
  await instance.detect();
  assert.equal(instance.calls.length, 8, 'A later refresh can observe installation or removal');
});

await check('macOS requires a complete Codex application bundle and launches no tools', async () => {
  const instance = fixture({ platform: 'darwin', env: { HOME: '/Users/desktop-test' }, files: [
    '/Applications/Codex.app/Contents/Info.plist', '/Applications/Codex.app/Contents/MacOS/Codex',
  ] });
  assert.equal((await instance.detect()).codex, true);
  assert.equal(instance.calls.length, 0);
  assert.equal((await fixture({ platform: 'darwin', env: { HOME: '/Users/desktop-test' }, files: ['/Applications/Codex.app/Contents/Info.plist'] }).detect()).codex, false);
});

await check('Linux conventional installation requires desktop resources', async () => {
  const instance = fixture({ platform: 'linux', env: { HOME: '/home/desktop-test' }, files: [
    '/opt/codex/codex', '/opt/codex/resources/app.asar',
  ] });
  assert.equal((await instance.detect()).codex, true);
  assert.equal(instance.calls.length, 0);
  assert.equal((await fixture({ platform: 'linux', env: { HOME: '/home/desktop-test' }, files: ['/opt/codex/codex'] }).detect()).codex, false);
});

console.log(JSON.stringify({ passed: true, verified }, null, 2));
