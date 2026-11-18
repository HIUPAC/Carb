import { validPath } from './project.js';

const workspace = '/home/user/carb-project';
const lifetime = 15 * 60 * 1000;
const transferLimit = 100 * 1024 * 1024;
const encoder = new TextEncoder();

function terminalSize(cols, rows) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 1000 || rows > 500) {
    throw new Error('终端尺寸无效。');
  }
  return { cols, rows };
}

function shellArg(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function describeFailure(error) {
  if (error?.name === 'AuthenticationError') return new Error('E2B 密钥无效，请在设置中核对后重试。');
  if (error?.name === 'RateLimitError') return new Error('已达到 E2B 并发或请求上限，请稍后重试。');
  if (error?.name === 'TimeoutError') return new Error('E2B 请求超时，请检查网络或重新启动云端终端。');
  return new Error('无法访问 E2B 云端终端，请检查网络和账号配额后重试。');
}

export async function connectE2B({ apiKey, cols, rows, onData, onExit, onError, signal }) {
  const key = apiKey?.trim();
  if (!key) throw new Error('请填写 E2B API 密钥。');
  const size = terminalSize(cols, rows);
  signal?.throwIfAborted();
  const { Sandbox } = await import('./vendor/e2b-browser.js');
  signal?.throwIfAborted();

  let sandbox;
  let terminal;
  let closing;
  let stopped = false;
  let writes = Promise.resolve();
  let queuedBytes = 0;

  function close() {
    if (closing) return closing;
    stopped = true;
    signal?.removeEventListener('abort', abort);
    closing = (async () => {
      await terminal?.disconnect().catch(() => {});
      await sandbox.kill();
    })().catch(() => {
      closing = undefined;
      throw new Error('无法确认云端环境已停止。环境将在创建后十五分钟内自动结束。');
    });
    return closing;
  }

  function abort() {
    void close().catch(reason => onError?.(reason));
  }

  function assertConnected() {
    if (stopped) throw new Error('云端终端已断开。');
  }

  async function ensureWorkspacePath(path) {
    try {
      const q = shellArg(path);
      await sandbox.commands.run(`test "$(realpath -m -- ${q})" = ${q}`, { timeoutMs: 5000, signal });
    } catch (error) {
      if (typeof error.exitCode === 'number') throw new Error('云端路径经过符号链接，请选择项目内的普通文件。');
      if (signal?.aborted) throw signal.reason;
      throw describeFailure(error);
    }
  }

  try {
    // Creation can succeed on the service before a request is aborted. Let the
    // short creation request settle so an abandoned sandbox can be destroyed.
    sandbox = await Sandbox.create({
      apiKey: key,
      apiUrl: 'https://api.e2b.dev',
      secure: true,
      timeoutMs: lifetime,
      requestTimeoutMs: 15000,
      lifecycle: { onTimeout: 'kill' },
      network: { allowPublicTraffic: false },
      idempotencyKey: crypto.randomUUID(),
      metadata: { client: 'carb-web' }
    });
    signal?.throwIfAborted();
    signal?.addEventListener('abort', abort, { once: true });
    await sandbox.files.makeDir(workspace, { signal });
    terminal = await sandbox.pty.create({
      ...size,
      cwd: workspace,
      timeoutMs: lifetime,
      signal,
      onData: data => { if (!stopped) onData?.(data); }
    });
    signal?.throwIfAborted();
  } catch (error) {
    if (sandbox) await close().catch(reason => onError?.(reason));
    if (signal?.aborted) throw signal.reason;
    throw describeFailure(error);
  }

  void (async () => {
    let exitCode;
    try {
      exitCode = (await terminal.wait()).exitCode;
    } catch (error) {
      if (stopped) return;
      if (typeof error.exitCode === 'number') exitCode = error.exitCode;
      else onError?.(describeFailure(error));
    }
    if (stopped) return;
    await close().catch(reason => onError?.(reason));
    if (typeof exitCode === 'number') onExit?.(exitCode);
  })();

  return {
    cwd: workspace,
    async write(data) {
      assertConnected();
      const bytes = typeof data === 'string' ? encoder.encode(data) : data;
      if (!(bytes instanceof Uint8Array)) return Promise.reject(new Error('终端输入必须为文本或字节。'));
      if (!bytes.length) return Promise.resolve();
      if (queuedBytes + bytes.length > 65536) return Promise.reject(new Error('一次输入过长，请分段粘贴。'));
      queuedBytes += bytes.length;
      const send = writes.then(async () => {
        assertConnected();
        await sandbox.pty.sendInput(terminal.pid, bytes, { signal }).catch(error => { throw describeFailure(error); });
      }).finally(() => { queuedBytes -= bytes.length; });
      writes = send.catch(() => {});
      return send;
    },
    async resize(cols, rows) {
      if (stopped) return;
      try {
        await sandbox.pty.resize(terminal.pid, terminalSize(cols, rows), { signal });
      } catch (error) {
        if (!stopped) throw describeFailure(error);
      }
    },
    async writeFiles(entries) {
      assertConnected();
      if (!Array.isArray(entries) || entries.length > 1500) throw new Error('一次最多上传 1500 个文件。');
      const checked = entries.map(({ path, blob }) => {
        if (!(blob instanceof Blob)) throw new Error('项目文件内容无效。');
        return { path: `${workspace}/${validPath(path)}`, blob };
      });
      if (checked.reduce((total, entry) => total + entry.blob.size, 0) > transferLimit) throw new Error('一次最多上传 100 MB。');
      let written = 0;
      for (const { path, blob } of checked) {
        assertConnected();
        await ensureWorkspacePath(path);
        try {
          await sandbox.files.write(path, blob, { signal });
          written++;
        } catch (error) {
          throw new Error(`已上传 ${written} 个文件。${describeFailure(error).message}`);
        }
      }
      return written;
    },
    async readFile(path) {
      assertConnected();
      const file = `${workspace}/${validPath(path)}`;
      await ensureWorkspacePath(file);
      let reader;
      try {
        const stream = await sandbox.files.read(file, { format: 'stream', signal });
        reader = stream.getReader();
        const chunks = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return new Blob(chunks);
          size += value.byteLength;
          if (size > transferLimit) {
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      } catch (error) {
        if (error?.name === 'FileNotFoundError') throw new Error('找不到指定的云端文件。');
        throw describeFailure(error);
      } finally {
        reader?.releaseLock();
      }
      throw new Error('单次下载的文件不能超过 100 MB。');
    },
    close
  };
}
