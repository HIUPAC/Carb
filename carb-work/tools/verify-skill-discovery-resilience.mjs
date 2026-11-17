import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

const sandbox = await mkdtemp(path.join(os.tmpdir(), 'carb-skill-discovery-'));
const root = path.join(sandbox, 'skills');
const target = path.join(sandbox, 'target');
const transient = path.join(root, 'transient');
const inaccessible = path.join(root, 'inaccessible');
const originalStat = fs.promises.stat;
try {
  await mkdir(root); await mkdir(target); await mkdir(transient); await mkdir(inaccessible);
  const manifest = '---\nname: recovered-skill\ndescription: readable despite directory stat failure\n---\n';
  await writeFile(path.join(transient, 'SKILL.md'), manifest);
  await writeFile(path.join(target, 'SKILL.md'), '---\nname: linked-skill\ndescription: linked directory\n---\n');
  await symlink(target, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(path.join(sandbox, 'missing'), path.join(root, 'broken'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.promises.stat = async (filename, ...args) => {
    if (filename === transient || filename === inaccessible || filename === path.join(inaccessible, 'SKILL.md')) {
      const error = new Error(`UNKNOWN: simulated stat failure, stat '${filename}'`); error.code = 'UNKNOWN'; throw error;
    }
    return originalStat(filename, ...args);
  };
  syncBuiltinESMExports();
  const source = await readFile(new URL('../overlay/asar/node_modules/@harness/server/dist/skill-inventory.js', import.meta.url), 'utf8');
  const { listSkillsIn } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const result = await listSkillsIn(root, 'user');
  assert.deepEqual(result.skills.map(skill => skill.name).sort(), ['linked-skill', 'recovered-skill']);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].path, inaccessible);
  console.log('Skill discovery: readable junction, broken junction and isolated stat failures verified.');
} finally {
  fs.promises.stat = originalStat;
  syncBuiltinESMExports();
  await rm(sandbox, { recursive: true, force: true });
}
