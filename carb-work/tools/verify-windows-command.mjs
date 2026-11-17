import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readAsar } from './asar-files.mjs';
import { patchTaskNativeFile } from './patch-task-interactions.mjs';
import { patchToolRounds } from './patch-tool-rounds.mjs';
import { patchWindowsCommand } from './patch-windows-command.mjs';

assert.equal(process.platform, 'win32', 'Run this acceptance test on Windows with its real cmd.exe.');
const lane = path.resolve(import.meta.dirname, '..');
const reportPath = path.join(lane, 'verification/windows-command.json');
const runtimePath = 'node_modules/@harness/server/dist/api-runtime.js';
const baseline = path.resolve(lane, '../repack-test/verification/onboarding-motion-0.5.11/backend-app', runtimePath);
const temp = await mkdtemp(path.join(os.tmpdir(), 'carb-windows-command-'));
const project = path.join(temp, '中文 工作区');
const checks = [];
const sourceNames = ['tools/patch-windows-command.mjs', 'tools/patch-tool-rounds.mjs', 'tools/verify-windows-command.mjs'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
let sourceHashes = {};
const activeSessions = new Set();
const childPids = new Set();
const quote = value => '"' + value + '"';

async function exercise(Session, command, { approval = 'full', decision, onEvent, timeoutMs = 8000 } = {}) {
  const events = [];
  let requests = 0;
  const session = new Session({
    connection: { id: 'command-fixture', transport: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'fixture' },
    apiKey: 'fixture', workspacePath: project, options: { approval },
    fetchImpl: async () => {
      const message = ++requests === 1 ? { content: '', tool_calls: [{ id: 'cmd', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command }) } }] } : { content: 'Command verification complete.' };
      return new Response(JSON.stringify({ choices: [{ message }] }), { headers: { 'content-type': 'application/json' } });
    },
  });
  activeSessions.add(session);
  let timeout;
  try {
    const completed = new Promise((resolve, reject) => {
      timeout = setTimeout(() => { session.interrupt(); reject(new Error('Command test timed out: ' + command)); }, timeoutMs);
      session.on('event', event => {
        events.push(event);
        if (event.type === 'approval.requested' && decision) queueMicrotask(() => session.respondToApproval(event.request.id, decision));
        onEvent?.(event, session);
        if (event.type === 'turn.completed') resolve(event);
      });
    });
    session.sendTurn(session.thread.id, 'Run the requested local command.');
    const event = await completed;
    return {
      event, events, requests,
      result: session.messages.find(message => message.tool_call_id === 'cmd')?.content,
      commandItem: events.find(event => event.type === 'item.completed' && event.item?.type === 'command')?.item,
    };
  } finally {
    clearTimeout(timeout);
    await session.dispose();
    activeSessions.delete(session);
  }
}

const argsOf = run => JSON.parse(run.commandItem.text.trim());
const success = run => {
  assert.equal(run.event.status, 'completed');
  assert.equal(run.commandItem?.exitCode, 0, run.result);
  assert.equal(run.commandItem.status, 'completed');
  assert.equal(run.event.toolStats?.failedToolCalls, 0);
};
async function check(name, action) {
  const details = await action();
  checks.push({ name, passed: true, ...details });
}

try {
  sourceHashes = Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, sha256(await readFile(path.join(lane, name)))])));
  await mkdir(path.join(project, '脚本 目录'), { recursive: true });
  await writeFile(path.join(project, 'args.cjs'), 'console.log(JSON.stringify(process.argv.slice(2)));\n');
  const spacedScript = path.join(project, '脚本 目录', '参数 回显.cjs');
  await writeFile(spacedScript, 'console.log(JSON.stringify(process.argv.slice(2)));\n');
  const original = patchTaskNativeFile(runtimePath, await readFile(baseline, 'utf8'));
  const transformed = patchToolRounds(original);
  assert.equal(patchToolRounds(transformed), transformed, 'pipeline transform is idempotent');
  assert.equal(patchWindowsCommand(transformed), transformed, 'command transform is idempotent');
  assert.throws(() => patchWindowsCommand(transformed.replace('      windowsVerbatimArguments: isWindows,', '')), /Unsupported Windows command patch/);
  await writeFile(path.join(temp, 'original.mjs'), original);
  await writeFile(path.join(temp, 'runtime.mjs'), transformed);
  const { OpenAiCompatibleSession: OriginalSession } = await import(pathToFileURL(path.join(temp, 'original.mjs')));
  const { OpenAiCompatibleSession: Session } = await import(pathToFileURL(path.join(temp, 'runtime.mjs')));

  await check('baseline-actually-splits-a-quoted-font', async () => {
    const run = await exercise(OriginalSession, 'node args.cjs "Microsoft YaHei"');
    assert.equal(run.commandItem.exitCode, 0);
    const received = argsOf(run);
    assert.notDeepEqual(received, ['Microsoft YaHei']);
    assert.deepEqual(received, ['"Microsoft', 'YaHei"']);
    return { received, expected: ['Microsoft YaHei'] };
  });
  await check('transform-idempotence-and-partial-patch-rejection', async () => ({ runtimeSha256: sha256(transformed) }));
  const cases = [
    ['unquoted-control', 'node args.cjs alpha beta', ['alpha', 'beta']],
    ['font-name-with-spaces', 'node args.cjs "Microsoft YaHei"', ['Microsoft YaHei']],
    ['chinese-and-space-script-path', 'node ' + quote(spacedScript) + ' "微软雅黑 字体"', ['微软雅黑 字体']],
    ['quoted-executable-and-script', quote(process.execPath) + ' ' + quote(spacedScript) + ' "Microsoft YaHei"', ['Microsoft YaHei']],
    ['multiple-font-role-arguments', 'node args.cjs --role "cover_title:Microsoft YaHei:64:bold" --role "body:思源黑体:28"', ['--role', 'cover_title:Microsoft YaHei:64:bold', '--role', 'body:思源黑体:28']],
    ['python-inline-code', 'python -c "import sys,json; print(json.dumps(sys.argv[1:]))" "Microsoft YaHei" "微软雅黑"', ['Microsoft YaHei', '微软雅黑']],
    ['literal-metacharacters-in-quotes', 'node args.cjs "font & title | body > label"', ['font & title | body > label']],
    ['empty-argument', 'node args.cjs "" "Microsoft YaHei"', ['', 'Microsoft YaHei']],
    ['cmd-environment-expansion', 'node args.cjs "%HARNESS_WORKSPACE_PATH%"', [project]],
  ];
  for (const [name, command, expected] of cases) {
    await check(name, async () => {
      const run = await exercise(Session, command); success(run); assert.deepEqual(argsOf(run), expected);
      return { received: argsOf(run) };
    });
  }
  await check('stdout-redirection-to-chinese-space-path', async () => {
    const file = path.join(project, '输出 结果.json');
    const run = await exercise(Session, 'node args.cjs "Microsoft YaHei" "微软雅黑" > ' + quote(file));
    success(run); assert.equal(run.commandItem.text, '');
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), ['Microsoft YaHei', '微软雅黑']);
  });
  await check('pipe-with-quoted-font', async () => {
    const run = await exercise(Session, 'node args.cjs "Microsoft YaHei" | findstr YaHei');
    success(run); assert.deepEqual(argsOf(run), ['Microsoft YaHei']);
  });
  await check('stderr-redirection-and-command-chaining', async () => {
    const run = await exercise(Session, 'node -e "console.error(\'font-error\')" 2>&1 && echo chained');
    success(run); assert.match(run.commandItem.text, /font-error/); assert.match(run.commandItem.text, /chained/);
  });
  await check('nonzero-exit-is-a-recoverable-tool-failure', async () => {
    const run = await exercise(Session, 'exit /b 7');
    assert.equal(run.commandItem.exitCode, 7); assert.equal(run.commandItem.status, 'failed');
    assert.equal(run.event.toolStats.failedToolCalls, 1); assert.equal(run.event.status, 'completed');
    assert.match(run.result, /Exit code: 7/); assert.equal(run.requests, 2);
  });
  for (const approval of ['ask', 'auto']) {
    await check(approval + '-approval-can-deny-without-execution', async () => {
      const filename = 'denied-' + approval + '.txt';
      const command = 'echo forbidden > ' + filename;
      const run = await exercise(Session, command, { approval, decision: 'deny' });
      const request = run.events.find(event => event.type === 'approval.requested')?.request;
      assert.equal(request?.command, command); assert.equal(request?.cwd, project); assert.equal(request?.kind, 'command');
      assert(!run.events.some(event => event.item?.type === 'command'));
      await assert.rejects(readFile(path.join(project, filename)), { code: 'ENOENT' });
      assert.match(run.result, /did not approve/); assert.equal(run.event.toolStats.failedToolCalls, 1);
    });
  }
  await check('approved-command-keeps-original-user-visible-text', async () => {
    const command = quote(process.execPath) + ' ' + quote(spacedScript) + ' "Microsoft YaHei"';
    const run = await exercise(Session, command, { approval: 'ask', decision: 'approve' });
    success(run); assert.deepEqual(argsOf(run), ['Microsoft YaHei']);
    assert.equal(run.events.find(event => event.type === 'approval.requested').request.command, command);
    assert.equal(run.commandItem.command, command);
  });
  await check('full-access-runs-without-an-approval-prompt', async () => {
    const run = await exercise(Session, 'node args.cjs "Microsoft YaHei"'); success(run);
    assert(!run.events.some(event => event.type === 'approval.requested'));
  });
  await check('interrupt-while-awaiting-approval-does-not-run-command', async () => {
    const run = await exercise(Session, 'echo forbidden > interrupted-approval.txt', { approval: 'ask', onEvent(event, session) {
      if (event.type === 'approval.requested') queueMicrotask(() => session.interrupt());
    } });
    assert.equal(run.event.status, 'interrupted');
    assert(!run.events.some(event => event.item?.type === 'command'));
    await assert.rejects(readFile(path.join(project, 'interrupted-approval.txt')), { code: 'ENOENT' });
  });
  await check('interrupt-a-started-command-before-spawn-listener', async () => {
    const run = await exercise(Session, 'node -e "setTimeout(()=>{},10000)"', { onEvent(event, session) {
      if (event.type === 'item.started' && event.item?.type === 'command') session.interrupt();
    } });
    assert.equal(run.event.status, 'interrupted');
  });
  await check('interrupt-kills-shell-and-running-descendant', async () => {
    const script = path.join(project, 'long-running.cjs');
    await writeFile(script, "require('node:fs').writeFileSync('running.pid', String(process.pid)); setInterval(()=>{},1000);\n");
    let interruptedAt;
    const startedAt = Date.now();
    const run = await exercise(Session, 'node long-running.cjs', { timeoutMs: 10000, onEvent(event, session) {
      if (event.type !== 'item.started' || event.item?.type !== 'command') return;
      const timer = setInterval(async () => {
        let pid;
        try { pid = Number(await readFile(path.join(project, 'running.pid'), 'utf8')); } catch { return; }
        clearInterval(timer); childPids.add(pid); interruptedAt = Date.now(); session.interrupt();
      }, 25);
      timer.unref();
    } });
    assert.equal(run.event.status, 'interrupted'); assert(interruptedAt >= startedAt);
    assert(Date.now() - interruptedAt < 5000, 'Cancellation should complete promptly while the descendant would keep running.');
    const pid = Number(await readFile(path.join(project, 'running.pid'), 'utf8'));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'The command child must not survive interruption.'); childPids.delete(pid);
    return { cancelledInMs: Date.now() - interruptedAt, descendantStopped: true };
  });

  // Exercise a genuinely shipped runtime with no baseline loop anchors too.
  await check('shipped-runtime-upgrades-without-baseline-anchors', async () => {
    const archive = await readAsar(path.join(lane, 'Carb-0.5.14/resources/app.asar'));
    const oldSource = archive.entries.get(runtimePath).toString('utf8');
    const upgraded = patchToolRounds(oldSource);
    assert.equal(patchToolRounds(upgraded), upgraded);
    assert(upgraded.includes('windowsVerbatimArguments: isWindows'));
    // Historical modules have additional relative imports; the command transform
    // itself has already run through the real session above.
    return { beforeSha256: sha256(oldSource), afterSha256: sha256(upgraded) };
  });
  const report = { passed: true, timestamp: new Date().toISOString(), platform: process.platform, node: process.version, source: 'Actual Windows cmd.exe and production API-compatible session; deterministic provider replies, no network or live model.', sourceHashes, cases: checks.length, checks };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(reportPath, JSON.stringify({ passed: false, timestamp: new Date().toISOString(), sourceHashes, checks, error: error.stack || String(error) }, null, 2) + '\n');
  throw error;
} finally {
  for (const session of activeSessions) { session.interrupt(); await session.dispose(); }
  for (const pid of childPids) {
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await new Promise(resolve => { child.once('error', resolve); child.once('close', resolve); });
  }
  await rm(temp, { recursive: true, force: true });
}
