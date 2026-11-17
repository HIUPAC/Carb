import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchTaskNativeFile } from './patch-task-interactions.mjs';
import { patchToolRounds } from './patch-tool-rounds.mjs';
import { patchAttachmentApi } from './patch-attachment-backend.mjs';
import { patchDocumentWorkflow, documentWorkflowPaths } from './patch-document-workflow.mjs';

const baseline = 'D:/TasteCode/repack-test/verification/onboarding-motion-0.5.11/backend-app/node_modules/@harness/server/dist/';
const helper = path.resolve(import.meta.dirname, '../overlay/asar/node_modules/@harness/server/dist/carb-document-evidence.js');
const dir = await mkdtemp(path.join(os.tmpdir(), 'carb-document-'));
try {
  await writeFile(path.join(dir, 'carb-document-evidence.js'), await readFile(helper));
  await writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  const original = await readFile(path.join(baseline, 'api-runtime.js'), 'utf8');
  const runtime = patchDocumentWorkflow(documentWorkflowPaths[1], patchAttachmentApi(patchToolRounds(patchTaskNativeFile(documentWorkflowPaths[1], original))));
  assert.equal(patchDocumentWorkflow(documentWorkflowPaths[1], runtime), runtime);
  await writeFile(path.join(dir, 'runtime.mjs'), runtime);
  const { OpenAiCompatibleSession } = await import(pathToFileURL(path.join(dir, 'runtime.mjs')).href);
  const { documentTaskPrompt } = await import(pathToFileURL(path.join(dir, 'carb-document-evidence.js')).href);
  const prompt = documentTaskPrompt({ outputName: 'report.md', instructions: 'Summarize notes.', role: 'Project lead', acceptanceCriteria: 'Each action includes an owner.' });
  assert.match(prompt, /Project lead/);
  assert.match(prompt, /Each action includes an owner/);
  assert.match(prompt, /untrusted source material/);
  assert.match(prompt, /2–4 step plan/);
  const call = (name, args, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  async function run(filename, answers, mutate) {
    let requestCount = 0;
    const events = [];
    const session = new OpenAiCompatibleSession({
      connection: { id: 'fixture', enabled: true, transport: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'fixture' },
      apiKey: 'fixture', workspacePath: dir, options: { documentOutput: filename },
      fetchImpl: async (_url, request) => {
        const payload = JSON.parse(request.body);
        assert(!payload.tools.some(t => t.function.name === 'run_command'));
        if (mutate) await mutate(++requestCount);
        const message = answers.shift() || { content: 'Done.' };
        return new Response(JSON.stringify({ choices: [{ message }] }), { headers: { 'content-type': 'application/json' } });
      },
    });
    const completed = new Promise(resolve => session.on('event', e => { events.push(e); if (e.type === 'turn.completed') resolve(e); }));
    session.sendTurn(session.thread.id, '整理会议记录');
    const result = await completed;
    await session.dispose();
    return { result, events, messages: session.messages };
  }
  const success = await run('report.md', [
    { content: '读取资料，生成报告并校验。', tool_calls: [call('write_file', { path: 'report.md', content: '# Report\nAction: check sources.' })] },
    { content: '', tool_calls: [call('read_file', { path: 'report.md' })] },
  ]);
  assert.equal(success.result.status, 'completed');
  const receipt = success.events.find(e => e.type === 'item.completed' && e.item?.text?.includes('SHA-256'));
  assert(receipt);
  assert.match(receipt.item.text, /文件校验通过/);
  assert.match(receipt.item.text, /2 次工具调用/);
  assert.match(receipt.item.text, /[a-f0-9]{64}/);
  const absent = await run('missing.md', [{ content: 'I created missing.md successfully.' }]);
  assert.equal(absent.result.status, 'failed');
  assert(absent.events.some(e => e.type === 'thread.error' && /did not create/.test(e.message)));
  const tampered = await run('tampered.md', [{ content: '', tool_calls: [call('write_file', { path: 'tampered.md', content: '# Original' })] }], async round => {
    if (round === 2) await writeFile(path.join(dir, 'tampered.md'), '# Replaced externally');
  });
  assert.equal(tampered.result.status, 'failed');
  assert(tampered.events.some(e => e.type === 'thread.error' && /changed before verification/.test(e.message)));
  const denied = await run('bounded.md', [{ content: '', tool_calls: [
    call('write_file', { path: 'other.md', content: '# Disallowed' }),
    call('run_command', { command: 'echo forbidden' }),
  ] }]);
  assert.equal(denied.result.status, 'failed');
  assert(denied.messages.filter(m=>m.role === 'tool').every(m=>m.content.startsWith('Tool error:')));
  await assert.rejects(readFile(path.join(dir, 'other.md')), { code: 'ENOENT' });
  const workflow = await readFile(path.join(baseline, 'document-workflow.js'), 'utf8');
  const patchedWorkflow = patchDocumentWorkflow(documentWorkflowPaths[0], workflow);
  assert.equal(patchDocumentWorkflow(documentWorkflowPaths[0], patchedWorkflow), patchedWorkflow);
  assert.match(patchedWorkflow, /acceptanceCriteria: z.string/);
  console.log('PASS: structured planning, real file delivery/readback receipt, false completion rejected, tampering detected, and write/shell boundaries preserved.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
