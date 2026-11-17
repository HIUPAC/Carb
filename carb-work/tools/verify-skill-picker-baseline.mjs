import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readAsar } from './asar-files.mjs';
import { patchSkillPicker } from './patch-skill-web.mjs';

const baseline = path.resolve(process.env.CARB_BASELINE ?? 'D:/TasteCode/repack-test/Test-0.5.11-ux-enhancements');
const archivePath = path.join(baseline, 'resources/app.asar');
const archive = await readAsar(archivePath);
const patched = new Map();

for (const name of ['dist/main.js', 'dist/preload.cjs']) {
  const source = archive.entries.get(name);
  assert(source, `Baseline app.asar is missing ${name}`);
  const result = patchSkillPicker(name, source.toString('utf8'));
  assert.notEqual(result, source.toString('utf8'), `${name} was not patched`);
  assert.equal(patchSkillPicker(name, result), result, `${name} patch is not idempotent`);
  patched.set(name, result);
}

const syntaxRoot = await mkdtemp(path.join(os.tmpdir(), 'carb-skill-picker-baseline-'));
try {
  const files = [
    ['dist/main.js', 'main.mjs'],
    ['dist/preload.cjs', 'preload.cjs'],
  ];
  for (const [archiveName, outputName] of files) {
    const filename = path.join(syntaxRoot, outputName);
    await writeFile(filename, patched.get(archiveName));
    const checked = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
    assert.equal(checked.status, 0, `${archiveName} syntax check failed: ${checked.stderr || checked.stdout}`);
  }
} finally {
  await rm(syntaxRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({
  archive: archivePath,
  archiveSha256: archive.sha256,
  patchedMembers: [...patched.keys()],
  syntaxChecks: 2,
  idempotenceChecks: 2,
  result: 'passed',
}, null, 2));
