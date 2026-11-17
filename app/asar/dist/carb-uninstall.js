import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { acquireDataLease } from '../node_modules/@harness/server/dist/data-lease.js';
import { DatabaseSync } from '../node_modules/@harness/server/dist/sqlite.js';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const connectionReference = /^model-connection-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;

export function samePath(first, second) {
  if (typeof first !== 'string' || !path.isAbsolute(first)) return false;
  const resolved = path.normalize(first);
  return process.platform === 'win32'
    ? resolved.toLowerCase() === second.toLowerCase()
    : resolved === second;
}

export async function launchUninstaller(executable, resourcesPath) {
  let command, args;
  if (process.platform === 'win32') {
    const install = path.dirname(executable);
    const name = readFileSync(path.join(install, 'uninstall-target.txt'), 'utf8').trim();
    if (!/^unins\d{3,}\.exe$/iu.test(name)) throw new Error('Invalid uninstaller path.');
    command = path.join(install, name);
    args = ['/SILENT', `/CARBWAITPID=${process.pid}`];
  } else {
    command = '/bin/sh';
    const helper = path.join(resourcesPath, 'uninstall-carb.sh');
    if (!lstatSync(helper).isFile()) throw new Error('Missing uninstall script.');
    args = [helper, '--from-app', String(process.pid), path.resolve(resourcesPath, '../..')];
  }
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: os.homedir(), detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function pathInfo(target) {
  try {
    const info = lstatSync(target);
    if (info.isSymbolicLink()) throw new Error(`Uninstall path is a link: ${target}`);
    return info;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function hasColumns(database, table, columns) {
  const names = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
  return columns.every(column => names.has(column));
}

function uninstallRecords(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const setting = hasColumns(database, 'app_settings', ['key', 'value'])
      ? database.prepare("SELECT value FROM app_settings WHERE key = 'model-connections'").get()
      : undefined;
    const connections = setting ? JSON.parse(setting.value).connections : [];
    if (!Array.isArray(connections)) throw new Error('Invalid saved model connections.');
    const worktrees = hasColumns(database, 'threads', ['project_path', 'worktree_path'])
      ? database.prepare('SELECT DISTINCT project_path, worktree_path FROM threads WHERE worktree_path IS NOT NULL').all()
      : [];
    return { references: connections.map(value => value?.credentialRef).filter(ref => typeof ref === 'string' && connectionReference.test(ref)), worktrees };
  } finally {
    database.close();
  }
}

async function removeWorktree(root, row) {
  const { project_path: project, worktree_path: worktree } = row;
  if (typeof worktree !== 'string' || !path.isAbsolute(worktree)
      || !samePath(path.dirname(worktree), root) || !/^[a-z0-9-]{1,12}$/iu.test(path.basename(worktree))
      || typeof project !== 'string' || !path.isAbsolute(project) || !pathInfo(project)?.isDirectory()) return;
  pathInfo(worktree);
  const options = { cwd: project, windowsHide: true, timeout: 15000 };
  const { stdout } = await run('git', ['worktree', 'list', '--porcelain', '-z'], options);
  const registered = stdout.split('\0').some(field => field.startsWith('worktree ') && samePath(path.normalize(field.slice(9)), worktree));
  if (registered) await run('git', ['worktree', 'remove', '--force', '--', worktree], options);
}

export async function removeExternalData(profile) {
  if (!pathInfo(profile)?.isDirectory()) return;
  const worktreeRoot = path.join(profile, 'trees');
  pathInfo(worktreeRoot);
  for (const file of ['carb.db', 'harness.db']) {
    const database = path.join(profile, file);
    if (!pathInfo(database)?.isFile()) continue;
    for (const suffix of ['.owner.sqlite', '-wal', '-shm']) pathInfo(database + suffix);
    const release = acquireDataLease(database);
    try {
      const { references, worktrees } = uninstallRecords(database);
      for (const row of worktrees) await removeWorktree(worktreeRoot, row);
      const { Entry } = require('@napi-rs/keyring');
      const phoneId = createHash('sha256').update(database).digest('hex').slice(0, 12);
      for (const reference of new Set([...references, `phone-link.server-key.${phoneId}`])) {
        new Entry('Carb', reference).deletePassword();
      }
    } finally {
      release();
    }
  }
}
