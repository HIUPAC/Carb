import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { patchTaskNativeFile } from './patch-task-interactions.mjs';
import { patchToolRounds } from './patch-tool-rounds.mjs';
import { patchAttachmentApi } from './patch-attachment-backend.mjs';
import { patchDocumentWorkflow } from './patch-document-workflow.mjs';
import { patchArtifactWorkflow } from './patch-artifact-workflow.mjs';
import { patchSkillRuntime } from './patch-skill-runtime.mjs';
import { patchTaskCompletion } from './patch-task-completion.mjs';

// Provider replies are deterministic; all skill/filesystem/command tools below
// execute the production runtime implementations against real files.
const exec = promisify(execFile);
const lane = path.resolve(import.meta.dirname, '..');
const evidence = path.join(lane, 'verification/artifacts');
const project = path.join(evidence, 'workspace');
const output = path.join(project, 'outputs');
const baseline = path.resolve(lane, '../repack-test/verification/onboarding-motion-0.5.11/backend-app/node_modules/@harness/server/dist');
const helperRoot = path.join(lane, 'overlay/asar/node_modules/@harness/server/dist');
const temp = await mkdtemp(path.join(os.tmpdir(), 'carb-artifacts-'));
const kinds = ['pptx', 'docx', 'xlsx', 'py', 'md'];
const paths = kinds.map(kind => `outputs/acceptance.${kind}`);
const cases = [];
let sourceHashes = {};
const python = 'python';
const call = (name, args, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const tools = (...calls) => ({ content: '', tool_calls: calls });
const receiptOf = run => run.events.find(event => event.type === 'item.completed' && event.item?.text?.includes('## 任务产出与验收'))?.item.text;

try {
  await mkdir(output, { recursive: true });
  await writeFile(path.join(evidence, 'workflow-results.json'), JSON.stringify({ passed: false, status: 'running', startedAt: new Date().toISOString() }, null, 2) + '\n');
  const helperNames = ['carb-document-evidence.js', 'carb-artifact-evidence.js', 'carb-skill-source.js', 'carb-skill-runtime.js', 'carb-global-skills.js', 'reply-style.js'];
  const transformNames = ['patch-artifact-workflow.mjs', 'patch-tool-rounds.mjs', 'patch-windows-command.mjs', 'patch-attachment-backend.mjs', 'patch-document-workflow.mjs', 'patch-task-interactions.mjs', 'patch-skill-runtime.mjs', 'patch-task-completion.mjs', 'verify-windows-command.mjs'];
  const sourceNames = [...helperNames.map(name => path.relative(lane, path.join(helperRoot, name)).replaceAll('\\', '/')), ...transformNames.map(name => 'tools/' + name), 'tools/verify-artifact-workflow.mjs', 'tools/generate-artifact-fixtures.py', 'tools/inspect-artifact-fixtures.py'];
  const sourceBytes = new Map(await Promise.all(sourceNames.map(async name => [name, await readFile(path.join(lane, name))])));
  sourceHashes = Object.fromEntries([...sourceBytes].map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
  for (const name of helperNames) await writeFile(path.join(temp, name), sourceBytes.get(path.relative(lane, path.join(helperRoot, name)).replaceAll('\\', '/')));
  await cp(path.resolve(baseline, '../../../sax'), path.join(temp, 'node_modules/sax'), { recursive: true });
  await cp(path.resolve(baseline, '../../../js-yaml'), path.join(temp, 'node_modules/js-yaml'), { recursive: true });
  await writeFile(path.join(temp, 'package.json'), '{"type":"module"}');
  const runtimePath = 'node_modules/@harness/server/dist/api-runtime.js';
  const source = await readFile(path.join(baseline, 'api-runtime.js'), 'utf8');
  const transformed = patchTaskCompletion(patchSkillRuntime(patchArtifactWorkflow(patchDocumentWorkflow(runtimePath, patchAttachmentApi(patchToolRounds(patchTaskNativeFile(runtimePath, source)))))));
  assert.equal(patchSkillRuntime(transformed), transformed);
  assert.equal(patchArtifactWorkflow(transformed), transformed);
  assert.equal(patchTaskCompletion(transformed), transformed);
  await writeFile(path.join(temp, 'runtime.mjs'), transformed);
  await exec(process.execPath, ['--check', path.join(temp, 'runtime.mjs')]);
  const { OpenAiCompatibleSession } = await import(pathToFileURL(path.join(temp, 'runtime.mjs')));
  const { verifyArtifactSet, artifactTaskInstructions } = await import(pathToFileURL(path.join(temp, 'carb-artifact-evidence.js')));

  async function exercise({ workspace = project, contract = paths, answers = [], beforeRequest, onEvent, userText = '使用技能生成并验收五种格式的实际文件。' } = {}) {
    let requests = 0;
    const events = [], offeredTools = [];
    const session = new OpenAiCompatibleSession({
      connection: { id: 'artifact-fixture', enabled: true, transport: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'fixture' },
      apiKey: 'fixture', workspacePath: workspace,
      options: { approval: 'ask', ...(contract ? { artifactOutputs: contract } : {}) },
      fetchImpl: async (_url, request) => {
        requests++;
        const body = JSON.parse(request.body);
        offeredTools.push(body.tools.map(item => item.function.name));
        assert(offeredTools.at(-1).includes('run_command'));
        assert(offeredTools.at(-1).includes('skill_list'));
        assert(offeredTools.at(-1).includes('skill_read'));
        if (beforeRequest) await beforeRequest(requests, body);
        return new Response(JSON.stringify({ choices: [{ message: answers[requests - 1] || { content: '已完成生成和检查。' } }] }), { headers: { 'content-type': 'application/json' } });
      },
    });
    let timer;
    const completed = new Promise((resolve, reject) => {
      timer = setTimeout(() => { session.interrupt(); reject(new Error('Artifact runtime acceptance timed out.')); }, 20000);
      session.on('event', event => {
        events.push(event);
        if (event.type === 'approval.requested') queueMicrotask(() => session.respondToApproval(event.request.id, 'approve'));
        onEvent?.(event, session);
        if (event.type === 'turn.completed') { clearTimeout(timer); resolve(event); }
      });
    });
    try {
      session.sendTurn(session.thread.id, userText);
      const result = await completed;
      return { result, requests, events, messages: structuredClone(session.messages), usedSkills: session.skillRuntime.usedSkills(), offeredTools };
    } finally { clearTimeout(timer); await session.dispose(); }
  }

  const skillDir = path.join(project, '.agents/skills/fixture-five-format');
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: fixture-five-format\ndescription: Generate and verify the five-format artifact acceptance fixtures.\n---\n# Workflow\nWrite a generator and the Python/Markdown outputs. Run the generator, inspect the five files, then report verified results.\n');
  // Remove only this verifier's five known outputs, so a stale file cannot make
  // a mocked successful response pass without real generation in this run.
  for (const relative of paths) await rm(path.join(project, relative), { force: true });
  const generator = await readFile(path.join(lane, 'tools/generate-artifact-fixtures.py'), 'utf8');
  const program = 'import json\n\ndef calculate(values):\n    return {"items": len(values), "total": sum(values)}\n\nif __name__ == "__main__":\n    print(json.dumps(calculate([12, 18, 12]), sort_keys=True))\n';
  const markdown = '# Carb workflow acceptance\n\nSkill: fixture-five-format\n\nTotal: **42**\n\n- [PowerPoint](acceptance.pptx)\n- [Word](acceptance.docx)\n- [Excel](acceptance.xlsx)\n- [Python](acceptance.py)\n';
  const success = await exercise({ answers: [
    tools(call('skill_list', { query: 'fixture-five-format' })),
    tools(call('skill_read', { skill_id: 'project:fixture-five-format' })),
    tools(call('write_file', { path: 'build_fixtures.py', content: generator }, 'write-generator'), call('write_file', { path: paths[3], content: program }, 'write-python'), call('write_file', { path: paths[4], content: markdown }, 'write-markdown')),
    tools(call('run_command', { command: 'python build_fixtures.py outputs' }, 'generate-office')),
    tools(call('run_command', { command: 'python outputs/acceptance.py' }, 'execute-python')),
    tools(call('artifact_inspect', { paths })),
    { content: '已使用 fixture-five-format 技能，生成并检查五个实际产出。' },
  ] });
  assert.equal(success.result.status, 'completed', JSON.stringify(success.events.filter(event => event.type === 'thread.error' || event.type === 'item.completed' && event.item?.status === 'failed')));
  assert(success.messages.some(message => message.role === 'system' && message.content.includes('provide a complete handoff')));
  const toolResults = success.messages.filter(message => message.role === 'tool');
  assert.equal(toolResults.length, 8);
  assert(toolResults.every(message => !message.content.startsWith('Tool error:')), JSON.stringify(toolResults));
  assert(toolResults.find(message => message.tool_call_id === 'generate-office').content.includes('Exit code: 0'));
  assert(toolResults.find(message => message.tool_call_id === 'execute-python').content.includes('"total": 42'));
  assert.equal(success.usedSkills.length, 1);
  assert.equal(success.usedSkills[0].name, 'fixture-five-format');
  assert.match(success.usedSkills[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(success.events.filter(event => event.type === 'approval.requested' && event.request.kind === 'command').length, 2);
  assert.equal(success.events.filter(event => event.type === 'approval.requested' && event.request.kind === 'file_change').length, 3);
  const receipt = receiptOf(success);
  assert(receipt);
  for (const relative of paths) { assert(receipt.includes(relative)); assert(receipt.includes(path.resolve(project, relative))); }
  assert.equal((receipt.match(/SHA-256/g) || []).length, 5);
  assert.equal((receipt.match(/打开方式/g) || []).length, 5);
  const inspection = JSON.parse((await exec(python, [path.join(lane, 'tools/inspect-artifact-fixtures.py'), output])).stdout);
  const report = await verifyArtifactSet(project, paths);
  assert.equal(report.count, 5);
  for (const item of report.records) assert.equal(inspection.records.find(record => record.kind === item.kind).sha256, item.sha256);
  cases.push({ name: 'real-runtime-five-format-delivery', status: 'passed', requests: success.requests, toolCalls: toolResults.length, commandApprovals: 2, fileApprovals: 3, actualSkillsRead: success.usedSkills, receipt: true });
  await writeFile(path.join(evidence, 'independent-inspection.json'), JSON.stringify(inspection, null, 2) + '\n');
  await writeFile(path.join(evidence, 'runtime-events.json'), JSON.stringify(success.events, null, 2) + '\n');
  await writeFile(path.join(evidence, 'verified-receipt.md'), receipt + '\n');

  async function clone(label) {
    const workspace = path.join(temp, label);
    await mkdir(path.join(workspace, 'outputs'), { recursive: true });
    for (const relative of paths) await cp(path.join(project, relative), path.join(workspace, relative));
    return workspace;
  }
  async function rejection(name, mutate, matcher = /./u) {
    const workspace = await clone(name);
    const filenames = await mutate(workspace) || paths;
    await assert.rejects(() => verifyArtifactSet(workspace, filenames), matcher);
    cases.push({ name, status: 'passed', rejected: true });
  }
  async function rewriteZip(filename, mutation) {
    await exec(python, ['-c', 'import json,sys,zipfile\np=sys.argv[1]; changes=json.loads(sys.argv[2])\nwith zipfile.ZipFile(p) as z: entries={n:z.read(n) for n in z.namelist()}\nfor n,v in changes.items():\n if v is None: entries.pop(n,None)\n else: entries[n]=v.encode("utf-8")\nwith zipfile.ZipFile(p,"w",zipfile.ZIP_DEFLATED) as z:\n for n,v in entries.items(): z.writestr(n,v)\n', filename, JSON.stringify(mutation)]);
  }
  await rejection('missing-output', async workspace => { await rm(path.join(workspace, paths[0])); });
  await rejection('empty-output', async workspace => { await writeFile(path.join(workspace, paths[3]), ''); });
  await rejection('whitespace-markdown', async workspace => { await writeFile(path.join(workspace, paths[4]), ' \n\t'); });
  await rejection('binary-text-output', async workspace => { await writeFile(path.join(workspace, paths[4]), Buffer.from([0xff, 0xfe, 0x61])); });
  await rejection('nul-text-output', async workspace => { await writeFile(path.join(workspace, paths[3]), 'print(1)\0'); });
  await rejection('fake-zip-output', async workspace => { await writeFile(path.join(workspace, paths[0]), 'PK\x03\x04[Content_Types].xml ppt/presentation.xml ppt/slides/slide1.xml'); });
  await rejection('truncated-zip-output', async workspace => { const filename = path.join(workspace, paths[0]); const data = await readFile(filename); await writeFile(filename, data.subarray(0, data.length - 22)); });
  await rejection('crc-corruption-output', async workspace => { const filename = path.join(workspace, paths[0]); const data = await readFile(filename); const start = 30 + data.readUInt16LE(26) + data.readUInt16LE(28); data[start + 3] ^= 0x01; await writeFile(filename, data); });
  await rejection('missing-office-main', async workspace => { await rewriteZip(path.join(workspace, paths[1]), { 'word/document.xml': null }); });
  await rejection('malformed-office-xml', async workspace => { await rewriteZip(path.join(workspace, paths[1]), { 'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><broken></w:document>' }); });
  await rejection('wrong-office-namespace', async workspace => { await rewriteZip(path.join(workspace, paths[1]), { 'word/document.xml': '<w:document xmlns:w="urn:wrong"><w:body/></w:document>' }); });
  await rejection('xml-external-entity', async workspace => { await rewriteZip(path.join(workspace, paths[1]), { 'word/document.xml': '<!DOCTYPE document [<!ENTITY external SYSTEM "file:///secret">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>&external;</w:body></w:document>' }); });
  await rejection('wrong-format-in-office', async workspace => { await cp(path.join(workspace, paths[2]), path.join(workspace, paths[0])); });
  await rejection('missing-office-root-rels', async workspace => { await rewriteZip(path.join(workspace, paths[1]), { '_rels/.rels': null }); });
  await rejection('broken-office-relationship', async workspace => { await rewriteZip(path.join(workspace, paths[1]), { '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="missing.xml"/></Relationships>' }); });
  await rejection('malformed-secondary-office-xml', async workspace => { await rewriteZip(path.join(workspace, paths[1]), { 'docProps/core.xml': '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><broken></cp:coreProperties>' }); });
  await rejection('duplicate-format', async () => [paths[0], paths[1], paths[2], paths[3], paths[3]]);
  await rejection('missing-format', async () => paths.slice(0, 4));
  for (const [name, relative] of [['parent-traversal', '../outside.md'], ['windows-traversal', '..\\outside.md'], ['absolute-path', path.join(project, paths[4])], ['windows-drive-path', 'C:/outside.md'], ['alternate-data-stream', 'outputs/acceptance.md:secret'], ['trailing-dot-path', 'outputs/acceptance.md.']]) {
    await rejection(name, async () => [...paths.slice(0, 4), relative]);
  }
  await rejection('hardlink-output', async workspace => { const filename = path.join(workspace, paths[4]); const original = path.join(workspace, 'hardlink-source.md'); await cp(filename, original); await rm(filename); await link(original, filename); });
  await rejection('parent-symlink-output', async workspace => { await symlink(output, path.join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); return [...paths.slice(0, 4), 'linked/acceptance.md']; });

  const missingWorkspace = path.join(temp, 'runtime-missing'); await mkdir(missingWorkspace);
  const missing = await exercise({ workspace: missingWorkspace, answers: [{ content: '已生成五个文件。' }] });
  assert.equal(missing.result.status, 'failed'); assert(!receiptOf(missing));
  assert(missing.events.some(event => event.type === 'thread.error'));
  cases.push({ name: 'false-completion-rejected-by-runtime', status: 'passed', turnStatus: missing.result.status, receipt: false });

  const damagedWorkspace = await clone('runtime-damaged');
  await writeFile(path.join(damagedWorkspace, paths[2]), 'damaged');
  const damaged = await exercise({ workspace: damagedWorkspace, answers: [tools(call('artifact_inspect', { paths })), { content: '校验通过。' }] });
  assert.equal(damaged.result.status, 'failed'); assert(!receiptOf(damaged));
  assert(damaged.messages.some(message => message.role === 'tool' && message.content.startsWith('Tool error:')));
  cases.push({ name: 'corrupt-output-rejected-by-inspect-and-final-guard', status: 'passed', turnStatus: damaged.result.status, receipt: false });

  const changedWorkspace = await clone('runtime-changed');
  const changed = await exercise({ workspace: changedWorkspace, answers: [tools(call('artifact_inspect', { paths })), { content: '校验通过。' }], beforeRequest: async round => { if (round === 2) await writeFile(path.join(changedWorkspace, paths[4]), ''); } });
  assert.equal(changed.result.status, 'failed'); assert(!receiptOf(changed));
  assert(changed.messages.some(message => message.role === 'tool' && message.content.includes('"ok":true')));
  cases.push({ name: 'outputs-rechecked-after-successful-inspection', status: 'passed', turnStatus: changed.result.status, receipt: false });

  const mismatchedWorkspace = await clone('runtime-mismatched');
  await cp(path.join(mismatchedWorkspace, paths[4]), path.join(mismatchedWorkspace, 'outputs/other.md'));
  const mismatched = await exercise({ workspace: mismatchedWorkspace, answers: [tools(call('artifact_inspect', { paths: [...paths.slice(0, 4), 'outputs/other.md'] })), { content: '已检查。' }] });
  assert(mismatched.messages.some(message => message.role === 'tool' && /must match the output contract/.test(message.content)));
  // The final guard still validates the actual contract, not the alternate set.
  assert.equal(mismatched.result.status, 'completed'); assert(receiptOf(mismatched));
  cases.push({ name: 'inspection-paths-must-match-contract', status: 'passed', alternateInspectionRejected: true, contractedOutputsVerified: true });

  const cancelledWorkspace = await clone('runtime-cancelled');
  let cancellationTriggered = false;
  const cancelled = await exercise({ workspace: cancelledWorkspace, answers: [{ content: '最终消息之后立即取消。' }], onEvent: (event, session) => {
    if (event.type === 'item.completed' && event.item?.role === 'assistant' && event.item.text === '最终消息之后立即取消。') {
      cancellationTriggered = true;
      session.interrupt();
    }
  } });
  assert(cancellationTriggered);
  assert.equal(cancelled.result.status, 'interrupted'); assert(!receiptOf(cancelled));
  cases.push({ name: 'cancel-after-final-model-message-suppresses-receipt', status: 'passed', turnStatus: cancelled.result.status, receipt: false });

  const ordinary = await exercise({ workspace: temp, contract: null, userText: '生成一份 Markdown 笔记。', answers: [tools(call('write_file', { path: 'ordinary.md', content: '# Ordinary task\nOne requested file.' })), { content: '笔记已生成。' }] });
  assert.equal(ordinary.result.status, 'completed'); assert(!receiptOf(ordinary));
  assert(!ordinary.messages.some(message => message.role === 'system' && message.content.includes(artifactTaskInstructions(true))));
  assert.equal(await readFile(path.join(temp, 'ordinary.md'), 'utf8'), '# Ordinary task\nOne requested file.');
  cases.push({ name: 'ordinary-task-does-not-require-five-formats', status: 'passed', turnStatus: ordinary.result.status });
  const unauthorized = await exercise({ workspace: temp, contract: null, answers: [tools(call('artifact_inspect', { paths })), { content: '普通任务无需五格式验收。' }] });
  assert(unauthorized.messages.some(message => message.role === 'tool' && /does not have a five-format output contract/.test(message.content)));
  cases.push({ name: 'artifact-inspection-contract-required', status: 'passed', inspectionRejected: true });

  const final = { passed: true, timestamp: new Date().toISOString(), source: 'Deterministic provider replies; actual production runtime tool execution. No live model or network requests.', sourceHashes, runtimeSha256: createHash('sha256').update(transformed).digest('hex'), baselineSha256: createHash('sha256').update(source).digest('hex'), runtime: 'Production API-compatible session and actual skill_list, skill_read, write_file, run_command, artifact_inspect implementations; deterministic provider replies without network.', dependencies: { fixtureGeneration: ['python-pptx', 'python-docx', 'openpyxl'], independentInspection: 'Python standard library', productionXmlParser: 'Existing bundled sax' }, cases: cases.length, checks: cases, artifacts: report.records, independentInspection: path.join(evidence, 'independent-inspection.json'), eventEvidence: path.join(evidence, 'runtime-events.json') };
  await writeFile(path.join(evidence, 'workflow-results.json'), JSON.stringify(final, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, cases: cases.length, generated: report.records.map(record => record.absolutePath), report: path.join(evidence, 'workflow-results.json') }, null, 2));
} catch (error) {
  await writeFile(path.join(evidence, 'workflow-results.json'), JSON.stringify({ passed: false, status: 'failed', timestamp: new Date().toISOString(), sourceHashes, error: error instanceof Error ? error.message : String(error) }, null, 2) + '\n');
  throw error;
} finally {
  // temp is the unique directory created by this verifier under os.tmpdir().
  assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
  await rm(temp, { recursive: true, force: true });
}
