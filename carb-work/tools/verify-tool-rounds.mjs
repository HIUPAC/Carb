import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readAsar } from './asar-files.mjs';
import { patchTaskNativeFile } from './patch-task-interactions.mjs';
import { patchToolRounds } from './patch-tool-rounds.mjs';

const source = await readFile('D:/TasteCode/repack-test/verification/onboarding-motion-0.5.11/backend-app/node_modules/@harness/server/dist/api-runtime.js', 'utf8');
const patched = patchToolRounds(patchTaskNativeFile('node_modules/@harness/server/dist/api-runtime.js', source));
assert.equal(patchToolRounds(patched), patched, 'current patch is idempotent');

// Exercise the actual previously shipped runtime, rather than recreating its
// transform in this test. It has the loop marker but no original limit anchors.
const legacyArchive = await readAsar(path.resolve(import.meta.dirname, '../Carb-0.5.14/resources/app.asar'));
const legacySource = legacyArchive.entries.get('node_modules/@harness/server/dist/api-runtime.js').toString('utf8');
assert(legacySource.includes('if (execution.failed && ++failedToolCalls > 10)'), 'historical fixture still contains the old failure stop');
assert(!legacySource.includes('toolStats:'), 'historical fixture predates completion statistics');
const migrated = patchToolRounds(legacySource);
assert(!migrated.includes('more than 10 tool calls failed'), 'migration removes the old hard stop');
assert(migrated.includes('toolStats: { failedToolCalls }'), 'migration adds completion statistics');
assert.equal(patchToolRounds(migrated), migrated, 'migrated patch is idempotent');
const withoutStats = patched.replace(', toolStats: { failedToolCalls }', '');
assert.equal(patchToolRounds(withoutStats), patched, 'an unlimited loop missing statistics upgrades without baseline anchors');
const legacyWithStats = legacySource.replace('status: finalStatus, completedAt: now() });', 'status: finalStatus, completedAt: now(), toolStats: { failedToolCalls } });');
assert.equal(patchToolRounds(legacyWithStats), migrated, 'statistics marker alone cannot preserve a legacy hard stop');
assert.throws(() => patchToolRounds(patched.replace('if (execution.failed) failedToolCalls += 1;', '')), /Unsupported tool-loop patch/,
  'an unknown partial patch fails explicitly instead of being silently accepted');
const dir = await mkdtemp(path.join(os.tmpdir(), 'carb-rounds-'));
try {
  const file = path.join(dir, 'runtime.mjs');
  await writeFile(file, patched);
  const { OpenAiCompatibleSession } = await import(pathToFileURL(file).href);
  const migratedFile = path.join(dir, 'migrated-runtime.mjs');
  await writeFile(migratedFile, migrated);
  const { OpenAiCompatibleSession: MigratedSession } = await import(pathToFileURL(migratedFile).href);
  async function exercise(toolRounds, interruptAt) {
    let requests = 0;
    const session = new OpenAiCompatibleSession({
      connection: { id: 'fixture', transport: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'fixture' },
      apiKey: 'fixture', workspacePath: dir,
      fetchImpl: async () => {
        requests++;
        const message = requests <= toolRounds
          ? { content: '', tool_calls: Array.from({ length: 4 }, (_, i) => ({ id: `call-${requests}-${i}`, type: 'function', function: { name: 'list_directory', arguments: '{"path":"."}' } })) }
          : { content: '完成' };
        if (requests === interruptAt) session.interrupt();
        return new Response(JSON.stringify({ choices: [{ message }] }), { headers: { 'content-type': 'application/json' } });
      },
    });
    const completed = new Promise(resolve => session.on('event', e => { if (e.type === 'turn.completed') resolve(e); }));
    session.sendTurn(session.thread.id, '生成网页');
    const event = await completed;
    const messages = session.messages;
    await session.dispose();
    return { event, requests, messages };
  }
  const success = await exercise(100);
  assert.equal(success.event.status, 'completed');
  assert.equal(success.requests, 101);
  assert.equal(success.messages.filter(m => m.role === 'tool').length, 400);
  const interrupted = await exercise(100, 70);
  assert.equal(interrupted.event.status, 'interrupted');
  async function failures(failureCount, Session = OpenAiCompatibleSession) {
    let requests = 0;
    const session = new Session({
      connection: { id: 'fixture', transport: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'fixture' },
      apiKey: 'fixture', workspacePath: dir,
      fetchImpl: async () => {
        requests++;
        const calls = [];
        if (requests === 1) {
          for (let i = 0; i < failureCount; i++) {
            calls.push({ id: `fail-${i}`, type: 'function', function: { name: 'missing_tool', arguments: '{}' } });
            if (i === 4) calls.push({ id: 'success-between', type: 'function', function: { name: 'list_directory', arguments: '{"path":"."}' } });
          }
          calls.push({ id: 'after', type: 'function', function: { name: 'list_directory', arguments: '{"path":"."}' } });
        }
        return new Response(JSON.stringify({ choices: [{ message: calls.length ? { content: '', tool_calls: calls } : { content: '完成' } }] }), { headers: { 'content-type': 'application/json' } });
      },
    });
    const events = [];
    const completed = new Promise(resolve => session.on('event', e => { events.push(e); if (e.type === 'turn.completed') resolve(e); }));
    session.sendTurn(session.thread.id, '测试');
    const event = await completed;
    const messages = session.messages;
    await session.dispose();
    return { event, messages, requests, events };
  }
  for (const failureCount of [10, 11, 25]) {
    const result = await failures(failureCount);
    assert.equal(result.event.status, 'completed');
    assert.equal(result.event.toolStats?.failedToolCalls, failureCount);
    assert.equal(result.requests, 2);
    assert.ok(!result.messages.find(m => m.tool_call_id === 'after').content.includes('skipped'));
    assert.equal(result.events.filter(e => e.type === 'item.started' && e.item?.type === 'tool_call').length, failureCount + 2);
    const group = result.messages.findIndex(m => m.tool_calls);
    for (let j = 0; j < result.messages[group].tool_calls.length; j++) {
      assert.equal(result.messages[group + 1 + j]?.tool_call_id, result.messages[group].tool_calls[j].id);
    }
  }
  for (const failureCount of [11, 25]) {
    const result = await failures(failureCount, MigratedSession);
    assert.equal(result.event.status, 'completed', 'upgraded historical runtime continues after failed tools');
    assert.equal(result.event.toolStats?.failedToolCalls, failureCount, 'upgraded historical runtime records all failures');
    assert.equal(result.requests, 2, 'upgraded historical runtime lets the model recover');
    assert(!result.messages.find(message => message.tool_call_id === 'after').content.includes('skipped'), 'post-failure tools still execute after upgrade');
    assert(!result.events.some(event => event.type === 'thread.error'), 'upgrade does not emit the previous hard-stop error');
  }
  for (let i = 0; i < interrupted.messages.length; i++) {
    const m = interrupted.messages[i];
    if (!m.tool_calls) continue;
    for (let j = 0; j < m.tool_calls.length; j++) {
      assert.equal(interrupted.messages[i + 1 + j]?.role, 'tool');
      assert.equal(interrupted.messages[i + 1 + j]?.tool_call_id, m.tool_calls[j].id);
    }
  }
  console.log('Baseline and shipped 0.5.14 migrations are idempotent; 100 rounds and 400 calls complete; 25 failures recover with statistics; interruption preserves balanced tool results.');
} finally { await rm(dir, { recursive: true, force: true }); }
