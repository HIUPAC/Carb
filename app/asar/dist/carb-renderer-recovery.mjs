const RETRY_DELAYS_MS = [300, 1000];
const STABLE_LOAD_MS = 30_000;

export function configureRendererLifecycle(contents, options) {
  let generation = 0;
  let retryCount = 0;
  let retryTimer;
  let stableTimer;
  let awaitingRetry = false;

  function inactive() {
    return options.isQuitting() || contents.isDestroyed();
  }

  function loadFailed(failure) {
    if (inactive() || retryTimer !== undefined || awaitingRetry) return;
    generation += 1;
    clearTimeout(stableTimer);
    options.cancelCaptures();
    options.onFailure(failure);

    if (retryCount === RETRY_DELAYS_MS.length) {
      awaitingRetry = true;
      const failedGeneration = generation;
      options.onRepeatedCrash(failure, () => {
        if (!awaitingRetry || generation !== failedGeneration || inactive()) return;
        awaitingRetry = false;
        retryCount = 0;
        void loadPage();
      });
      return;
    }

    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void loadPage();
    }, RETRY_DELAYS_MS[retryCount++]);
  }

  async function loadPage() {
    if (inactive()) return;
    const activeGeneration = ++generation;
    clearTimeout(stableTimer);
    try {
      await options.loadPage();
    } catch (error) {
      if (generation === activeGeneration) {
        const code = typeof error?.code === 'string' && /^ERR_[A-Z0-9_]+$/.test(error.code)
          ? error.code
          : 'LOAD_FAILED';
        loadFailed({ kind: 'load', reason: code });
      }
      return;
    }
    if (generation !== activeGeneration || inactive()) return;
    stableTimer = setTimeout(() => {
      stableTimer = undefined;
      retryCount = 0;
    }, STABLE_LOAD_MS);
  }

  contents.on('did-navigate', () => {
    options.cancelCaptures();
    options.onPageReplaced();
  });
  contents.on('destroyed', () => {
    generation += 1;
    clearTimeout(retryTimer);
    clearTimeout(stableTimer);
    options.cancelCaptures();
  });
  contents.on('render-process-gone', (_event, details) => {
    loadFailed({ kind: 'renderer', reason: details.reason, exitCode: details.exitCode });
  });
  return () => { void loadPage(); };
}
