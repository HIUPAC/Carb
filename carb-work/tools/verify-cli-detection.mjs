import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readAsar } from './asar-files.mjs';
import { patchCliDetection } from './patch-cli-detection.mjs';

assert.equal(process.platform, 'win32', 'This suite verifies actual Windows CLI launching.');
const root = path.resolve(import.meta.dirname, '..');
const archive = await readAsar(path.resolve(root, '../repack-test/Test-0.5.11-ux-enhancements/resources/app.asar'));
const temp = await mkdtemp(path.join(os.tmpdir(), 'carb-cli-detection-'));
const checks = [];
const original = { ...process.env };
const source = archive.entries.get('node_modules/@harness/proc/dist/cli.js').toString();
const patched = patchCliDetection(source);
const check = async (name, run) => { await run(); checks.push(name); };
async function fixture(relative, contents = '') {
  const filename = path.join(temp, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
  return filename;
}
try {
  await fixture('package.json', '{"type":"module"}');
  await fixture('cli.js', patched);
  await fixture('desktop-path.js', archive.entries.get('node_modules/@harness/proc/dist/desktop-path.js'));
  await fixture('carb-cli-candidates.js', await readFile(path.join(root, 'overlay/asar/node_modules/@harness/proc/dist/carb-cli-candidates.js')));
  // Exercise the real resolver, command construction and OS process spawn.
  // Tree ownership is independent of resolution; fixtures finish on their own.
  await fixture('kill.js', "export { spawn as spawnOwned } from 'node:child_process'; export async function killTree() {} export function leaveRunning() {}\n");
  const cli = await import(pathToFileURL(path.join(temp, 'cli.js')));
  const helper = await import(pathToFileURL(path.join(temp, 'carb-cli-candidates.js')));
  const desktop = path.dirname(await fixture('OpenAI.Codex_1.0_x64__publisher/app/resources/codex.exe', 'desktop-private fixture'));
  const gui = await fixture('desktop-gui/Codex.exe', 'gui fixture');
  await fixture('desktop-gui/resources/app.asar');
  const privateExe = await fixture('desktop-gui/resources/codex.exe', 'private fixture');
  const standalone = await fixture('独立 CLI 空格/codex.cmd', '@echo off\r\necho codex-cli 9.8.7\r\nexit /b 0\r\n');
  const environment = entries => ({ ...original,
    PATH: [...entries, path.join(original.SystemRoot ?? 'C:\\Windows', 'System32')].join(path.delimiter), PATHEXT: '.ps1;.exe;.cmd;.bat;.com',
    APPDATA: path.join(temp, 'appdata'), LOCALAPPDATA: path.join(temp, 'local'),
    USERPROFILE: path.join(temp, 'home'), ProgramData: path.join(temp, 'programdata'),
  });
  const use = entries => {
    Object.assign(process.env, environment(entries));
    cli.invalidateCommandCache();
  };
  await check('Detection, version and spawning choose the standalone CLI after desktop PATH entries', async () => {
    use([desktop, path.dirname(gui), path.dirname(standalone)]);
    assert.equal(await cli.locateCommand('codex'), standalone);
    assert.equal(cli.locateCommandSync('codex'), standalone);
    assert.equal(await cli.isInstalled('codex'), true);
    assert.equal(await cli.commandVersion('codex'), 'codex-cli 9.8.7');
    const result = await cli.runCli('codex', ['--version']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /codex-cli 9\.8\.7/);
  });
  await check('Desktop-only machines have no CLI and cannot spawn the desktop by fallback', async () => {
    use([desktop, path.dirname(gui)]);
    assert.equal(await cli.locateCommand('codex'), undefined);
    assert.equal(await cli.isInstalled('codex'), false);
    assert.equal(await cli.commandVersion('codex'), undefined);
    assert.throws(() => cli.spawnCli('codex', ['--version']), /standalone CLI/);
    assert.throws(() => cli.spawnCli(gui, []), /standalone CLI/);
    assert.throws(() => cli.spawnCli(privateExe, []), /standalone CLI/);
  });
  await check('PowerShell shims cannot shadow the usable cmd shim', async () => {
    await fixture('独立 CLI 空格/codex.ps1', "throw 'must not be executed'");
    use([path.dirname(standalone)]);
    assert.equal(await cli.locateCommand('codex'), standalone);
    assert.equal(await cli.locateCommand(path.join(path.dirname(standalone), 'codex.ps1')), undefined);
  });
  await check('Broken npm shims and missing optional native packages remain unavailable', async () => {
    const shim = await fixture('npm-broken/codex.cmd', '@echo off\r\n"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
    use([path.dirname(shim)]);
    assert.equal(await cli.isInstalled('codex'), false);
    const pkg = 'npm-broken/node_modules/@openai/codex/';
    await fixture(pkg + 'bin/codex.js', '// npm entry point');
    await fixture(pkg + 'package.json', JSON.stringify({name:'@openai/codex', optionalDependencies:{ [`@openai/codex-${process.platform}-${process.arch}`]: '1.0.0' }}));
    cli.invalidateCommandCache();
    assert.equal(await cli.isInstalled('codex'), false);
    const triple = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    await fixture(pkg + `vendor/${triple}-pc-windows-msvc/codex/codex.exe`, 'native fixture');
    cli.invalidateCommandCache();
    assert.equal(await cli.locateCommand('codex'), shim);
  });
  await check('Cached candidates are revalidated when their npm target disappears', async () => {
    const script = path.join(temp, 'npm-broken/node_modules/@openai/codex/bin/codex.js');
    await rm(script);
    assert.equal(await cli.locateCommand('codex'), undefined);
    assert.equal(cli.locateCommandSync('codex'), undefined);
  });
  await check('Desktop aliases are excluded after canonical path resolution', async () => {
    const alias = path.join(temp, 'desktop-alias');
    await symlink(desktop, alias, 'junction');
    use([alias, path.dirname(standalone)]);
    assert.equal(await cli.locateCommand('codex'), standalone);
    assert.equal(helper.isCodexDesktopBinary(path.join(alias, 'codex.exe')), true);
    assert.equal(helper.isCodexDesktopBinary(path.join(temp, 'packages/app-server-daemon/current/bin/codex.exe')), true);
  });
  await check('The official standalone installation folder works without an inherited PATH', async () => {
    const exe = await fixture('local/Programs/OpenAI/Codex/bin/codex.cmd', '@echo off\r\nexit /b 0\r\n');
    use([]);
    assert.equal(await cli.locateCommand('codex'), exe);
    assert.equal(helper.isCodexDesktopBinary(exe), false);
  });
  await check('Other CLIs retain normal lookup, and cwd does not shadow PATH', async () => {
    const git = await fixture('ordinary/git.cmd', '@echo off\r\necho git-fixture\r\n');
    use([path.dirname(git)]);
    assert.equal(await cli.locateCommand('git'), git);
    assert.equal(await cli.locateCommand('uninstalled-fixture-command'), undefined);
  });
  await check('The transformer is idempotent and syntax is valid', async () => {
    assert.equal(patchCliDetection(patched), patched);
    execFileSync(process.execPath, ['--check', path.join(temp, 'cli.js')]);
    execFileSync(process.execPath, ['--check', path.join(temp, 'carb-cli-candidates.js')]);
  });
} finally {
  for (const key of Object.keys(process.env)) if (!Object.hasOwn(original, key)) delete process.env[key];
  Object.assign(process.env, original);
  assert(path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith('carb-cli-detection-'));
  await rm(temp, {recursive:true, force:true});
}
const report = { passed:true, checks };
await writeFile(path.join(root, 'verification/cli-detection.json'), JSON.stringify(report,null,2) + '\n');
console.log(JSON.stringify(report,null,2));
