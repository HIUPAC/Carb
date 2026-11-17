import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readAsar } from './asar-files.mjs';

assert.equal(process.platform, 'win32', 'This smoke check verifies the actual Windows CLI and desktop installations.');
const root = path.resolve(import.meta.dirname, '..');
const payload = path.resolve(process.env.CARB_INSTALL_PAYLOAD ?? path.join(root, 'Carb-5.6.11'));
const verification = path.join(root, 'verification');
const reportPath = path.join(verification, 'cli-machine.json');
await mkdir(verification, { recursive: true });
const temporary = await mkdtemp(path.join(verification, 'cli-machine-'));
const originalEnvironment = { ...process.env };
const sourceHashes = {};
const checks = [];
let archiveSha256;
let machineCLI;
let desktops;
let helper;

async function extract(archive, member, output) {
  const content = archive.entries.get(member);
  assert(content, `Final payload source missing: ${member}`);
  sourceHashes[member] = createHash('sha256').update(content).digest('hex');
  await writeFile(path.join(temporary, output), content);
}

async function check(name, action) {
  await action();
  checks.push({ name, passed: true });
}

try {
  const archive = await readAsar(path.join(payload, 'resources/app.asar'));
  archiveSha256 = archive.sha256;
  sourceHashes['tools/verify-cli-machine.mjs'] = createHash('sha256').update(await readFile(import.meta.filename)).digest('hex');
  await writeFile(path.join(temporary, 'package.json'), '{"type":"module"}\n');
  // Import the exact final payload modules with their original relative imports.
  // kill.js is production code too; no replacement resolver or fake PATH is used.
  for (const filename of ['cli.js', 'desktop-path.js', 'carb-cli-candidates.js', 'kill.js']) {
    await extract(archive, 'node_modules/@harness/proc/dist/' + filename, filename);
  }
  await extract(archive, 'node_modules/@harness/adapter-acp/dist/carb-desktop-detection.js', 'carb-desktop-detection.js');
  const cli = await import(pathToFileURL(path.join(temporary, 'cli.js')));
  const desktopPath = await import(pathToFileURL(path.join(temporary, 'desktop-path.js')));
  const candidates = await import(pathToFileURL(path.join(temporary, 'carb-cli-candidates.js')));
  const desktopDetection = await import(pathToFileURL(path.join(temporary, 'carb-desktop-detection.js')));
  await desktopPath.refreshWindowsPath();
  cli.invalidateCommandCache();
  const selected = await cli.locateCommand('codex');
  const installed = await cli.isInstalled('codex');
  machineCLI = { installed, path: selected, realPath: selected && await realpath(selected) };
  await check('actual-machine-cli-detection-and-execution-select-the-same-standalone-path', async () => {
    assert.equal(installed, true, 'The already installed standalone CLI must be detected.');
    assert(selected && path.isAbsolute(selected), 'CLI detection must select an absolute installed path.');
    assert.equal(cli.locateCommandSync('codex'), selected);
    assert.equal(candidates.isCodexCliCandidate(selected), true);
    assert.equal(candidates.isCodexDesktopBinary(selected), false, 'The selected CLI must not be the desktop executable or its private binary.');
  });
  await check('actual-machine-cli-version-read-only', async () => {
    // The only installed CLI invocation in this smoke check is --version.
    // Never run login, update, install, or any command that changes user config.
    machineCLI.version = await cli.commandVersion('codex', 10_000);
    assert.match(machineCLI.version ?? '', /\d+\.\d+/);
  });
  await check('interactive-shell-helper-preserves-the-selected-absolute-cli', async () => {
    // Generating the command has no side effects. Do not execute this string.
    const command = candidates.cliShellCommand(selected, ['--version']);
    const encoded = /-EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(command)?.[1];
    assert(encoded, 'Windows shell helper must use the tested encoded command boundary.');
    const script = Buffer.from(encoded, 'base64').toString('utf16le');
    assert(script.includes("'" + selected.replaceAll("'", "''") + "'"));
    assert(script.includes("'--version'"));
    assert(!command.includes('-NonInteractive'));
    helper = { argument: '--version', commandGeneratedOnly: true, encodedCommand: true, selectedAbsolutePathPreserved: true, interactive: true };
  });
  await check('actual-machine-codex-desktop-detected-independently', async () => {
    desktops = await desktopDetection.detectAgentDesktops();
    assert.equal(desktops.codex, true, 'The already installed Codex desktop app must be detected independently of its CLI.');
    assert.equal(candidates.isCodexDesktopBinary(selected), false);
  });
  await check('machine-process-environment-was-not-modified', async () => {
    assert.deepEqual({ ...process.env }, originalEnvironment);
  });
  const report = {
    passed: true, timestamp: new Date().toISOString(), platform: process.platform, node: process.version,
    source: 'Exact final ASAR CLI, desktop PATH, candidate helper, process ownership and desktop detection modules; actual machine environment and registry. Installed CLI executes --version only. No login, install, update or configuration changes.',
    payload, archiveSha256, sourceHashes, machineCLI, desktops, helper, cases: checks.length, checks,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, cases: checks.length, machineCLI, desktops, reportPath }, null, 2));
} catch (error) {
  await writeFile(reportPath, JSON.stringify({ passed: false, timestamp: new Date().toISOString(), payload, archiveSha256, sourceHashes, machineCLI, desktops, helper, checks, error: error.stack || String(error) }, null, 2) + '\n');
  throw error;
} finally {
  assert(path.dirname(temporary) === verification && path.basename(temporary).startsWith('cli-machine-'));
  await rm(temporary, { recursive: true, force: true });
}
