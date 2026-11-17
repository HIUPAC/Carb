import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchTaskNativeFile } from './patch-task-interactions.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourcePath = path.join(workspace, 'repack-test/verification/onboarding-motion-0.5.11/backend-app/node_modules/@harness/server/dist/api-runtime.js');
const source = await fs.readFile(sourcePath, 'utf8');
const relativePath = 'node_modules/@harness/server/dist/api-runtime.js';
const patched = patchTaskNativeFile(relativePath, source);
assert.notEqual(patched, source, 'API runtime patch applies to the baseline');
assert.equal(patchTaskNativeFile(relativePath, patched), patched, 'API runtime patch is idempotent');
for (const marker of ['request_user_input', 'pendingUserInputs', 'async requestUserInput(turnId,', 'user_input.requested', 'user_input.resolved']) {
  assert(patched.includes(marker), `patched API runtime includes ${marker}`);
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'carb-api-runtime-'));
try {
  const relativeFile = path.join('node_modules', '@harness', 'server', 'dist', 'api-runtime.js');
  const checkedFile = path.join(tempRoot, relativeFile);
  await fs.mkdir(path.dirname(checkedFile), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ type: 'module' }));
  await fs.writeFile(checkedFile, patched);
  execFileSync(process.execPath, ['--check', checkedFile], { cwd: tempRoot, stdio: 'pipe' });
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('API runtime user-input transform passes baseline, idempotence, and syntax checks.');
