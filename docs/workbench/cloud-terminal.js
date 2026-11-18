import { validPath } from './project.js';

const $ = id => document.getElementById(id);
const cli = {
  codex: 'if command -v codex >/dev/null; then codex; else npx --yes @openai/codex@0.169.1; fi',
  claude: 'if command -v claude >/dev/null; then claude; else npx --yes @anthropic-ai/claude-code@2.1.327; fi'
};

function loadScript(path) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(path, import.meta.url);
    script.onload = resolve;
    script.onerror = () => { script.remove(); reject(new Error('终端组件加载失败，请重试。')); };
    document.head.append(script);
  });
}

let assets;
function loadAssets() {
  assets ??= Promise.all([loadScript('./vendor/xterm.js'), loadScript('./vendor/addon-fit.js')])
    .catch(error => { assets = null; throw error; });
  return assets;
}

function workspaceTerminal({ token, cols, rows, onData, onExit, onError, signal }) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL('/_carb/terminal', location.href);
    endpoint.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(endpoint);
    let connected = false;
    let ended = false;
    const timeout = setTimeout(() => fail(new Error('连接云工作区超时。')), 13000);
    function send(message) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    }
    function close() {
      ended = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      socket.close();
    }
    function fail(error) {
      if (ended) return;
      close();
      if (connected) onError(error);
      else reject(error);
    }
    const abort = () => fail(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) return abort();
    socket.onopen = () => send({ type: 'start', token, cols, rows });
    socket.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'ready') {
        clearTimeout(timeout);
        connected = true;
        resolve({
          write: data => send({ type: 'input', data }),
          resize: (cols, rows) => send({ type: 'resize', cols, rows }),
          close
        });
      } else if (message.type === 'data' && typeof message.data === 'string') {
        onData(message.data);
      } else if (message.type === 'exit') {
        close();
        onExit(message.exitCode);
      } else if (message.type === 'error') {
        fail(new Error(message.message || '连接云工作区失败。'));
      }
    };
    socket.onerror = () => fail(new Error('无法连接云工作区终端。'));
    socket.onclose = () => {
      if (!ended) fail(new Error('云工作区连接已断开。'));
    };
  });
}

export function setupCloudTerminal({ getFiles, download, toast }) {
  let credential = new URLSearchParams(location.hash.slice(1)).get('terminal-token') || '';
  if (credential) history.replaceState(history.state, '', location.pathname + location.search);
  let terminal;
  let fit;
  let client;
  let pending;
  let privateWorkspace = false;
  let activated = false;

  const display = message => { $('cloud-description').textContent = message; };
  function showError(message = '') {
    $('cloud-error').textContent = message;
    $('cloud-error').hidden = !message;
  }
  function updateActions() {
    $('cloud-intro').hidden = Boolean(privateWorkspace || client);
    $('cloud-actions').hidden = !privateWorkspace && !client;
    $('cloud-reconnect').hidden = !privateWorkspace || Boolean(client);
    $('cloud-close').disabled = !client;
    $('launch-cli').disabled = !client;
    $('cloud-files').hidden = !(client?.writeFiles && client?.readFile);
  }
  async function end(message, error) {
    pending?.abort();
    pending = null;
    const active = client;
    client = null;
    updateActions();
    display(message);
    if (error) showError(error.message || String(error));
    if (active) {
      try { await active.close(); }
      catch { showError('终端已断开，云环境将在会话到期后释放。'); }
    }
  }
  function refit() {
    if (fit && !$('terminal').hidden && !$('cloud-pty').hidden) fit.fit();
  }
  function send(action, ...args) {
    try { Promise.resolve(client?.[action](...args)).catch(error => showError(error.message)); }
    catch (error) { showError(error.message); }
  }
  async function prepareTerminal() {
    await loadAssets();
    $('cloud-pty').hidden = false;
    if (!terminal) {
      terminal = new window.Terminal({
        fontFamily: '"Cascadia Code", Consolas, monospace', fontSize: 13, scrollback: 3000,
        cursorBlink: true, convertEol: false, theme: { background: '#191d19', foreground: '#e7ece4', cursor: '#d9edba' }
      });
      fit = new window.FitAddon.FitAddon();
      terminal.loadAddon(fit);
      terminal.open($('cloud-pty'));
      terminal.onData(data => send('write', data));
      terminal.onResize(({ cols, rows }) => send('resize', cols, rows));
      new ResizeObserver(refit).observe($('cloud-pty'));
    } else terminal.reset();
    refit();
  }
  async function connect(value) {
    if (client || pending || !value) return;
    const controller = new AbortController();
    pending = controller;
    $('e2b-start').disabled = true;
    $('cloud-reconnect').disabled = true;
    $('cloud-pair').hidden = true;
    showError();
    display(privateWorkspace ? '正在连接 GitHub 云工作区…' : '正在启动 E2B 云环境…');
    try {
      await prepareTerminal();
      const options = {
        cols: Math.max(20, terminal.cols), rows: Math.max(5, terminal.rows), signal: controller.signal,
        onData: data => terminal.write(data),
        onExit: code => end('终端已退出' + (Number.isInteger(code) ? '（' + code + '）。' : '。')),
        onError: error => end('终端已断开。', error)
      };
      const connection = privateWorkspace ? await workspaceTerminal({ ...options, token: value }) :
        await (await import('./cloud-e2b.js')).connectE2B({ ...options, apiKey: value });
      if (controller.signal.aborted) {
        await connection.close();
        return;
      }
      client = connection;
      updateActions();
      display(privateWorkspace ? '已连接 GitHub 云工作区。' : '已连接 E2B 云端终端。');
      terminal.focus();
    } catch (error) {
      if (!controller.signal.aborted) {
        showError(error.message || '连接失败。');
        display('未连接云端终端。');
        if (privateWorkspace) {
          credential = '';
          $('cloud-pair').hidden = false;
        }
        $('cloud-pty').hidden = true;
      }
    } finally {
      if (pending === controller) pending = null;
      $('e2b-start').disabled = false;
      $('cloud-reconnect').disabled = false;
    }
  }
  async function activate() {
    if (activated) { refit(); return; }
    activated = true;
    const pagesHost = ['houpac.top', 'www.houpac.top', 'hiupac.github.io'].includes(location.hostname);
    if (!pagesHost) {
      try {
        const status = await fetch(new URL('/_carb/status', location.href), { cache: 'no-store', signal: AbortSignal.timeout(3500) });
        if (status.ok && status.headers.get('content-type')?.includes('application/json')) privateWorkspace = (await status.json()).cloud === true;
      } catch {}
    }
    updateActions();
    if (!privateWorkspace) {
      credential = '';
      display('连接云执行环境，直接在浏览器里使用终端和 CLI。');
    } else if (credential) await connect(credential);
    else {
      $('cloud-pair').hidden = false;
      display('输入云工作区终端给出的 Carb 连接码。');
    }
  }

  $('cloud-reconnect').onclick = () => credential ? connect(credential) : ($('cloud-pair').hidden = false);
  $('cloud-close').onclick = () => end('会话已结束。');
  $('cloud-pair').onsubmit = event => {
    event.preventDefault();
    credential = $('cloud-token').value.trim();
    $('cloud-token').value = '';
    connect(credential);
  };
  $('e2b-form').onsubmit = event => {
    event.preventDefault();
    const apiKey = $('e2b-key').value.trim();
    $('e2b-key').value = '';
    connect(apiKey);
  };
  $('launch-cli').onclick = () => {
    const selection = $('cli-select').value;
    const command = cli[selection];
    if (!client || !command) return;
    if (!confirm('请确认终端当前停在 shell 提示符。所选 CLI 首次启动时会下载客户端，并提示你登录或配置模型凭据。')) return;
    send('write', command + '\r');
    terminal.focus();
  };
  $('cloud-upload').onclick = async () => {
    const files = [...getFiles()].map(([path, blob]) => ({ path, blob }));
    if (!client?.writeFiles || !files.length) return toast('当前项目没有可上传的文件。');
    if (!confirm('将当前项目的 ' + files.length + ' 个文件上传到你的 E2B 会话？云端的同名文件会被覆盖。')) return;
    $('cloud-upload').disabled = true;
    try {
      await client.writeFiles(files);
      toast('项目文件已上传。');
    } catch (error) { showError(error.message); }
    finally { $('cloud-upload').disabled = false; }
  };
  $('cloud-download').onsubmit = async event => {
    event.preventDefault();
    if (!client?.readFile || event.submitter?.disabled) return;
    if (event.submitter) event.submitter.disabled = true;
    try {
      const path = validPath($('cloud-download-path').value.trim());
      const data = await client.readFile(path);
      download(data instanceof Blob ? data : new Blob([data]), path.split('/').pop());
    } catch (error) { showError(error.message); }
    finally { if (event.submitter) event.submitter.disabled = false; }
  };
  addEventListener('pagehide', () => {
    if (client || pending) void end('会话已结束。');
  });
  return { activate, paired: Boolean(credential) };
}
