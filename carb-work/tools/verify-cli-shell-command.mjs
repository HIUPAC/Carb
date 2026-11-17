import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { readAsar } from './asar-files.mjs';

assert.equal(process.platform, 'win32', 'Run the real cmd.exe and PowerShell acceptance checks on Windows.');
const root = path.resolve(import.meta.dirname, '..');
const helperPath = 'node_modules/@harness/proc/dist/carb-cli-candidates.js';
const payload = process.env.CARB_CLI_SHELL_PAYLOAD && path.resolve(process.env.CARB_CLI_SHELL_PAYLOAD);
const reportPath = path.join(root, 'verification/cli-shell-command.json');
const verification = path.join(root, 'verification');
await mkdir(verification, { recursive: true });
const temporary = await mkdtemp(path.join(verification, 'cli-shell-command-'));
const commandShell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/cmd.exe');
const checks = [];
const sourceHashes = {};
let caseId = 0;

async function check(name, action) {
  const details = await action();
  checks.push({ name, passed: true, ...details });
}

async function shellCommand(command, { env = {}, input = '', expectedCode = 0 } = {}) {
  // Use the exact argv renderer shipped with node-pty, then pass its complete
  // argument tail verbatim to real cmd.exe. This is the command line that
  // TerminalManager.run gives CreateProcessW through ConPTY.
  const commandLine = argsToCommandLine(commandShell, ['/d', '/s', '/c', command]);
  const prefix = argsToCommandLine(commandShell, []) + ' ';
  assert(commandLine.startsWith(prefix));
  const args = commandLine.slice(prefix.length);
  const resultFile = path.join(temporary, `result-${++caseId}.json`);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(commandShell, [args], {
      windowsHide: true, windowsVerbatimArguments: true, cwd: temporary,
      env: {
        ...process.env, ComSpec: commandShell,
        CARB_CLI_FIXTURE_RESULT: resultFile,
        CARB_CLI_PATH_TOKEN: 'INCORRECT_EXPANDED_DIRECTORY',
        CARB_CLI_ARGUMENT_TOKEN: 'INCORRECT_EXPANDED_ARGUMENT',
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI shell fixture timed out: ' + commandLine)); }, 15_000);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, commandLine }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
  assert.equal(result.code, expectedCode, result.stdout + result.stderr);
  let received;
  try { received = JSON.parse(await readFile(resultFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...result, received };
}

let argsToCommandLine;
try {
  let source;
  if (payload) {
    const archive = await readAsar(path.join(payload, 'resources/app.asar'));
    source = archive.entries.get(helperPath)?.toString('utf8');
    assert(source, 'The target payload must contain the CLI candidate helper.');
  } else {
    source = await readFile(path.join(root, 'overlay/asar', helperPath), 'utf8');
  }
  sourceHashes[helperPath] = createHash('sha256').update(source).digest('hex');
  sourceHashes['tools/verify-cli-shell-command.mjs'] = createHash('sha256').update(await readFile(import.meta.filename)).digest('hex');
  const moduleFile = path.join(temporary, 'candidates.mjs');
  await writeFile(moduleFile, source);
  const { cliShellCommand } = await import(pathToFileURL(moduleFile));
  const ptySource = await readFile(path.join(root, 'Carb-0.5.17/resources/app.asar.unpacked/node_modules/node-pty/lib/windowsPtyAgent.js'), 'utf8');
  const renderer = ptySource.slice(ptySource.indexOf('function argsToCommandLine('), ptySource.lastIndexOf('//# sourceMappingURL='));
  assert(renderer.includes('function isCommandLine(args)'));
  argsToCommandLine = vm.runInNewContext(renderer + '\nargsToCommandLine');
  sourceHashes['node-pty/lib/windowsPtyAgent.js'] = createHash('sha256').update(ptySource).digest('hex');

  const fixtureScript = path.join(temporary, 'fixture.cjs');
  await writeFile(fixtureScript, `
const fs = require('node:fs');
const result = { args: process.argv.slice(2), executable: process.execPath, selected: process.env.CARB_SELECTED_CLI };
function finish(input) {
  if (input !== undefined) result.input = input.trimEnd();
  fs.writeFileSync(process.env.CARB_CLI_FIXTURE_RESULT, JSON.stringify(result));
  process.stdout.write('mock-cli-completed\\n');
  process.exit(Number(process.env.CARB_CLI_FIXTURE_EXIT || 0));
}
if (result.args.includes('--read-input')) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', data => { input += data; if (input.includes('\\n')) finish(input); });
  process.stdin.on('end', () => finish(input));
} else finish();
`);
  const directories = [
    ['space-and-chinese', '中文 CLI 目录'],
    ['ampersand', 'CLI & directory'],
    ['literal-percent-variable', 'CLI %CARB_CLI_PATH_TOKEN% directory'],
    ['single-quote-and-bang', "CLI 'quote' !bang! (directory)"],
  ];
  const fixtures = [];
  for (const [name, folder] of directories) {
    const directory = path.join(temporary, folder);
    await mkdir(directory);
    const cmd = path.join(directory, 'mock-codex.cmd');
    // Expanding %~dp0 is unnecessary here: keep this mock focused on the
    // launcher's own path and argument handling, not on a package manager shim.
    await writeFile(cmd, `@echo off\r\n"${process.execPath}" "${fixtureScript}" %*\r\n@exit /b %errorlevel%\r\n`);
    fixtures.push({ name, cmd, directory });
  }

  await check('baseline-double-quotes-fail-through-shipped-node-pty-renderer', async () => {
    const command = `"${fixtures[0].cmd}" "login"`;
    const commandLine = argsToCommandLine(commandShell, ['/d', '/s', '/c', command]);
    assert(commandLine.includes('\\"'));
    const result = await shellCommand(command, { expectedCode: 1 });
    assert.equal(result.received, undefined);
    return { reproduced: true };
  });
  for (const { name, cmd } of fixtures) {
    await check(`cmd-${name}-executes-the-selected-cli`, async () => {
      const args = ['login', '--fixture', 'argument with spaces', '中文参数', 'A&B', '%CARB_CLI_ARGUMENT_TOKEN%', '!bang!', '', "single'quote"];
      const command = cliShellCommand(cmd, args);
      assert.match(command, /^powershell\.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/=]+$/);
      assert(!command.includes('NonInteractive'), 'Login must retain interactive stdin.');
      const result = await shellCommand(command);
      assert(result.received, result.stdout + result.stderr);
      assert.deepEqual(result.received.args, args);
      assert.equal(result.received.selected, cmd);
      assert(!result.commandLine.includes('\\"'));
      return { selectedCli: cmd.replace(temporary, '<temporary>'), args: result.received.args };
    });
  }
  await check('cmd-update-propagates-the-cli-exit-code', async () => {
    const result = await shellCommand(cliShellCommand(fixtures[2].cmd, ['update']), { env: { CARB_CLI_FIXTURE_EXIT: '7' }, expectedCode: 7 });
    assert.deepEqual(result.received.args, ['update']);
  });
  await check('cmd-interactive-login-keeps-stdin-connected', async () => {
    const result = await shellCommand(cliShellCommand(fixtures[0].cmd, ['login', '--read-input']), { input: 'fixture interactive response\r\n' });
    assert.equal(result.received.input, 'fixture interactive response');
  });
  const native = path.join(fixtures[2].directory, 'mock-codex.exe');
  try { await link(process.execPath, native); }
  catch { await copyFile(process.execPath, native); }
  await check('native-exe-with-special-path-and-arguments', async () => {
    const args = [fixtureScript, 'login', 'argument with spaces', '中文参数', 'A&B', '%CARB_CLI_ARGUMENT_TOKEN%', '!bang!', '', "single'quote"];
    const result = await shellCommand(cliShellCommand(native, args));
    assert.deepEqual(result.received.args, args.slice(1));
    assert.equal(result.received.executable.toLowerCase(), native.toLowerCase());
  });
  await check('native-exe-propagates-the-cli-exit-code', async () => {
    const result = await shellCommand(cliShellCommand(native, [fixtureScript, 'update']), { env: { CARB_CLI_FIXTURE_EXIT: '13' }, expectedCode: 13 });
    assert.deepEqual(result.received.args, ['update']);
  });
  await check('native-exe-interactive-login-keeps-stdin-connected', async () => {
    const result = await shellCommand(cliShellCommand(native, [fixtureScript, 'login', '--read-input']), { input: 'fixture native response\r\n' });
    assert.equal(result.received.input, 'fixture native response');
  });
  await check('missing-selected-executable-reports-failure', async () => {
    const result = await shellCommand(cliShellCommand(path.join(temporary, 'missing-codex.exe'), ['login']), { expectedCode: 1 });
    assert.match(result.stdout, /Codex CLI could not start:/);
    assert.equal(result.received, undefined);
  });
  await check('unsupported-windows-control-characters-are-rejected', async () => {
    for (const invalid of ['bad\npath', 'bad\rpath', 'bad\0path', 'bad"path']) {
      assert.throws(() => cliShellCommand(invalid, ['login']), /Invalid Windows CLI argument/);
      assert.throws(() => cliShellCommand(fixtures[0].cmd, [invalid]), /Invalid Windows CLI argument/);
    }
    assert.equal(cliShellCommand('/a path/codex', ['login', "single'quote"], 'linux'), "'/a path/codex' 'login' 'single'\\''quote'");
  });
  const report = {
    passed: true, timestamp: new Date().toISOString(), platform: process.platform, node: process.version,
    source: 'Exact shipped node-pty Win32 argv renderer and real Windows cmd.exe/PowerShell. Only temporary mock CLIs execute; no real login, update or network.',
    payload: payload ?? 'overlay helper', sourceHashes, cases: checks.length, checks,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, cases: checks.length, reportPath }, null, 2));
} catch (error) {
  await writeFile(reportPath, JSON.stringify({ passed: false, timestamp: new Date().toISOString(), sourceHashes, checks, error: error.stack || String(error) }, null, 2) + '\n');
  throw error;
} finally {
  assert(path.dirname(temporary) === verification && path.basename(temporary).startsWith('cli-shell-command-'));
  await rm(temporary, { recursive: true, force: true });
}
