import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { patchAttachmentApi, patchAttachmentServer } from './patch-attachment-backend.mjs';

const root = 'D:/TasteCode/carb-work/verification/backend-app/node_modules/@harness/server/dist';
const api = patchAttachmentApi(await readFile(`${root}/api-runtime.js`, 'utf8'));
const server = patchAttachmentServer(await readFile(`${root}/server.js`, 'utf8'));
assert.match(server, /filter\(file => file !== 'carb:\/\/design-brief-v1'.*length > 15/s);
const dir = await mkdtemp(path.join(os.tmpdir(), 'carb-attachment-'));
const work = await mkdtemp(path.join(os.tmpdir(), 'carb-workspace-'));
try {
  const moduleFile = path.join(dir, 'api.mjs');
  const allowed = path.join(dir, 'input.md');
  const denied = path.join(dir, 'private.md');
  const binary = path.join(dir, 'program.exe');
  await writeFile(moduleFile, api);
  await writeFile(allowed, 'attached document text');
  await writeFile(denied, 'private text');
  await writeFile(binary, Buffer.from([0x4d, 0x5a, 0, 0xff]));
  const { OpenAiCompatibleSession } = await import(pathToFileURL(moduleFile));
  let calls = 0;
  const session = new OpenAiCompatibleSession({ connection: { id: 'test', transport: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'test' }, apiKey: 'fixture', workspacePath: work,
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: ++calls === 1 ? { content: '', tool_calls: [allowed, denied, binary].map((file, index) => ({ id: String(index), type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: file }) } })) } : { content: 'done' } }] }), { headers: { 'content-type': 'application/json' } }) });
  const complete = new Promise(resolve => session.on('event', event => { if (event.type === 'turn.completed') resolve(event); }));
  session.sendTurn(session.thread.id, 'test', [allowed, binary]);
  assert.equal((await complete).status, 'completed');
  const results = session.messages.filter(item => item.role === 'tool');
  assert.match(results[0].content, /attached document text/);
  assert.match(results[1].content, /inside the active workspace/);
  assert.match(results[2].content, /Tool error/);
  await session.dispose();
  console.log('Explicit external attachment reads succeed; unselected paths and binary text reads are rejected.');
} finally { await rm(dir, { recursive: true, force: true }); await rm(work, { recursive: true, force: true }); }
