import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { configureRendererLifecycle } from '../../app/asar/dist/carb-renderer-recovery.mjs';

function prepare(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const contents = new EventEmitter();
  const loads = [];
  const failures = [];
  const prompts = [];
  const effects = { cancelled: 0, replaced: 0 };
  let destroyed = false;
  let quitting = false;
  contents.isDestroyed = () => destroyed;

  const start = configureRendererLifecycle(contents, {
    isQuitting: () => quitting,
    cancelCaptures() { effects.cancelled += 1; },
    onPageReplaced() { effects.replaced += 1; },
    onFailure(failure) { failures.push(failure); },
    onRepeatedCrash(failure, retry) { prompts.push({ failure, retry }); },
    loadPage() {
      const request = Promise.withResolvers();
      loads.push(request);
      return request.promise;
    },
  });

  return {
    contents,
    effects,
    failures,
    loads,
    prompts,
    start,
    crash() { contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 17 }); },
    destroy() {
      destroyed = true;
      contents.emit('destroyed');
    },
    quit() { quitting = true; },
    async rejectLoad(index, code) {
      loads[index].reject(Object.assign(new Error('Navigation failed'), { code }));
      await Promise.resolve();
    },
    async finishLoad(index) {
      loads[index].resolve();
      await Promise.resolve();
    },
    async advance(ms) {
      t.mock.timers.tick(ms);
      await Promise.resolve();
    },
  };
}

test('load rejection backs off twice, then prompts and accepts one manual retry', async t => {
  const app = prepare(t);

  app.start();
  await app.rejectLoad(0, 'ERR_FILE_NOT_FOUND');
  assert.deepEqual(app.failures, [{ kind: 'load', reason: 'ERR_FILE_NOT_FOUND' }]);
  await app.advance(299);
  assert.equal(app.loads.length, 1);
  await app.advance(1);
  assert.equal(app.loads.length, 2);

  await app.rejectLoad(1, 'other error text');
  assert.deepEqual(app.failures[1], { kind: 'load', reason: 'LOAD_FAILED' });
  await app.advance(999);
  assert.equal(app.loads.length, 2);
  await app.advance(1);
  assert.equal(app.loads.length, 3);

  await app.rejectLoad(2, 'ERR_FAILED');
  assert.equal(app.prompts.length, 1);
  assert.deepEqual(app.prompts[0].failure, { kind: 'load', reason: 'ERR_FAILED' });
  assert.equal(app.effects.cancelled, 3);
  await app.advance(60_000);
  assert.equal(app.loads.length, 3);

  app.prompts[0].retry();
  app.prompts[0].retry();
  assert.equal(app.loads.length, 4);
  await app.rejectLoad(3, 'ERR_FAILED');
  await app.advance(300);
  assert.equal(app.loads.length, 5);
  assert.equal(app.prompts.length, 1);
});

test('renderer crash supersedes its pending load and deduplicates a late rejection', async t => {
  const app = prepare(t);

  app.start();
  app.crash();
  app.crash();
  await app.advance(300);
  assert.equal(app.loads.length, 2);
  await app.rejectLoad(0, 'ERR_ABORTED');
  await app.finishLoad(1);
  await app.advance(5000);

  assert.deepEqual(app.failures, [{ kind: 'renderer', reason: 'crashed', exitCode: 17 }]);
  assert.equal(app.effects.cancelled, 1);
  assert.equal(app.prompts.length, 0);
  assert.equal(app.loads.length, 2);
});

test('30 seconds of successful load restore both automatic attempts', async t => {
  const app = prepare(t);

  app.start();
  await app.rejectLoad(0, 'ERR_FAILED');
  await app.advance(300);
  await app.rejectLoad(1, 'ERR_FAILED');
  await app.advance(1000);
  await app.finishLoad(2);

  await app.advance(30_000);
  app.crash();
  await app.advance(299);
  assert.equal(app.loads.length, 3);
  await app.advance(1);
  assert.equal(app.loads.length, 4);
  app.crash();
  await app.advance(999);
  assert.equal(app.loads.length, 4);
  await app.advance(1);
  assert.equal(app.loads.length, 5);
  app.crash();

  assert.equal(app.prompts.length, 1);
  assert.deepEqual(app.prompts[0].failure, { kind: 'renderer', reason: 'crashed', exitCode: 17 });
});

test('an early crash interrupts the stability window and preserves the spent budget', async t => {
  const app = prepare(t);

  app.start();
  await app.rejectLoad(0, 'ERR_FAILED');
  await app.advance(300);
  await app.rejectLoad(1, 'ERR_FAILED');
  await app.advance(1000);
  await app.finishLoad(2);

  await app.advance(29_999);
  app.crash();
  assert.equal(app.prompts.length, 1);
  await app.advance(1000);
  assert.equal(app.loads.length, 3);
});

test('destroyed contents cancel captures and stop a queued retry', async t => {
  const app = prepare(t);

  app.start();
  await app.rejectLoad(0, 'ERR_FAILED');
  app.destroy();
  app.start();
  app.crash();
  await app.advance(1000);

  assert.equal(app.effects.cancelled, 2);
  assert.equal(app.failures.length, 1);
  assert.equal(app.loads.length, 1);
  assert.equal(app.prompts.length, 0);
});

test('quitting prevents pending retries and ignores late load rejection', async t => {
  const app = prepare(t);

  app.start();
  app.crash();
  app.quit();
  await app.rejectLoad(0, 'ERR_ABORTED');
  await app.advance(1000);
  app.start();
  app.crash();

  assert.equal(app.effects.cancelled, 1);
  assert.equal(app.failures.length, 1);
  assert.equal(app.loads.length, 1);
  assert.equal(app.prompts.length, 0);
});

for (const stop of ['destroy', 'quit']) {
  test('manual retry from an existing prompt has no effect after ' + stop, async t => {
    const app = prepare(t);

    app.start();
    app.crash();
    await app.advance(300);
    app.crash();
    await app.advance(1000);
    app.crash();
    assert.equal(app.prompts.length, 1);

    app[stop]();
    app.prompts[0].retry();
    await app.advance(30_000);

    assert.equal(app.loads.length, 3);
    assert.equal(app.failures.length, 3);
  });
}

test('navigation still cancels captures and records replacement', async t => {
  const app = prepare(t);

  app.start();
  app.contents.emit('did-navigate');
  await app.finishLoad(0);
  app.contents.emit('did-navigate');

  assert.deepEqual(app.effects, { cancelled: 2, replaced: 2 });
  assert.equal(app.failures.length, 0);
  assert.equal(app.loads.length, 1);
});
