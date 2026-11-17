import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { product } from './prepare-brand.mjs';

const root = path.resolve(import.meta.dirname, '..');
const executable = path.join(root, `Carb-${product.version}`, 'Carb.exe');
const verification = path.join(root, 'verification', `app-${product.version}`);
const port = 19517;
fs.mkdirSync(verification, { recursive: true });
const env = { ...process.env,
  CARB_DESKTOP_DATA_DIR: path.join(verification, 'desktop-data'),
  CARB_DATA_DIR: path.join(verification, 'server-data'),
  HARNESS_DISABLE_GPU: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, ['--disable-gpu', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], {
  cwd: path.dirname(executable), env, detached: true,
  stdio: ['ignore', fs.openSync(path.join(verification, 'stdout.log'), 'a'), fs.openSync(path.join(verification, 'stderr.log'), 'a')],
});
child.unref();
const session = { pid: child.pid, port, executable, profile: env.CARB_DESKTOP_DATA_DIR };
fs.writeFileSync(path.join(verification, 'session.json'), JSON.stringify(session, null, 2) + '\n');
console.log(JSON.stringify(session));
