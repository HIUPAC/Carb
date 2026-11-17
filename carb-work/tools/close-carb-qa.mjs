import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { product } from './prepare-brand.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = path.resolve(import.meta.dirname, '..');
const session = JSON.parse(await readFile(path.join(root, 'verification', `app-${product.version}`, 'session.json'), 'utf8'));
const endpoint = `http://127.0.0.1:${session.port}`;
const targets = await (await fetch(endpoint + '/json/list')).json();
assert.equal(session.executable, path.join(root, `Carb-${product.version}`, 'Carb.exe'));
assert(targets.filter(target => target.type === 'page').every(target => target.url === new URL('file:///' + path.join(root, `Carb-${product.version}`, 'resources/web/index.html').replaceAll('\\', '/')).href), 'QA target identity mismatch');
assert.equal(session.profile, path.join(root, 'verification', `app-${product.version}`, 'desktop-data'));
const env = { ...process.env, CARB_DESKTOP_DATA_DIR: session.profile, CARB_DATA_DIR: path.join(root, 'verification', `app-${product.version}`, 'server-data') };
delete env.ELECTRON_RUN_AS_NODE;
// This built-in request only asks the matching running instance to quit.
await promisify(execFile)(session.executable, ['--carb-quit-for-uninstall', session.executable], { env, windowsHide: true, timeout: 20000 });
const deadline = Date.now() + 20000;
while (true) {
  try { process.kill(session.pid, 0); }
  catch (error) { if (error.code === 'ESRCH') break; throw error; }
  assert(Date.now() < deadline, 'The isolated QA process has not exited');
  await new Promise(resolve => setTimeout(resolve, 200));
}
console.log('Closed the isolated Carb QA application.');
