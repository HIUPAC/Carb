import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { product } from './prepare-brand.mjs';

const root = path.resolve(import.meta.dirname, '..');
const payloadName = `Carb-${product.version}-E2E`;
const executable = path.join(root, payloadName, 'Carb.exe');
const verification = path.join(root, 'verification', `app-${product.version}-E2E`);
const desktopData = path.join(verification, 'desktop-data');
const serverData = path.join(verification, 'server-data');
// A previous isolated run may have initialized Codex's profile. Give each QA
// launch a fresh, empty home instead of deleting prior run data.
const codexHome = path.join(verification, `codex-home-${Date.now()}`);
const sessionPath = path.join(verification, 'session.json');

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

assert(isWithin(root, executable), 'E2E payload must remain inside the isolated workspace');
assert(isWithin(path.join(root, 'verification'), verification), 'E2E runtime data must remain under verification');
assert.notEqual(path.resolve('D:/Carb').toLowerCase(), path.dirname(executable).toLowerCase(), 'The formal installation must never be used for QA');
assert(fs.existsSync(executable), `Build the isolated QA payload first: ${executable}`);
if (fs.existsSync(sessionPath)) {
  const previous = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  let running = false;
  try { process.kill(previous.pid, 0); running = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
  assert(!running, `An E2E Carb process is already recorded as running: ${previous.pid}`);
  fs.renameSync(sessionPath, path.join(verification, `session-${previous.pid}-closed.json`));
}

fs.mkdirSync(verification, { recursive: true });
fs.mkdirSync(codexHome, { recursive: true });
assert.equal(fs.readdirSync(codexHome).length, 0,
  `CODEX_HOME must be empty before the isolated QA launch: ${codexHome}`);

async function freeLoopbackPort() {
  const probe = net.createServer();
  return await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const result = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(result));
    });
  });
}
const [port, serverPort] = await Promise.all([freeLoopbackPort(), freeLoopbackPort()]);
assert.notEqual(port, serverPort);

// The released build uses a fixed default port that can already belong to the
// user's installed Carb. Change only this isolated E2E copy's CSP so its
// packaged main process and renderer agree on an unused loopback port.
const webIndex = path.join(executable, '..', 'resources', 'web', 'index.html');
let indexHtml = fs.readFileSync(webIndex, 'utf8');
assert(indexHtml.includes(product.endpoint), `Expected packaged endpoint is missing from ${webIndex}`);
const endpoint = `ws://127.0.0.1:${serverPort}`;
indexHtml = indexHtml.replaceAll(product.endpoint, endpoint);
fs.writeFileSync(webIndex, indexHtml);

const env = { ...process.env,
  CARB_DESKTOP_DATA_DIR: desktopData,
  CARB_DATA_DIR: serverData,
  CARB_GLOBAL_SKILLS_DIR: path.join(serverData, 'skills'),
  CODEX_HOME: codexHome,
  HARNESS_DISABLE_GPU: '1',
};
for (const key of Object.keys(env)) {
  if (key.startsWith('HARNESS_') && key !== 'HARNESS_DISABLE_GPU') delete env[key];
  if (key.startsWith('CODEX_') && key !== 'CODEX_HOME') delete env[key];
  if (/_API_KEY$/i.test(key)) delete env[key];
}
for (const key of ['OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID']) delete env[key];
delete env.ELECTRON_RUN_AS_NODE;

const stdout = fs.openSync(path.join(verification, 'stdout.log'), 'a');
const stderr = fs.openSync(path.join(verification, 'stderr.log'), 'a');
const child = spawn(executable, [
  '--disable-gpu',
  '--remote-debugging-address=127.0.0.1',
  `--remote-debugging-port=${port}`,
], {
  cwd: path.dirname(executable),
  env,
  detached: true,
  stdio: ['ignore', stdout, stderr],
});
fs.closeSync(stdout);
fs.closeSync(stderr);
child.unref();

const session = {
  pid: child.pid,
  port,
  serverPort,
  endpoint,
  executable,
  payload: path.dirname(executable),
  profile: desktopData,
  serverData,
  codexHome,
};
fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2) + '\n');
console.log(JSON.stringify(session, null, 2));
