import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { patchCliDetection, patchCliUpdatePath } from './patch-cli-detection.mjs';

const lane = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixturesRoot = path.join(lane, 'verification', 'cli-update-path');
await mkdir(fixturesRoot, { recursive: true });
const temporary = await mkdtemp(path.join(fixturesRoot, 'run-'));
const originalPath = process.env.PATH;
const verified = [];
async function check(name, run) {
  await run();
  verified.push(name);
}
try {
  const originalUpdates = await readFile(path.join(lane, 'verification/install-detection-sources/proc__dist__updates.js'), 'utf8');
  const originalCli = await readFile(path.join(lane, 'verification/install-detection-sources/proc__dist__cli.js'), 'utf8');
  const updates = patchCliUpdatePath(originalUpdates);
  assert.equal(patchCliUpdatePath(updates), updates, 'The update path patch is idempotent');
  await writeFile(path.join(temporary, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(path.join(temporary, 'updates.js'), updates);
  await writeFile(path.join(temporary, 'cli.js'), patchCliDetection(originalCli));
  await writeFile(path.join(temporary, 'carb-cli-candidates.js'), await readFile(path.join(lane, 'overlay/asar/node_modules/@harness/proc/dist/carb-cli-candidates.js')));
  // Keep PATH deterministic while exercising the actual patched resolver and
  // its desktop candidate filter. No fixture executable may ever be started.
  await writeFile(path.join(temporary, 'desktop-path.js'), `
export function desktopPath(current = process.env.PATH) { return current ?? ''; }
export function applyDesktopPath(env) { return env.PATH ?? ''; }
`);
  await writeFile(path.join(temporary, 'kill.js'), `
export function killTree() { throw new Error('Unexpected process cleanup'); }
export function leaveRunning() { throw new Error('Unexpected process ownership'); }
export function spawnOwned() { throw new Error('Path detection must not start executables'); }
`);
  const { cliPath } = await import(pathToFileURL(path.join(temporary, 'updates.js')));
  const { locateCommand, invalidateCommandCache } = await import(pathToFileURL(path.join(temporary, 'cli.js')));
  const desktopBin = path.join(temporary, 'OpenAI.Codex_1.2.3.0_x64__publisher', 'app', 'resources');
  const standaloneBin = path.join(temporary, 'independent-cli');
  await mkdir(desktopBin, { recursive: true });
  await mkdir(standaloneBin);
  const codexName = process.platform === 'win32' ? 'codex.cmd' : 'codex';
  const desktopCodex = path.join(desktopBin, process.platform === 'win32' ? 'codex.exe' : 'codex');
  const standaloneCodex = path.join(standaloneBin, codexName);
  const ordinaryName = process.platform === 'win32' ? 'git.exe' : 'git';
  await writeFile(desktopCodex, 'desktop-private executable fixture', { mode: 0o755 });
  await writeFile(standaloneCodex, process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(path.join(desktopBin, ordinaryName), 'ordinary executable fixture', { mode: 0o755 });
  await writeFile(path.join(standaloneBin, ordinaryName), 'second ordinary executable fixture', { mode: 0o755 });

  await check('Update resolution skips a desktop CLI earlier on PATH', async () => {
    process.env.PATH = [desktopBin, standaloneBin].join(path.delimiter);
    assert.equal(await realpath(await locateCommand('codex')), await realpath(standaloneCodex));
    assert.equal(await cliPath('codex'), await realpath(standaloneCodex));
  });
  await check('A desktop-only PATH supplies no independent CLI update target', async () => {
    process.env.PATH = desktopBin;
    assert.equal(await cliPath('codex'), undefined);
    assert.equal(await cliPath(desktopCodex), undefined);
  });
  await check('Ordinary commands retain normal PATH order and missing commands stay missing', async () => {
    process.env.PATH = [desktopBin, standaloneBin].join(path.delimiter);
    assert.equal(await cliPath('git'), await realpath(path.join(desktopBin, ordinaryName)));
    assert.equal(await cliPath('missing-update-command'), undefined);
  });
  await check('The selected independent CLI path is canonicalized', async () => {
    const linkedBin = path.join(temporary, 'linked-cli');
    await symlink(standaloneBin, linkedBin, process.platform === 'win32' ? 'junction' : 'dir');
    process.env.PATH = linkedBin;
    invalidateCommandCache();
    assert.equal(await cliPath('codex'), await realpath(standaloneCodex));
  });
  await check('Patched update code passes the JavaScript syntax check', async () => {
    const syntax = spawnSync(process.execPath, ['--check', path.join(temporary, 'updates.js')], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
  });
} finally {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  const resolved = path.resolve(temporary);
  assert(resolved.startsWith(path.resolve(fixturesRoot) + path.sep), 'Cleanup stays within the verification fixture directory');
  await rm(resolved, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: true, verified }, null, 2));
