import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, readdir, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { patchSkillServer, patchSkillOrchestrator, patchSkillLocalInstaller } from './patch-skill-install.mjs';

const lane = path.resolve(import.meta.dirname, '..');
const sourceDist = path.join(lane, 'overlay/asar/node_modules/@harness/server/dist');
const baselineDist = path.join(lane, 'verification/backend-app/node_modules/@harness/server/dist');
const root = await mkdtemp(path.join(os.tmpdir(), 'carb-skill-verification-'));
const globalSkills = path.join(root, 'CarbData', 'skills');
process.env.CARB_GLOBAL_SKILLS_DIR = globalSkills;
const testDist = path.join(root, 'node_modules/@harness/server/dist');
await mkdir(testDist, { recursive: true });
for (const name of ['carb-skill-source.js', 'carb-skill-install.js', 'carb-skill-ownership.js', 'carb-global-skills.js', 'carb-skill-runtime.js']) await cp(path.join(sourceDist, name), path.join(testDist, name));
// Seed the same in-memory record shape an older installer used, without
// exposing a production mutation endpoint or allowing it to install.
const testInstall = path.join(testDist, 'carb-skill-install.js');
await writeFile(testInstall, (await readFile(testInstall, 'utf8')) + '\nexport function rewritePreviewOriginForTest(id, sourceType) { previews.get(id).sourceType = sourceType; }\n');
await writeFile(path.join(testDist, 'skill-install.js'), patchSkillLocalInstaller(await readFile(path.join(baselineDist, 'skill-install.js'), 'utf8')));
for (const name of ['js-yaml', 'zod']) await cp(path.join(lane, 'verification/backend-app/node_modules', name), path.join(root, 'node_modules', name), { recursive: true });
await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
const { inspectSkillZip, resolveSkillSource } = await import(pathToFileURL(path.join(testDist, 'carb-skill-source.js')));
const { previewSkillInstall, commitSkillInstall, discardSkillInstall, resolveSingleSkillSource, rewritePreviewOriginForTest } = await import(pathToFileURL(path.join(testDist, 'carb-skill-install.js')));
const { registerInstalledSkill, removeInstalledSkill } = await import(pathToFileURL(path.join(testDist, 'carb-skill-ownership.js')));
const { installLocalSkill } = await import(pathToFileURL(path.join(testDist, 'skill-install.js')));
const { createSkillRuntime } = await import(pathToFileURL(path.join(testDist, 'carb-skill-runtime.js')));
const { globalSkillCatalog, listGlobalSkills, parseSkillFrontmatter } = await import(pathToFileURL(path.join(testDist, 'carb-global-skills.js')));
const { SkillSchema } = await import(pathToFileURL(path.join(lane, 'verification/backend-app/node_modules/@harness/contracts/dist/protocol.js')));

function crc32(bytes) { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; }
function zip(files, deflate = true) {
  const locals = [], central = []; let offset = 0;
  for (const entry of files) {
    const name = Buffer.from(entry.name), content = Buffer.from(entry.content ?? ''), compressed = deflate ? deflateRawSync(content) : content, method = deflate ? 8 : 0;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(method, 8); header.writeUInt32LE(crc32(content), 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(content.length, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x314, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(method, 10); directory.writeUInt32LE(crc32(content), 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(content.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38); directory.writeUInt32LE(offset, 42);
    locals.push(header, name, compressed); central.push(directory, name); offset += header.length + name.length + compressed.length;
  }
  const table = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(table.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, table, end]);
}
const markdown = name => `---\nname: ${name}\ndescription: A useful ${name} skill\n---\n# ${name}\nUse the tool and deliver an artifact.\n`;
const project = path.join(root, 'project'), workspaceBPath = path.join(root, 'workspace-b'); await mkdir(project); await mkdir(workspaceBPath);
const orchestrator = {
  async listSkills() { return { capabilities: { install: true }, skills: [], errors: [] }; },
  async installSkillFromFolder(provider, projectPath, input) {
    const source = await resolveSingleSkillSource(input), name = path.basename(source.folderPath); let destination;
    try { destination = await installLocalSkill(projectPath, source.folderPath); }
    finally { await source.cleanup(); }
    return { id: destination, name, description: '', source: { type: 'folder', path: destination }, dependencyErrors: [] };
  },
};
const params = { provider: 'codex' };
let assertions = 0;
const realFetch = globalThis.fetch; let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('Skill installation must not use the network.'); };
try {
  for (const input of ['https://example.com/a/b', 'https://github.com/user/repo', 'http://github.com/a/b', 'https://github.com/a/b/tree/main/%2e%2e/x', 'https://github.com/a/b/tree/main/%2fx', 'https://github.com/a/b?token=secret', 'https://codeload.github.com/a/b/zip/main', 'https://skills.volces.com/v1/skills/download/example', 'find-skills', 'user/skill-name', 'github:user/repo', 'git@github.com:user/repo.git', 'file:///C:/skill.zip', '\\\\server\\share\\skill.zip', '//server/share/skill.zip']) {
    await assert.rejects(() => resolveSkillSource(input), /本地/);
    await assert.rejects(() => previewSkillInstall(orchestrator, { ...params, source: input }), /本地/);
    await assert.rejects(() => resolveSingleSkillSource(input), /本地/); assertions += 3;
  }
  for (const name of ['../outside', 'C:/outside', 'bad\\file', '/absolute', 'dir/con.txt', 'dir/file.']) { assert.throws(() => inspectSkillZip(zip([{ name, content: 'bad' }]))); assertions++; }
  assert.throws(() => inspectSkillZip(zip([{ name: 'link', content: 'target', mode: 0o120777 }]))); assertions++;
  assert.throws(() => inspectSkillZip(zip([{ name: 'File.md' }, { name: 'file.md' }]))); assertions++;
  assert.throws(() => inspectSkillZip(zip([{ name: 'a' }, { name: 'a/b' }]))); assertions++;
  const corrupt = zip([{ name: 'SKILL.md', content: markdown('corrupt') }], false); corrupt[38] ^= 1; assert.throws(() => inspectSkillZip(corrupt), /校验/); assertions++;
  const bomb = zip([{ name: 'bomb/SKILL.md', content: markdown('bomb') }]); const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); bomb.writeUInt32LE(17 * 1024 * 1024, central + 24); assert.throws(() => inspectSkillZip(bomb), /限制/); assertions++;
  const overflowSkill = zip([{ name: 'overflow/SKILL.md', content: markdown('overflow') }, ...Array.from({ length: 5 }, (_, index) => ({ name: `overflow/data-${index}.bin`, content: Buffer.alloc(14 * 1024 * 1024, index) }))]);
  assert.throws(() => inspectSkillZip(overflowSkill), /限制/); assertions++;
  const noSkill = path.join(root, 'empty.zip'); await writeFile(noSkill, zip([{ name: 'README.md', content: 'No skill' }])); await assert.rejects(() => previewSkillInstall(orchestrator, { ...params, source: noSkill }), /SKILL.md/); assertions++;
  const flat = path.join(root, 'flat.zip'); await writeFile(flat, zip([{ name: 'SKILL.md', content: markdown('flat-skill') }]));
  const flatSource = await resolveSingleSkillSource(flat); try { assert.equal(path.basename(flatSource.folderPath), 'flat-skill'); assertions++; } finally { await flatSource.cleanup(); }
  const caseVariant = path.join(root, 'case-variant.zip'); await writeFile(caseVariant, zip([{ name: 'case-variant/skill.md', content: markdown('case-variant') }]));
  const caseVariantSource = await resolveSingleSkillSource(caseVariant);
  try { assert.equal(path.basename(caseVariantSource.folderPath), 'case-variant'); assert.match(await readFile(path.join(caseVariantSource.folderPath, 'SKILL.md'), 'utf8'), /name: case-variant/); assertions += 2; }
  finally { await caseVariantSource.cleanup(); }
  const legacyPreview = await previewSkillInstall(orchestrator, { ...params, source: flat });
  for (const sourceType of ['github', 'catalogue', undefined]) {
    rewritePreviewOriginForTest(legacyPreview.previewId, sourceType);
    await assert.rejects(() => commitSkillInstall(orchestrator, { ...params, previewId: legacyPreview.previewId, skillIds: [legacyPreview.skills[0].id] }), /不是本地/); assertions++;
  }
  assert.deepEqual(await readdir(project), []); assertions++;
  await discardSkillInstall({ previewId: legacyPreview.previewId });
  const archive = path.join(root, 'collection.zip');
  await writeFile(archive, zip([{ name: 'repo/skills/alpha/SKILL.md', content: markdown('alpha') }, { name: 'repo/skills/alpha/scripts/run.py', content: 'print("alpha")' }, { name: 'repo/skills/beta/SKILL.md', content: markdown('beta') }]));
  const preview = await previewSkillInstall(orchestrator, { ...params, source: archive });
  assert.equal(preview.sourceType, 'zip'); assert.equal(preview.skills.length, 2); assert.equal(preview.skills[0].files, 2); assertions += 3;
  assert.deepEqual(await readdir(project), []); assertions++;
  const installed = await commitSkillInstall(orchestrator, { ...params, previewId: preview.previewId, skillIds: preview.skills.map(skill => skill.id) });
  assert.equal(installed.installed.length, 2); assert.match(await readFile(path.join(globalSkills, 'alpha/scripts/run.py'), 'utf8'), /alpha/); assertions += 2;
  assert.equal(preview.destination, globalSkills); assertions++;
  const alphaInventory = await listGlobalSkills();
  const alphaRecord = alphaInventory.skills.find(skill => skill.name === 'alpha');
  assert(alphaRecord); assert.equal(alphaRecord.scope, 'user'); assert.equal(SkillSchema.safeParse(alphaRecord).success, true); assertions += 3;
  assert.match(globalSkillCatalog(), /alpha: A useful alpha skill/); assertions++;
  const workspaceA = createSkillRuntime(project, { globalSkillsRoot: globalSkills });
  const workspaceB = createSkillRuntime(workspaceBPath, { globalSkillsRoot: globalSkills });
  for (const runtime of [workspaceA, workspaceB]) {
    const item = (await runtime.list({ query: 'alpha' })).skills.find(skill => skill.id === 'global:alpha');
    assert(item); assert.match((await runtime.read({ skill_id: item.id })).content, /name: alpha/); assertions += 2;
  }
  assert.deepEqual(await commitSkillInstall(orchestrator, { ...params, previewId: preview.previewId, skillIds: preview.skills.map(skill => skill.id) }), installed); assertions++;
  const frontmatterRoot = path.join(root, 'frontmatter-skills'); await mkdir(frontmatterRoot);
  const frontmatterCases = [
    ['folded', 'description: >\n  Folded description\n  second line\n\n  Second paragraph', 'Folded description second line\nSecond paragraph\n'],
    ['literal', 'description: |\n  Literal first line\n  Literal second line', 'Literal first line\nLiteral second line\n'],
    ['folded-strip', 'description: >-\n  Folded strip first\n  Folded strip second', 'Folded strip first Folded strip second'],
    ['literal-keep', 'description: |+\n  Literal keep first\n  Literal keep second\n\n', 'Literal keep first\nLiteral keep second\n\n'],
  ];
  for (const [name, field, expected] of frontmatterCases) {
    const folderPath = path.join(frontmatterRoot, name); await mkdir(folderPath);
    const skillText = `---\nname: ${name}\n${field}\n---\n# ${name}\n`;
    await writeFile(path.join(folderPath, 'SKILL.md'), skillText);
    assert.equal(parseSkillFrontmatter(skillText).description, expected); assertions++;
  }
  const previousSkillsRoot = process.env.CARB_GLOBAL_SKILLS_DIR;
  process.env.CARB_GLOBAL_SKILLS_DIR = frontmatterRoot;
  try {
    const uiFrontmatter = await listGlobalSkills();
    assert.equal(uiFrontmatter.errors.length, 0); assertions++;
    for (const [name, _field, expected] of frontmatterCases) {
      assert.equal(uiFrontmatter.skills.find(skill => skill.name === name)?.description, expected); assertions++;
    }
    const frontmatterRuntime = createSkillRuntime(undefined, { globalSkillsRoot: frontmatterRoot });
    const runtimeFolded = await frontmatterRuntime.list({ query: 'second paragraph' });
    assert.equal(runtimeFolded.total, 1); assert.equal(runtimeFolded.skills[0].id, 'global:folded'); assertions += 2;
    assert.equal((await frontmatterRuntime.list({ query: 'literal keep second' })).skills[0].id, 'global:literal-keep'); assertions++;
    const catalog = globalSkillCatalog();
    assert.match(catalog, /- folded: Folded description second line Second paragraph/);
    assert(!catalog.includes('Second line\nSecond paragraph')); assertions += 2;
  } finally {
    if (previousSkillsRoot === undefined) delete process.env.CARB_GLOBAL_SKILLS_DIR;
    else process.env.CARB_GLOBAL_SKILLS_DIR = previousSkillsRoot;
  }
  const duplicate = await previewSkillInstall(orchestrator, { ...params, source: archive }); assert(duplicate.skills.every(skill => skill.alreadyExists && skill.blockedReason)); assertions++;
  await assert.rejects(() => commitSkillInstall(orchestrator, { ...params, previewId: duplicate.previewId, skillIds: duplicate.skills.map(skill => skill.id) }), /冲突/); assertions++;
  await discardSkillInstall({ previewId: duplicate.previewId });
  const manyEntriesZip = path.join(root, 'many-entry-skill.zip');
  const manyEntryBytes = zip([
    { name: 'repo/skills/ppt-master/SKILL.md', content: markdown('many-entry-skill') },
    ...Array.from({ length: 2100 }, (_, index) => ({ name: `repo/skills/ppt-master/assets/${index}.txt`, content: `asset-${index}` })),
    { name: 'repo/docs/oversized.bin', content: randomBytes(17 * 1024 * 1024) },
  ], false);
  await writeFile(manyEntriesZip, manyEntryBytes);
  const manyEntryPreview = await previewSkillInstall(orchestrator, { ...params, source: manyEntriesZip });
  assert.equal(manyEntryPreview.skills.length, 1); assert.equal(manyEntryPreview.skills[0].name, 'many-entry-skill'); assert.equal(manyEntryPreview.skills[0].files, 2101); assert(manyEntryPreview.skills[0].bytes < 100_000); assertions += 4;
  const manyEntryInstall = await commitSkillInstall(orchestrator, { ...params, previewId: manyEntryPreview.previewId, skillIds: [manyEntryPreview.skills[0].id] });
  assert.equal(manyEntryInstall.installed.length, 1); assert.equal((await readdir(path.join(globalSkills, 'many-entry-skill/assets'))).length, 2100); assert.equal(await readFile(path.join(globalSkills, 'many-entry-skill/docs/oversized.bin')).then(() => true, error => error.code === 'ENOENT'), true); assertions += 3;
  const manyEntryRuntime = createSkillRuntime(project, { globalSkillsRoot: globalSkills });
  const manyEntrySkill = (await manyEntryRuntime.list({ query: 'many-entry-skill' })).skills.find(skill => skill.id === 'global:many-entry-skill');
  assert(manyEntrySkill); assert.match((await manyEntryRuntime.read({ skill_id: manyEntrySkill.id })).content, /name: many-entry-skill/); assertions += 2;
  const folder = path.join(root, 'gamma'); await mkdir(folder); await writeFile(path.join(folder, 'SKILL.md'), markdown('gamma'));
  const snapshot = await previewSkillInstall(orchestrator, { ...params, source: folder }); await writeFile(path.join(folder, 'SKILL.md'), 'modified malicious content');
  await commitSkillInstall(orchestrator, { ...params, previewId: snapshot.previewId, skillIds: [snapshot.skills[0].id] }); assert.match(await readFile(path.join(globalSkills, 'gamma/SKILL.md'), 'utf8'), /name: gamma/); assertions++;
  const projectTwo = path.join(root, 'project-two'); await mkdir(projectTwo);
  const rollbackArchive = path.join(root, 'rollback.zip'); await writeFile(rollbackArchive, zip([{ name: 'rollback/alpha/SKILL.md', content: markdown('rollback-alpha') }, { name: 'rollback/beta/SKILL.md', content: markdown('rollback-beta') }]));
  const rollback = await previewSkillInstall(orchestrator, { ...params, projectPath: projectTwo, source: rollbackArchive });
  const crossWorkspace = await commitSkillInstall(orchestrator, { ...params, projectPath: project, previewId: rollback.previewId, skillIds: [rollback.skills[0].id] });
  assert.equal(crossWorkspace.installed.length, 1); assert.equal(await readFile(path.join(globalSkills, 'rollback-alpha/SKILL.md'), 'utf8'), markdown('rollback-alpha')); assertions += 2;
  await assert.rejects(() => commitSkillInstall(orchestrator, { ...params, provider: 'claude', previewId: rollback.previewId, skillIds: [rollback.skills[1].id] }), /代理已更改/); assertions++;
  await discardSkillInstall({ previewId: rollback.previewId });
  const concurrentFolder = path.join(root, 'concurrent-skill'); await mkdir(concurrentFolder); await writeFile(path.join(concurrentFolder, 'SKILL.md'), markdown('concurrent-skill'));
  const concurrent = await previewSkillInstall(orchestrator, { ...params, source: concurrentFolder }); let installCalls = 0;
  const delayed = { ...orchestrator, async installSkillFromFolder(...args) { installCalls++; await new Promise(resolve => setTimeout(resolve, 20)); return orchestrator.installSkillFromFolder(...args); } };
  const both = await Promise.allSettled([commitSkillInstall(delayed, { ...params, previewId: concurrent.previewId, skillIds: [concurrent.skills[0].id] }), commitSkillInstall(delayed, { ...params, previewId: concurrent.previewId, skillIds: [concurrent.skills[0].id] })]);
  assert.equal(installCalls, 0); assert.equal(both.filter(result => result.status === 'fulfilled').length, 1); assert.equal(both.filter(result => result.status === 'rejected').length, 1); assertions += 3;
  const server = await readFile(path.join(baselineDist, 'server.js'), 'utf8'), orchestratorSource = await readFile(path.join(sourceDist, 'orchestrator.js'), 'utf8');
  assert.equal(patchSkillServer(patchSkillServer(server)), patchSkillServer(server)); assert.equal(patchSkillOrchestrator(patchSkillOrchestrator(orchestratorSource)), patchSkillOrchestrator(orchestratorSource)); assertions += 2;
  const installer = await readFile(path.join(baselineDist, 'skill-install.js'), 'utf8'); assert.equal(patchSkillLocalInstaller(patchSkillLocalInstaller(installer)), patchSkillLocalInstaller(installer)); assertions++;
  const owned = path.join(root, 'owned'); await mkdir(owned); await registerInstalledSkill(owned); await rename(owned, owned + '-old'); await mkdir(owned); await writeFile(path.join(owned, 'user-file'), 'keep');
  await assert.rejects(() => removeInstalledSkill(owned), /已被替换/); assert.equal(await readFile(path.join(owned, 'user-file'), 'utf8'), 'keep'); assertions += 2;
  assert.equal(networkCalls, 0); assertions++;
  const largeZip = path.join(root, 'large-over-32mb.zip');
  const largeBytes = zip([{ name: 'large/SKILL.md', content: markdown('large-skill') }, ...[0, 1, 2].map(index => ({ name: `large/data-${index}.bin`, content: randomBytes(11 * 1024 * 1024) }))], false);
  assert(largeBytes.length > 32 * 1024 * 1024); await writeFile(largeZip, largeBytes); const largeSource = await resolveSkillSource(largeZip); assert.equal(largeSource.sourceType, 'zip'); await largeSource.cleanup(); assertions += 2;
  const report = { passed: true, assertions, verified: ['local ZIP import with nested/multiple skills', 'local folder import', 'snapshot before install', 'no preview project writes', 'global install without project path', 'global destination shared across workspaces', 'duplicate protection', 'idempotent retry', 'local ZIP larger than 32 MB accepted', 'ZIP with over 2,000 skill entries imports only SKILL.md subtree and ignores oversized unrelated assets', 'global runtime lists and reads a high-entry-count installed skill', 'selected skill expanded-content and single-file limits', 'remote URL, catalogue name and network-share rejection on preview and legacy routes', 'legacy remote or untyped preview commits rejected', 'path traversal and symlink rejection', 'ZIP CRC and expanded-content safety limits', 'preserve concurrently replaced folder', 'patch integration'], networkCalls, network: 'Network requests are forbidden by a throwing fetch guard; no requests were attempted.' };
  await writeFile(path.join(lane, 'verification/skill-install.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { globalThis.fetch = realFetch; await rm(root, { recursive: true, force: true }); }
