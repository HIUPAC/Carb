import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchApiEffort, patchModelConnections, patchModelEffortRenderer } from './patch-model-effort.mjs';

const root = path.resolve(import.meta.dirname, '..');
const original = await readFile(path.join(root, 'verification/backend-app/node_modules/@harness/server/dist/api-runtime.js'), 'utf8');
const patched = patchApiEffort(original);
assert.equal(patchApiEffort(patched), patched);
const tmp = await mkdtemp(path.join(os.tmpdir(), 'carb-effort-'));
try {
  const filename = path.join(tmp, 'runtime.mjs');
  await writeFile(filename, patched + '\nexport { requestFor };\n');
  const { requestFor, OpenAiCompatibleSession } = await import(pathToFileURL(filename));
  for (const transport of ['openai-compatible', 'openai-responses', 'anthropic-messages']) {
    const connection = { transport, baseUrl: 'https://example.com/v1' };
    const auto = requestFor(connection, 'key', 'model', [], undefined, 'auto').body;
    assert(!('reasoning_effort' in auto) && !('reasoning' in auto) && !('output_config' in auto));
    const body = requestFor(connection, 'key', 'model', [], undefined, 'high').body;
    assert.equal(transport === 'openai-compatible' ? body.reasoning_effort : transport === 'openai-responses' ? body.reasoning.effort : body.output_config.effort, 'high');
  }
  let sent;
  const session = new OpenAiCompatibleSession({ connection: { id: 'fixture', transport: 'openai-compatible', baseUrl: 'https://example.com/v1', defaultModel: 'fixture' }, apiKey: 'fixture', options: { effort: 'low' }, fetchImpl: async (_url, request) => { sent = JSON.parse(request.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { headers: { 'content-type': 'application/json' } }); } });
  const completed = new Promise(resolve => session.on('event', event => event.type === 'turn.completed' && resolve(event)));
  session.sendTurn(session.thread.id, 'test', [], { effort: 'high' });
  assert.equal((await completed).status, 'completed');
  assert.equal(sent.reasoning_effort, 'high');
  assert.equal(session.snapshot().effort, 'high');
  await session.dispose();
  const models = await readFile(path.join(root, 'verification/backend-app/node_modules/@harness/server/dist/model-connections.js'), 'utf8');
  assert.match(patchModelConnections(models), /reasoningEfforts: \['auto', 'low', 'medium', 'high'\]/);
  const renderer = await readFile(path.join(root, 'overlay/resources/web/assets/index-dY3kjCLH.js'), 'utf8');
  assert.match(patchModelEffortRenderer(renderer), /reasoningEfforts:\[`auto`,`low`,`medium`,`high`\]/);
  console.log('Model effort request mapping, per-turn update, persistence and model picker: passed');
} finally { await rm(tmp, { recursive: true, force: true }); }
