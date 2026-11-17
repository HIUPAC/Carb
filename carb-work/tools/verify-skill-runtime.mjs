import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, symlink, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { patchSkillRuntime } from './patch-skill-runtime.mjs';
import { patchTaskNativeFile } from './patch-task-interactions.mjs';
import { patchToolRounds } from './patch-tool-rounds.mjs';
import { patchAttachmentApi } from './patch-attachment-backend.mjs';
import { patchArtifactWorkflow } from './patch-artifact-workflow.mjs';

const lane = path.resolve(import.meta.dirname, '..');
const root = await mkdtemp(path.join(os.tmpdir(), 'carb-skill-runtime-test-'));
const project = path.join(root, 'project'), bundled = path.join(root, 'bundled'), global = path.join(root, 'global-skills'), freshWorkspace = path.join(root, 'fresh-workspace');
process.env.CARB_GLOBAL_SKILLS_DIR = global;
await mkdir(project); await mkdir(bundled); await mkdir(global); await mkdir(freshWorkspace);
await mkdir(path.join(root, 'node_modules'), { recursive: true });
await cp(path.join(lane, 'verification/backend-app/node_modules/js-yaml'), path.join(root, 'node_modules/js-yaml'), { recursive: true });
const testDist = path.join(root, 'node_modules/@harness/server/dist'); await mkdir(testDist, { recursive: true });
for (const name of ['carb-skill-runtime.js', 'carb-global-skills.js']) await cp(path.join(lane, 'overlay/asar/node_modules/@harness/server/dist', name), path.join(testDist, name));
const { createSkillRuntime, skillRuntimeInstructions } = await import(pathToFileURL(path.join(testDist, 'carb-skill-runtime.js')));
const { parseSkillFrontmatter, setGlobalSkillEnabled, listGlobalSkills, globalSkillCatalog } = await import(pathToFileURL(path.join(testDist, 'carb-global-skills.js')));
const markdown = (name, text = '# Steps\nRead inputs, produce the output and verify it.\n') => `---\nname: ${name}\ndescription: A useful ${name} workflow.\n---\n${text}`;
let assertions = 0;
try {
  const alpha = path.join(project, '.agents/skills/alpha'); await mkdir(path.join(alpha, 'references'), { recursive: true });
  await writeFile(path.join(alpha, 'SKILL.md'), markdown('alpha')); await writeFile(path.join(alpha, 'references/guide.md'), 'Reference content');
  const beta = path.join(bundled, 'skills/beta'); await mkdir(beta, { recursive: true }); await writeFile(path.join(beta, 'SKILL.md'), markdown('beta'));
  const globalSkill = path.join(global, 'task-skill'); await mkdir(globalSkill); await writeFile(path.join(globalSkill, 'SKILL.md'), markdown('task-skill'));
  const outside = path.join(root, 'outside.md'); await writeFile(outside, 'EXTERNAL SECRET');
  const runtime = createSkillRuntime(project, { defaultSkillsRoot: bundled, globalSkillsRoot: global });
  const found = await runtime.list(); assert.deepEqual(found.skills.map(skill => skill.id), ['project:alpha', 'bundled:beta', 'global:task-skill']); assertions++;
  assert.equal((await runtime.list({ query: 'useful alpha' })).total, 1); assertions++;
  const page = await runtime.list({ limit: 1 }); assert.equal(page.skills[0].id, 'project:alpha'); assert.equal(page.next_offset, 1); assert.equal((await runtime.list({ limit: 1, offset: 1 })).skills[0].id, 'bundled:beta'); assertions += 3;
  const read = await runtime.read({ skill_id: 'project:alpha' }); assert.match(read.content, /name: alpha/); assert.match(read.sha256, /^[a-f0-9]{64}$/); assert.equal(runtime.usedSkills().length, 1); assertions += 3;
  assert.equal((await runtime.read({ skill_id: 'project:alpha', path: 'references/guide.md' })).content, 'Reference content'); assertions++;
  assert.equal((await runtime.read({ skill_id: 'bundled:beta' })).scope, 'bundled'); assertions++;
  const newWorkspaceRuntime = createSkillRuntime(freshWorkspace, { globalSkillsRoot: global });
  assert.equal((await newWorkspaceRuntime.list({ query: 'task-skill' })).skills[0].id, 'global:task-skill'); assert.match((await newWorkspaceRuntime.read({ skill_id: 'global:task-skill' })).content, /name: task-skill/); assertions += 2;
  const noWorkspaceRuntime = createSkillRuntime(undefined, { defaultSkillsRoot: bundled, globalSkillsRoot: global });
  const noWorkspaceInventory = await noWorkspaceRuntime.list();
  assert.deepEqual(noWorkspaceInventory.skills.map(skill => skill.id), ['bundled:beta', 'global:task-skill']); assertions++;
  assert.equal((await noWorkspaceRuntime.read({ skill_id: 'global:task-skill' })).scope, 'global');
  assert.equal((await noWorkspaceRuntime.read({ skill_id: 'bundled:beta' })).scope, 'bundled');
  assert.equal(noWorkspaceRuntime.usedSkills().length, 2); assertions += 3;
  assert.equal((await createSkillRuntime(null, { globalSkillsRoot: global }).list()).skills[0].id, 'global:task-skill'); assertions++;
  setGlobalSkillEnabled('task-skill', false, global);
  assert.equal((await listGlobalSkills()).skills.find(skill => skill.id === path.join(globalSkill, 'SKILL.md')).enabled, false);
  assert.equal((await noWorkspaceRuntime.list({ query: 'task-skill' })).total, 0);
  await assert.rejects(() => noWorkspaceRuntime.read({ skill_id: 'global:task-skill' }), /unavailable/);
  assert.doesNotMatch(globalSkillCatalog(), /task-skill/);
  setGlobalSkillEnabled('task-skill', true, global);
  assert.equal((await listGlobalSkills()).skills.find(skill => skill.id === path.join(globalSkill, 'SKILL.md')).enabled, true);
  assert.equal((await noWorkspaceRuntime.list({ query: 'task-skill' })).total, 1);
  assert.throws(() => setGlobalSkillEnabled('../outside', false, global), /Invalid/); assertions += 7;
  const frontmatterFormats = [
    ['folded', 'description: >\n  Folded first\n  Folded second\n\n  Folded paragraph', 'Folded first Folded second\nFolded paragraph\n'],
    ['literal', 'description: |\n  Literal first\n  Literal second', 'Literal first\nLiteral second\n'],
    ['folded-strip', 'description: >-\n  Strip first\n  Strip second', 'Strip first Strip second'],
    ['literal-keep', 'description: |+\n  Keep first\n  Keep second\n\n', 'Keep first\nKeep second\n\n'],
  ];
  for (const [name, field, expected] of frontmatterFormats) {
    const skill = path.join(global, name); await mkdir(skill);
    const source = `---\nname: ${name}\n${field}\n---\n# ${name}\n`;
    await writeFile(path.join(skill, 'SKILL.md'), source);
    assert.equal(parseSkillFrontmatter(source).description, expected); assertions++;
  }
  const parsedGlobalRuntime = createSkillRuntime(undefined, { globalSkillsRoot: global });
  const foldedMatch = await parsedGlobalRuntime.list({ query: 'Folded paragraph' });
  assert.equal(foldedMatch.total, 1); assert.equal(foldedMatch.skills[0].id, 'global:folded'); assertions += 2;
  assert.equal((await parsedGlobalRuntime.list({ query: 'Literal second' })).skills[0].id, 'global:literal'); assertions++;
  assert.equal((await parsedGlobalRuntime.list({ query: 'Keep second' })).skills[0].id, 'global:literal-keep'); assertions++;
  assert.equal((await parsedGlobalRuntime.list({ query: 'Literal second' })).skills[0].description, 'Literal first Literal second '); assertions++;
  assert.match((await parsedGlobalRuntime.read({ skill_id: 'global:literal' })).content, /  Literal first\n  Literal second\n/); assertions++;
  assert.throws(() => createSkillRuntime('relative-workspace', { globalSkillsRoot: global }), /absolute workspace path/); assertions++;
  for (const value of ['../outside.md', outside, 'references/../../outside.md', 'C:/Windows/win.ini', 'references\\guide.md', 'NUL']) { await assert.rejects(() => runtime.read({ skill_id: 'project:alpha', path: value })); assertions++; }
  await assert.rejects(() => runtime.read({ skill_id: outside }), /unavailable/); assertions++;
  await assert.rejects(() => runtime.list({ limit: 100 })); assertions++;
  const abort = new AbortController(); abort.abort(); await assert.rejects(() => runtime.list({}, abort.signal)); assertions++;
  await link(outside, path.join(alpha, 'hardlink.txt')); await assert.rejects(() => runtime.read({ skill_id: 'project:alpha', path: 'hardlink.txt' }), /without links/); assertions++;
  const external = path.join(root, 'external-skill'); await mkdir(external); await writeFile(path.join(external, 'SKILL.md'), markdown('secret-skill', 'EXTERNAL SECRET'));
  await symlink(external, path.join(project, '.agents/skills/linked-skill'), process.platform === 'win32' ? 'junction' : 'dir');
  const linked = await runtime.list(); assert(!linked.skills.some(skill => skill.id === 'project:linked-skill')); assert(linked.warnings.some(warning => warning.includes('Symbolic links'))); assertions += 2;
  await symlink(root, path.join(alpha, 'linked-reference'), process.platform === 'win32' ? 'junction' : 'dir'); await assert.rejects(() => runtime.read({ skill_id: 'project:alpha', path: 'linked-reference/outside.md' }), /Symbolic links/); assertions++;
  const long = '\\'.repeat(8000) + '\n' + '中'.repeat(8000) + '\n' + 'last'; await writeFile(path.join(alpha, 'references/long.txt'), long);
  let cursor = {}, reconstructed = ''; let pages = 0;
  do { const result = await runtime.read({ skill_id: 'project:alpha', path: 'references/long.txt', ...cursor }); assert(JSON.stringify(result).length < 16000); reconstructed += result.content; pages++; cursor = result.next_line ? { start_line: result.next_line, start_column: result.next_column } : null; } while (cursor);
  assert.equal(reconstructed, long); assert(pages > 2); assertions += pages + 2;
  await writeFile(path.join(alpha, 'references/binary.dat'), Buffer.from([0xff, 0xfe, 0, 1])); await assert.rejects(() => runtime.read({ skill_id: 'project:alpha', path: 'references/binary.dat' }), /UTF-8/); assertions++;
  const script = path.join(alpha, 'script.js'); await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'should-not-execute'))}, 'bad')`); await runtime.read({ skill_id: 'project:alpha', path: 'script.js' }); await assert.rejects(() => readFile(path.join(root, 'should-not-execute')), error => error.code === 'ENOENT'); assertions++;

  const baseline = await readFile('D:/TasteCode/repack-test/verification/onboarding-motion-0.5.11/backend-app/node_modules/@harness/server/dist/api-runtime.js', 'utf8');
  const patched = patchSkillRuntime(patchAttachmentApi(patchToolRounds(patchTaskNativeFile('node_modules/@harness/server/dist/api-runtime.js', baseline))));
  assert.equal(patchSkillRuntime(patched), patched); assertions++;
  const composed = patchSkillRuntime(patchArtifactWorkflow(patchAttachmentApi(patchToolRounds(patchTaskNativeFile('node_modules/@harness/server/dist/api-runtime.js', baseline)))));
  assert.equal(patchSkillRuntime(composed), composed); assert.equal(patchArtifactWorkflow(composed), composed); assertions += 2;
  const syntax = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: composed, encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr); assertions++;
  await writeFile(path.join(root, 'runtime.mjs'), patched); await cp(path.join(lane, 'overlay/asar/node_modules/@harness/server/dist/carb-skill-runtime.js'), path.join(root, 'carb-skill-runtime.js')); await cp(path.join(lane, 'overlay/asar/node_modules/@harness/server/dist/carb-global-skills.js'), path.join(root, 'carb-global-skills.js')); await cp(path.join(lane, 'verification/backend-app/node_modules/@harness/server/dist/skill-inventory.js'), path.join(root, 'skill-inventory.js')); await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  const { OpenAiCompatibleSession } = await import(pathToFileURL(path.join(root, 'runtime.mjs')));
  for (const transport of ['openai-compatible', 'openai-responses', 'anthropic-messages']) {
    let count = 0; const events = [], requests = [];
    const calls = [
      { name: 'skill_list', arguments: JSON.stringify({ query: 'alpha' }) },
      { name: 'skill_read', arguments: JSON.stringify({ skill_id: 'project:alpha' }) },
      { name: 'run_command', arguments: JSON.stringify({ command: 'echo permission-check' }) },
    ];
    const session = new OpenAiCompatibleSession({
      connection: { id: 'skill-test', transport, baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'fixture' }, apiKey: 'fixture', workspacePath: project,
      options: { approval: 'ask' },
      fetchImpl: async (_url, request) => {
        const body = JSON.parse(request.body); requests.push(body);
        const tools = transport === 'openai-compatible' ? body.tools.map(item => item.function.name) : body.tools.map(item => item.name);
        assert(tools.includes('skill_list') && tools.includes('skill_read')); assertions++;
        const call = calls[count++]; let payload;
        if (transport === 'openai-compatible') payload = { choices: [{ message: call ? { content: '', tool_calls: [{ id: 'call-' + count, type: 'function', function: call }] } : { content: '已读取 alpha 技能；命令未获批准。' } }] };
        else if (transport === 'openai-responses') payload = { output: call ? [{ type: 'function_call', call_id: 'call-' + count, ...call }] : [{ type: 'message', content: [{ type: 'output_text', text: '已读取 alpha 技能；命令未获批准。' }] }] };
        else payload = { content: call ? [{ type: 'tool_use', id: 'call-' + count, name: call.name, input: JSON.parse(call.arguments) }] : [{ type: 'text', text: '已读取 alpha 技能；命令未获批准。' }] };
        return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
      },
    });
    const completed = new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error(`Runtime test timed out (${transport})`)), 5000); session.on('event', event => { events.push(event); if (event.type === 'approval.requested') queueMicrotask(() => session.respondToApproval(event.request.id, 'deny')); if (event.type === 'turn.completed') { clearTimeout(timeout); resolve(event); } }); });
    session.sendTurn(session.thread.id, 'Use the alpha skill to complete this task.');
    assert.equal((await completed).status, 'completed'); assertions++;
    const messages = session.messages; assert(messages.some(message => message.role === 'system' && message.content.includes(skillRuntimeInstructions))); assertions++;
    assert(messages.some(message => message.role === 'tool' && message.content.includes('name: alpha'))); assertions++;
    assert.equal(session.skillRuntime.usedSkills()[0].name, 'alpha'); assertions++;
    assert(events.some(event => event.type === 'approval.requested' && event.request.kind === 'command')); assertions++;
    assert(events.some(event => event.item?.type === 'tool_call' && event.item.status === 'completed' && event.item.text.startsWith('skill_read:'))); assertions++;
    await session.dispose();
  }
  {
    let count = 0;
    const calls = [
      { name: 'skill_list', arguments: JSON.stringify({ query: 'task-skill' }) },
      { name: 'skill_read', arguments: JSON.stringify({ skill_id: 'global:task-skill' }) },
    ];
    const session = new OpenAiCompatibleSession({
      connection: { id: 'skill-no-workspace-test', transport: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'fixture' }, apiKey: 'fixture', workspacePath: undefined,
      fetchImpl: async (_url, request) => {
        const body = JSON.parse(request.body);
        assert(body.tools.map(item => item.function.name).includes('skill_list')); assertions++;
        const call = calls[count++];
        return new Response(JSON.stringify({ choices: [{ message: call ? { content: '', tool_calls: [{ id: 'global-call-' + count, type: 'function', function: call }] } : { content: 'Read the Crab global skill without a workspace.' } }] }), { headers: { 'content-type': 'application/json' } });
      },
    });
    const completed = new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('No-workspace skill runtime test timed out')), 5000); session.on('event', event => { if (event.type === 'turn.completed') { clearTimeout(timeout); resolve(event); } }); });
    session.sendTurn(session.thread.id, 'Use the task-skill.');
    assert.equal((await completed).status, 'completed'); assertions++;
    assert.equal(session.skillRuntime.usedSkills()[0].id, 'global:task-skill'); assertions++;
    assert(session.messages.some(message => message.role === 'tool' && message.content.includes('name: task-skill'))); assertions++;
    await session.dispose();
  }
  const report = { passed: true, assertions, verified: ['project, global and trusted bundled skill discovery', 'global skills available in a new workspace through skill_list and skill_read', 'global and bundled skills available with no selected workspace; project scope omitted', 'query and list pagination', 'skill and package reference reads', 'SHA-256 read evidence', 'paged long text without truncation', 'path traversal, hardlink, symlink and binary rejection', 'read without script execution', 'OpenAI Chat/Responses and Anthropic tool integration', 'normal command approval preserved', 'visible tool completion and actual-read tracking', 'idempotent runtime transform', 'artifact workflow composition and generated runtime syntax'], network: 'Deterministic model replies; real filesystem reads and runtime tool execution.' };
  await writeFile(path.join(lane, 'verification/skill-runtime.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
