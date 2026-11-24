import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [mainPath] = process.argv.slice(2);
assert(mainPath, 'Usage: node verify-supervisor.mjs <path-to-main.js>');
const source = await readFile(mainPath, 'utf8');
const start = source.indexOf('function restartDelayMs(');
const end = source.indexOf(';function startupSettleDelay(', start);
assert(start >= 0 && end > start, 'Unable to isolate the bundled ServerSupervisor');
const supervisorScript = new vm.Script(
  source.slice(start, end) + '\n; ServerSupervisor;',
  { filename: mainPath },
);

function createChild() {
  let onError;
  let onExit;
  return {
    onError(listener) { onError = listener; },
    onExit(listener) { onExit = listener; },
    fail() { onError(new Error('simulated asynchronous launch failure')); },
    exit() { onExit(1, null); },
  };
}

function createHarness(launch) {
  const timers = new Map();
  const children = [];
  const logs = [];
  let now = 0;
  let nextTimer = 0;
  let starts = 0;
  let exhausted = 0;

  const ServerSupervisor = supervisorScript.runInNewContext({
    Date: { now: () => now },
    setTimeout(callback, delay) {
      const timer = ++nextTimer;
      timers.set(timer, { callback, dueAt: now + delay });
      return timer;
    },
    clearTimeout(timer) { timers.delete(timer); },
  });

  const supervisor = new ServerSupervisor({
    launch() {
      starts += 1;
      launch(starts);
      const child = createChild();
      children.push(child);
      return child;
    },
    onLog(line) { logs.push(line); },
    onGaveUp() { exhausted += 1; },
  });

  return {
    supervisor,
    children,
    logs,
    get starts() { return starts; },
    get exhausted() { return exhausted; },
    get pendingDelays() {
      return [...timers.values()].map(timer => timer.dueAt - now);
    },
    runRetry() {
      assert.equal(timers.size, 1, 'Exactly one retry must be pending');
      const [[id, timer]] = timers;
      timers.delete(id);
      now = timer.dueAt;
      timer.callback();
    },
  };
}

test('a synchronous launch failure logs the error and retries after the delay', () => {
  const harness = createHarness(attempt => {
    if (attempt === 1) throw new Error('simulated utility process failure');
  });
  const { supervisor } = harness;

  assert.doesNotThrow(() => supervisor.start());
  assert.equal(harness.starts, 1);
  assert.match(harness.logs.join('\n'), /simulated utility process failure/);
  assert.deepEqual(harness.pendingDelays, [500]);

  supervisor.start();
  assert.equal(harness.starts, 1, 'start() must respect an active backoff');
  assert.equal(supervisor.restart(), false, 'Manual restart is reserved for exhaustion');
  harness.runRetry();

  assert.equal(harness.starts, 2);
  assert.equal(harness.children.length, 1);
  assert.equal(supervisor.gaveUp, false);
  assert.deepEqual(harness.pendingDelays, []);
});

test('persistent synchronous errors have bounded retries and allow a manual restart', () => {
  let fail = true;
  const harness = createHarness(() => {
    if (fail) throw new Error('simulated persistent launch failure');
  });
  const { supervisor } = harness;

  supervisor.start();
  const expectedDelays = [500, 1000, 2000, 4000, 8000, 15000, 15000, 15000];
  for (const delay of expectedDelays) {
    assert.deepEqual(harness.pendingDelays, [delay]);
    assert.equal(supervisor.gaveUp, false);
    harness.runRetry();
  }

  assert.equal(harness.starts, 9);
  assert.equal(harness.exhausted, 1);
  assert.equal(supervisor.gaveUp, true);
  assert.deepEqual(harness.pendingDelays, []);

  supervisor.start();
  assert.equal(harness.starts, 9, 'start() must not bypass exhaustion');
  fail = false;
  assert.equal(supervisor.restart(), true);
  assert.equal(harness.starts, 10);
  assert.equal(harness.children.length, 1);
  assert.equal(supervisor.gaveUp, false);
  assert.equal(supervisor.restart(), false);
});

test('error and exit for the same child schedule just one retry', () => {
  for (const [first, second] of [['fail', 'exit'], ['exit', 'fail']]) {
    const harness = createHarness(() => {});
    harness.supervisor.start();
    const [child] = harness.children;

    child[first]();
    child[second]();
    assert.deepEqual(harness.pendingDelays, [500]);
    assert.equal(harness.starts, 1);
    harness.runRetry();
    assert.equal(harness.starts, 2);

    child[first]();
    child[second]();
    assert.deepEqual(harness.pendingDelays, [], 'Late events from an old child must be ignored');
  }
});

test('stop cancels the pending backoff and prevents future starts', async () => {
  const harness = createHarness(() => {});
  const { supervisor } = harness;
  supervisor.start();
  const [child] = harness.children;
  child.exit();
  assert.deepEqual(harness.pendingDelays, [500]);

  await supervisor.stop();
  assert.deepEqual(harness.pendingDelays, []);
  child.fail();
  supervisor.start();
  assert.equal(supervisor.restart(), false);
  assert.equal(harness.starts, 1);
  assert.deepEqual(harness.pendingDelays, []);
});
