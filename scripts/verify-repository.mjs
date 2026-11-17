import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoot = path.join(root, 'app');
const manifest = JSON.parse(await readFile(path.join(appRoot, 'snapshot-manifest.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(manifest.version, '5.6.12');
assert.match(manifest.sourceAsar.sha256, /^[a-f0-9]{64}$/);
assert.equal(manifest.files.length, manifest.fileCount);
let totalBytes = 0;
const members = new Set();
for (const record of manifest.files) {
  assert(!path.isAbsolute(record.path) && !record.path.includes('\\'));
  const full = path.resolve(appRoot, record.path);
  assert(full.startsWith(appRoot + path.sep), 'Snapshot path escapes app/');
  assert(!members.has(record.path), 'Duplicate snapshot member: ' + record.path);
  members.add(record.path);
  const bytes = await readFile(full);
  assert.equal(bytes.length, record.bytes, 'Snapshot length changed: ' + record.path);
  assert.equal(sha256(bytes), record.sha256, 'Snapshot hash changed: ' + record.path);
  totalBytes += bytes.length;
}
assert.equal(totalBytes, manifest.totalBytes);
assert(!members.has('asar/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'));

const release = JSON.parse(await readFile(path.join(root, 'release/windows-x64.json'), 'utf8'));
assert.equal(release.version, manifest.version);
for (const kind of ['installer', 'portable']) {
  const asset = release[kind];
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.equal(asset.url, `https://github.com/HIUPAC/Carb/releases/download/v${release.version}/${asset.filename}`);
  assert(asset.bytes > 0);
  const sidecar = await readFile(path.join(root, 'release', asset.filename + '.sha256'), 'utf8');
  assert.equal(sidecar.trim(), asset.sha256 + '  ' + asset.filename);
}
const payload = JSON.parse(await readFile(path.join(root, 'release/Carb-Setup-5.6.12-win-x64.manifest.json'), 'utf8'));
assert.equal(payload.version, release.version);
assert.equal(payload.sha256, release.installer.sha256);
assert.equal(payload.files.length, release.portable.files);
assert.equal(payload.files.reduce((sum, file) => sum + file.bytes, 0), payload.payloadBytes);

const documents = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md',
  'app/README.md', 'carb-work/README.md', 'docs/BUILD.md',
  'docs/LICENSING.md', 'THIRD_PARTY_NOTICES.md'];
let localLinks = 0;
for (const filename of documents) {
  const full = path.join(root, filename);
  const text = await readFile(full, 'utf8');
  assert(!text.includes('\uFFFD'), 'Invalid Unicode in ' + filename);
  assert.equal((text.match(/^```/gm) ?? []).length % 2, 0, 'Unbalanced code fences: ' + filename);
  for (const match of text.matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    await stat(path.resolve(path.dirname(full), decodeURIComponent(target.split('#')[0])));
    localLinks++;
  }
}
assert((await readFile(path.join(root, 'LICENSE'), 'utf8')).includes('Apache License'));
assert((await readFile(path.join(root, 'NOTICE'), 'utf8')).includes('TasteCode'));
const overlay = await readdir(path.join(root, 'carb-work/overlay/asar/node_modules/@harness/server/dist'));
assert(overlay.includes('carb-skill-source.js'), 'Maintained overlay code is missing');
console.log(JSON.stringify({passed: true, version: release.version,
  snapshotFiles: members.size, snapshotBytes: totalBytes, localLinks,
  releaseAssets: ['installer', 'portable'],
  scope: 'Repository integrity only; no model calls, application launch or installer execution.'}, null, 2));
