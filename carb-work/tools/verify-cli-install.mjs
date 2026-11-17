import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { readAsar } from './asar-files.mjs';
import { cliInstallNativePaths, patchCliInstall, patchInstallTerminal, terminalDimensions } from './patch-cli-install.mjs';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const baseline = path.resolve(process.env.CARB_BASELINE ?? path.join(root, '../repack-test/Test-0.5.11-ux-enhancements'));
const payload = path.resolve(process.env.CARB_INSTALL_PAYLOAD ?? path.join(root, 'Carb-0.5.17'));
const reportPath = path.join(root, 'verification/cli-install.json');
const terminalPath = cliInstallNativePaths[0];
const codexPath = cliInstallNativePaths[1];
const webPath = 'resources/web/assets/InstallTerminal-BfINFuQf.js';
const temporary = await mkdtemp(path.join(os.tmpdir(), 'carb-cli-install-'));
const checks = [];
const sourceHashes = {};
const hash = text => createHash('sha256').update(text).digest('hex');
let sequence = 0;

async function check(name, action) {
  const details = await action();
  checks.push({ name, passed: true, ...details });
}

async function moduleFromSource(source, label) {
  const filename = path.join(temporary, `${++sequence}-${label}.mjs`);
  await writeFile(filename, source);
  await run(process.execPath, ['--check', filename], { windowsHide: true });
  return import(pathToFileURL(filename));
}

async function terminalModule(source, label) {
  const before = "import { applyDesktopPath } from '@harness/proc/desktop-path';";
  assert.equal(source.split(before).length, 2);
  // PATH discovery is independent of PTY dimensions. Keep this fixture from
  // importing the real profile or resolving the native PTY module.
  return moduleFromSource(source.replace(before, 'const applyDesktopPath = () => {};'), label);
}

function terminalFixture(TerminalManager) {
  const processes = [];
  const manager = new TerminalManager({ onOutput() {}, onExit() {} }, {
    spawnPty(file, args, options) {
      const process = {
        file, args, options, pid: 100_000 + processes.length, sizes: [],
        onData() { return { dispose() {} }; },
        onExit(callback) { this.exited = callback; },
        resize(columns, rows) { this.sizes.push([columns, rows]); },
        write() {},
        kill() { this.exited({ exitCode: 0 }); },
      };
      processes.push(process);
      return process;
    },
    processes: { inspect: () => [], list: async () => [] },
  });
  return { manager, processes };
}

function fitInstallTerminal(source, { width = 640, height = 400, columns = 100, rows = 30, running = true, open = true } = {}) {
  const start = source.indexOf('x=()=>{');
  const end = source.indexOf('},S=r(b)', start);
  assert(start >= 0 && end > start, 'Expected the production install fit callback');
  const callback = source.slice(start + 2, end + 1);
  const calls = { fit: 0, resize: [], rpc: [] };
  const terminal = {
    cols: 100, rows: 30,
    resize(columns, rows) { this.cols = columns; this.rows = rows; calls.resize.push([columns, rows]); },
  };
  vm.runInNewContext(`(${callback})()`, {
    a: { clientWidth: width, clientHeight: height },
    _: { fit() { calls.fit++; terminal.cols = columns; terminal.rows = rows; } },
    h: terminal,
    n: () => ({ phase: running ? 'running' : 'exited', terminalId: 'fixture' }),
    e: { installKey: 'install:codex', transport: {
      state: open ? 'open' : 'closed',
      request(method, params) { calls.rpc.push({ method, ...params }); return Promise.resolve(); },
    } },
  });
  return calls;
}

async function installerFunction(source, label) {
  const start = source.indexOf('export function codexInstallCommand');
  const end = source.indexOf('\nexport const CODEX_UPDATES', start);
  assert(start >= 0 && end > start);
  return (await moduleFromSource(source.slice(start, end), label)).codexInstallCommand;
}

const encode = script => Buffer.from(script, 'utf16le').toString('base64');
async function powershell(script, expectedCode = 0) {
  assert.equal(process.platform, 'win32', 'PowerShell acceptance tests run on Windows.');
  let result;
  try {
    result = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)], {
      windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024, encoding: 'utf8',
    });
    result.code = 0;
  } catch (error) {
    if (!Number.isInteger(error.code)) throw error;
    result = error;
  }
  assert.equal(result.code, expectedCode, result.stdout + result.stderr);
  return result.stdout;
}

try {
  for (const name of ['tools/patch-cli-install.mjs', 'tools/verify-cli-install.mjs']) {
    sourceHashes[name] = hash(await readFile(path.join(root, name)));
  }
  const sources = [];
  for (const [label, directory] of [['baseline', baseline], ['payload', payload]]) {
    const archive = await readAsar(path.join(directory, 'resources/app.asar'));
    const terminal = archive.entries.get(terminalPath)?.toString('utf8');
    const installer = archive.entries.get(codexPath)?.toString('utf8');
    assert(terminal && installer, `Missing CLI install native sources: ${label}`);
    sources.push({ label, directory, terminal, installer, web: await readFile(path.join(directory, webPath), 'utf8') });
  }

  await check('baseline-reproduces-hidden-pane-two-column-pty', async () => {
    const { TerminalManager } = await terminalModule(sources[0].terminal, 'baseline-terminal');
    const { manager, processes } = terminalFixture(TerminalManager);
    const id = manager.run('install:codex', 'echo fixture', temporary, 100, 30);
    manager.resize(id, 2, 1);
    assert.deepEqual(processes[0].sizes, [[2, 1]]);
    await manager.closeAll();
    assert.equal(fitInstallTerminal(sources[0].web, { width: 0, height: 0, columns: 2, rows: 1 }).rpc[0].columns, 2);
    return { observed: [2, 1] };
  });

  for (const source of sources) {
    const { label } = source;
    const terminal = patchCliInstall(terminalPath, source.terminal);
    const installer = patchCliInstall(codexPath, source.installer);
    const web = patchInstallTerminal(source.web);
    await check(`${label}-transform-idempotence-and-incomplete-patch-rejection`, async () => {
      assert.equal(patchCliInstall(terminalPath, terminal), terminal);
      assert.equal(patchCliInstall(codexPath, installer), installer);
      assert.equal(patchInstallTerminal(web), web);
      assert.throws(() => patchCliInstall(terminalPath, terminal.replace('command: args.length > 0', 'command: false')), /Incomplete/);
      assert.throws(() => patchCliInstall(codexPath, installer.replace('TimeoutSec 120', 'TimeoutSec 1')), /Incomplete/);
      assert.throws(() => patchInstallTerminal(web.replace('h.resize(Math.max(40,h.cols),Math.max(10,h.rows));', '')), /anchor/);
      await writeFile(path.join(temporary, `${label}-web.mjs`), web);
      await run(process.execPath, ['--check', path.join(temporary, `${label}-web.mjs`)], { windowsHide: true });
      return { terminalSha256: hash(terminal), installerSha256: hash(installer), webSha256: hash(web) };
    });
    const { TerminalManager } = await terminalModule(terminal, `${label}-terminal`);
    await check(`${label}-command-pty-preserves-readable-dimensions`, async () => {
      const { manager, processes } = terminalFixture(TerminalManager);
      const command = manager.run('install:codex', 'echo fixture', temporary, 2, 1);
      assert.deepEqual([processes[0].options.cols, processes[0].options.rows], [40, 10]);
      manager.resize(command, 2, 1);
      manager.resize(command, 120.8, 36.4);
      manager.resize(command, Number.NaN, Number.POSITIVE_INFINITY);
      manager.resize(command, 9999, 9999);
      manager.resize(command, -4, -10);
      assert.deepEqual(processes[0].sizes, [[40, 10], [120, 36], [100, 30], [500, 200], [40, 10]]);
      assert.equal(manager.run('install:codex', 'must not start twice', temporary, 2, 1), command);
      assert.equal(processes.length, 1);
      const interactive = manager.open('interactive', temporary, 2, 1);
      assert.deepEqual([processes[1].options.cols, processes[1].options.rows], [2, 1]);
      manager.resize(interactive, 2, 1);
      assert.deepEqual(processes[1].sizes, [[2, 1]]);
      const regular = manager.run('install:other', 'echo fixture', temporary, 100, 30);
      assert.deepEqual([processes[2].options.cols, processes[2].options.rows], [100, 30]);
      manager.resize(regular, 100, 30);
      assert.deepEqual(processes[2].sizes, [[100, 30]]);
      await manager.closeAll();
      return { nativeBinding: 'Injected PTY; actual production TerminalManager spawn, resize and reattach paths.' };
    });
    await check(`${label}-hidden-install-pane-does-not-fit-or-resize`, async () => {
      for (const dimensions of [{ width: 0, height: 0 }, { width: 159, height: 400 }, { width: 640, height: 39 }]) {
        assert.deepEqual(fitInstallTerminal(web, dimensions), { fit: 0, resize: [], rpc: [] });
      }
      const tiny = fitInstallTerminal(web, { columns: 2, rows: 1 });
      assert.equal(tiny.fit, 1);
      assert.deepEqual(tiny.resize, [[40, 10]]);
      assert.deepEqual(tiny.rpc, [{ method: 'terminal.resize', terminalId: 'fixture', columns: 40, rows: 10 }]);
      const regular = fitInstallTerminal(web);
      assert.deepEqual(regular.resize, [[100, 30]]);
      assert.equal(regular.rpc[0].columns, 100);
      assert.equal(fitInstallTerminal(web, { running: false }).rpc.length, 0);
      assert.equal(fitInstallTerminal(web, { open: false }).rpc.length, 0);
    });
    await check(`${label}-official-windows-install-command-and-posix-command`, async () => {
      const before = await installerFunction(source.installer, `${label}-installer-before`);
      const after = await installerFunction(installer, `${label}-installer-after`);
      const command = after('win32');
      assert.match(command, /^powershell\.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/=]+$/);
      const script = Buffer.from(command.match(/-EncodedCommand (\S+)$/)[1], 'base64').toString('utf16le');
      assert.equal(after('darwin'), before('darwin'));
      assert.equal(after('linux'), before('linux'));
      const parser = `$fixtureSource = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encode(script)}')); $fixtureTokens = $null; $fixtureErrors = $null; [void][Management.Automation.Language.Parser]::ParseInput($fixtureSource, [ref]$fixtureTokens, [ref]$fixtureErrors); if ($fixtureErrors.Count -gt 0) { throw ($fixtureErrors | Out-String) }; Write-Host 'syntax-ok'`;
      assert.match(await powershell(parser), /syntax-ok/);
      return { command: 'powershell.exe -NoProfile -NonInteractive -EncodedCommand <verified UTF-16LE script>' };
    });
  }

  const installer = await installerFunction(patchCliInstall(codexPath, sources[0].installer), 'mock-installer');
  const script = Buffer.from(installer('win32').match(/-EncodedCommand (\S+)$/)[1], 'base64').toString('utf16le');
  const mock = body => `function Invoke-RestMethod { param([string]$Uri, [int]$TimeoutSec); if ($Uri -ne 'https://chatgpt.com/codex/install.ps1' -or $TimeoutSec -ne 120) { throw 'incorrect official source' }; ${body} }; ${script}`;
  const returnScript = source => `return [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encode(source)}'))`;
  await check('powershell-download-and-run-complete-script', async () => {
    const fixtureScript = "[CmdletBinding()] param([string]$Release = $env:CODEX_RELEASE); Set-StrictMode -Version Latest; if ($env:CODEX_NON_INTERACTIVE -ne '1') { throw 'missing noninteractive flag' }; Write-Host 'fixture-official-script-completed'";
    const stdout = await powershell(mock(returnScript(fixtureScript)));
    assert.match(stdout, /fixture-official-script-completed/);
    assert.match(stdout, /Checking installation status/);
    assert(!stdout.includes('installation failed'));
  });
  await check('powershell-installer-return-completes-the-wrapper', async () => {
    const stdout = await powershell(mock(returnScript("Write-Host 'fixture-early-return'; return; throw 'must-not-run'")));
    assert.match(stdout, /fixture-early-return/);
    assert.match(stdout, /Checking installation status/);
    assert(!stdout.includes('must-not-run'));
  });
  await check('powershell-installer-explicit-failure-exit-is-preserved', async () => {
    const stdout = await powershell(mock(returnScript("Write-Host 'fixture-platform-error'; exit 7")), 7);
    assert.match(stdout, /fixture-platform-error/);
    assert(!stdout.includes('installer finished'));
  });
  for (const [name, body, expected] of [
    ['download-failure', "throw 'fixture-download-failure'", /fixture-download-failure/],
    ['empty-download', "return ''", /empty or invalid/],
    ['non-script-download', "return @{ unexpected = 'JSON' }", /empty or invalid/],
    ['invalid-script', "return 'if ('", /installation failed/],
    ['script-failure', "return \"throw 'fixture-script-failure'\"", /fixture-script-failure/],
  ]) {
    await check(`powershell-${name}-returns-failure-with-readable-message`, async () => {
      const stdout = await powershell(mock(body), 1);
      assert.match(stdout, /Codex CLI installation failed:/);
      assert.match(stdout, expected);
      assert(!stdout.includes('installer finished'));
    });
  }
  await check('dimension-validation', async () => {
    assert.deepEqual(terminalDimensions(undefined, undefined, true), { columns: 100, rows: 30 });
    assert.deepEqual(terminalDimensions('2', '1', true), { columns: 100, rows: 30 });
  });

  const report = {
    passed: true, timestamp: new Date().toISOString(), platform: process.platform, node: process.version,
    source: 'Production baseline and payload transformers; injected PTY; production frontend fit callback; actual Windows PowerShell with mocked official downloads. No network or actual CLI installation.',
    baseline, payload, sourceHashes, cases: checks.length, checks,
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, cases: checks.length, reportPath }, null, 2));
} catch (error) {
  await writeFile(reportPath, JSON.stringify({ passed: false, timestamp: new Date().toISOString(), sourceHashes, checks, error: error.stack || String(error) }, null, 2) + '\n');
  throw error;
} finally {
  assert(path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('carb-cli-install-'));
  await rm(temporary, { recursive: true, force: true });
}
