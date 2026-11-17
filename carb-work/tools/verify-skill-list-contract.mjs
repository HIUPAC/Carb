import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readAsar } from './asar-files.mjs';
import { patchSkillsListContract } from './patch-skill-install.mjs';

const baseline = process.env.CARB_BASELINE ?? 'D:/TasteCode/repack-test/Test-0.5.11-ux-enhancements';
const archive = await readAsar(`${baseline}/resources/app.asar`);
const contractPath = 'node_modules/@harness/contracts/dist/protocol.js';
const packagedSource = archive.entries.get(contractPath);
assert(packagedSource, `The baseline ASAR is missing ${contractPath}`);

const patchedSource = patchSkillsListContract(packagedSource.toString('utf8'));
assert.equal(patchSkillsListContract(patchedSource), patchedSource, 'Protocol patch is idempotent');
const root = path.resolve(import.meta.dirname, '..');
const contractDirectory = path.join(root, 'verification/backend-app/node_modules/@harness/contracts/dist');
const zodEntry = pathToFileURL(path.join(root, 'verification/backend-app/node_modules/zod/index.js')).href;
const importableSource = patchedSource
  .replace(/from '(\.\/[^']+)'/g, (_match, relativePath) => {
    const target = pathToFileURL(path.join(contractDirectory, relativePath.slice(2))).href;
    return `from '${target}'`;
  })
  .replaceAll("from 'zod'", `from '${zodEntry}'`);
const contractModule = await import(`data:text/javascript;base64,${Buffer.from(importableSource).toString('base64')}`);
const skillListParams = contractModule.methods['skills.list'].params;

const omittedPath = skillListParams.safeParse({ provider: 'codex' });
assert.equal(omittedPath.success, true, 'skills.list accepts an omitted projectPath');
assert.deepEqual(omittedPath.data, { provider: 'codex' });

const validPath = skillListParams.safeParse({ provider: 'codex', projectPath: 'D:/EGDown' });
assert.equal(validPath.success, true, 'skills.list accepts a non-empty project path');
assert.equal(validPath.data.projectPath, 'D:/EGDown');

assert.equal(skillListParams.safeParse({ provider: 'codex', projectPath: '' }).success, false,
  'skills.list rejects an empty project path');
assert.equal(skillListParams.safeParse({ provider: 'codex', projectPath: 123 }).success, false,
  'skills.list rejects a non-string project path');

console.log('skills.list contract: omitted path and valid path accepted; empty and non-string paths rejected');
