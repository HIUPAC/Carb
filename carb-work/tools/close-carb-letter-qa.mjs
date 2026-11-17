import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { product } from './prepare-brand.mjs';

const root = path.resolve(import.meta.dirname, '..');
const expectedExecutable = path.join(root, `Carb-${product.version}-LetterQA`, 'Carb.exe');
const verification = path.join(root, 'verification', `app-${product.version}-LetterQA`);
const sessionPath = path.join(verification, 'session.json');
const session = JSON.parse(await readFile(sessionPath, 'utf8'));
assert.equal(path.resolve(session.executable).toLowerCase(), expectedExecutable.toLowerCase(),
  'Refusing to send a close request to an executable outside the E2E package');
assert.equal(path.resolve(session.profile).toLowerCase(), path.join(verification, 'desktop-data').toLowerCase());
assert.equal(path.resolve(session.serverData).toLowerCase(), path.join(verification, 'server-data').toLowerCase());

const env = { ...process.env,
  CARB_DESKTOP_DATA_DIR: session.profile,
  CARB_DATA_DIR: session.serverData,
  CODEX_HOME: session.codexHome,
};
for (const key of Object.keys(env)) {
  if (key.startsWith('HARNESS_') && key !== 'HARNESS_DISABLE_GPU') delete env[key];
  if (key.startsWith('CODEX_') && key !== 'CODEX_HOME') delete env[key];
  if (/_API_KEY$/i.test(key)) delete env[key];
}
delete env.ELECTRON_RUN_AS_NODE;

await promisify(execFile)(session.executable,
  ['--carb-quit-for-uninstall', session.executable],
  { env, windowsHide: true, timeout: 20000 });

const deadline = Date.now() + 20000;
while (true) {
  try { process.kill(session.pid, 0); }
  catch (error) {
    if (error.code === 'ESRCH') break;
    throw error;
  }
  assert(Date.now() < deadline, 'The isolated E2E Carb process has not exited');
  await new Promise(resolve => setTimeout(resolve, 200));
}
console.log(`Closed isolated E2E Carb process ${session.pid}.`);

