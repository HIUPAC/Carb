import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchSkillOrchestrator } from './patch-skill-install.mjs';
const lane = path.resolve(import.meta.dirname, '..');
const dist = path.join(lane, 'overlay/asar/node_modules/@harness/server/dist');
const { resolveSkillSource } = await import(pathToFileURL(path.join(dist, 'carb-skill-source.js')));
const { installLocalSkill } = await import(pathToFileURL(path.join(lane, 'verification/backend-app/node_modules/@harness/server/dist/skill-install.js')));
const root = await mkdtemp(path.join(os.tmpdir(), 'carb-skill-test-'));
const realFetch = globalThis.fetch; let networkCalls = 0, assertions = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('Remote installation must remain disabled.'); };
try {
 for (const input of ['https://github.com/user/repo', 'https://github.com/user/repo/tree/main/skills/example', 'https://github.com/user/repo/tree/' + 'a'.repeat(40) + '/skills/example', 'http://example.com/skill.zip', 'https://codeload.github.com/a/b/zip/main', 'https://skills.volces.com/v1/skills/download/example', 'find-skills', 'user/skill', 'github:user/repo', 'git@github.com:user/repo.git', 'file:///C:/skill.zip', '//server/share/skill.zip', '\\\\server\\share\\skill.zip']) { await assert.rejects(() => resolveSkillSource(input), /本地/); assertions++; }
 const source=path.join(root,'my-skill'), project=path.join(root,'project');
 await mkdir(source); await mkdir(project); await writeFile(path.join(source,'SKILL.md'), '---\nname: my-skill\ndescription: test\n---\n');
 const resolved = await resolveSkillSource(source);
 try {
   assert.equal(resolved.sourceType, 'folder'); assertions++;
   const dest = await installLocalSkill(project, resolved.folderPath);
   assert.match(await readFile(path.join(dest,'SKILL.md'),'utf8'), /my-skill/); assertions++;
 } finally { await resolved.cleanup(); }
 await assert.rejects(() => installLocalSkill(project,source), /already exists/); assertions++;
 const link = path.join(root, 'linked-skill'); await symlink(source, link, process.platform === 'win32' ? 'junction' : 'dir');
 await assert.rejects(() => resolveSkillSource(link), /本地/); assertions++;
 await writeFile(path.join(root,'invalid.txt'),'not a ZIP'); await assert.rejects(() => resolveSkillSource(path.join(root,'invalid.txt')), /格式不支持/); assertions++;
 await assert.rejects(() => resolveSkillSource(path.join(root,'missing.zip')), /不存在/); assertions++;
 const orchestration = patchSkillOrchestrator(await readFile(path.join(dist,'orchestrator.js'),'utf8'));
 assert.match(orchestration,/return installSingleGlobalSkill\(folderPath\);/); assertions++;
 assert.match(await readFile(path.join(dist, 'carb-skill-install.js'), 'utf8'),/export async function installSingleGlobalSkill/); assertions++;
 const implementation = await readFile(path.join(dist, 'carb-skill-source.js'), 'utf8');
 assert(!/\b(?:fetch|resolveGithub|resolveCatalogueSkill|parseSkillSource)\s*\(/u.test(implementation)); assertions++;
 assert.equal(networkCalls, 0); assertions++;
 const report = { passed: true, assertions, networkCalls, verified: ['real local folder snapshot and install', 'duplicate rejection', 'missing path and unsupported file rejection', 'symlink rejection', 'remote links and catalogue names rejected', 'no remote resolver or download implementation', 'legacy endpoint uses local resolver'] };
 await writeFile(path.join(lane, 'verification/skill-source.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { globalThis.fetch = realFetch; await rm(root,{recursive:true,force:true}); }
