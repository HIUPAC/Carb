const versions = ['2025-11-25', '2025-06-18', '2025-03-26'];
const maxResponseBytes = 4 * 1024 * 1024;
const maxToolPages = 20;
const maxTools = 1000;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function endpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请输入完整的 MCP HTTPS 地址，例如 https://example.com/mcp。');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('MCP 地址须使用 HTTPS，且不能包含账号、密码或网址片段。');
  }
  if ([...url.searchParams.keys()].some(name => /^(?:key|api[-_]?key|token|access[-_]?token|auth(?:orization)?|password|secret)$/i.test(name))) {
    throw new Error('请将凭据填写在 Bearer 令牌输入框中。');
  }
  return url.href;
}

function withTimeout(signal, milliseconds) {
  return AbortSignal.any([AbortSignal.timeout(milliseconds), ...(signal ? [signal] : [])]);
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function* responseChunks(response, signal) {
  if (!response.body) throw new Error('MCP 服务返回了空响应。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxResponseBytes) throw new Error('单次 MCP 响应超过 4 MB。');
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

async function* responseLines(response, signal) {
  let buffer = '';
  for await (const chunk of responseChunks(response, signal)) {
    buffer += chunk;
    let start = 0;
    for (const br of buffer.matchAll(/\r\n|\r(?!$)|\n/g)) {
      yield buffer.slice(start, br.index);
      start = br.index + br[0].length;
    }
    buffer = buffer.slice(start);
  }
  if (buffer.endsWith('\r')) yield buffer.slice(0, -1);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('MCP 服务返回了无效的 JSON。');
  }
}

async function parseBody(response, signal) {
  let text = '';
  for await (const chunk of responseChunks(response, signal)) text += chunk;
  return parseJson(text);
}

function removeCredentials(value, credentials) {
  if (typeof value === 'string') {
    for (const credential of credentials) if (credential) value = value.replaceAll(credential, '[已隐藏]');
    return value;
  }
  if (Array.isArray(value)) return value.map(item => removeCredentials(item, credentials));
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      removeCredentials(key, credentials), removeCredentials(item, credentials)
    ]));
  }
  return value;
}

export class McpConnection {
  #url;
  #token;
  #session = '';
  #version = '';
  #id = 0;
  #connection;
  #initializing;
  #supportsTools = false;
  #lifetime = new AbortController();

  constructor({ url, token = '' }) {
    this.#url = endpoint(url);
    if (typeof token !== 'string' || !/^[A-Za-z0-9_~+.\/-]*=*$/.test(token = token.trim()) || token.length > 8192) {
      throw new Error('请输入有效的 Bearer 令牌。');
    }
    this.#token = token;
  }

  async #fetch(method, signal, body, lastEventId) {
    const headers = { Accept: method === 'GET' ? 'text/event-stream' : 'application/json, text/event-stream' };
    if (body) headers['Content-Type'] = 'application/json';
    if (this.#token) headers.Authorization = 'Bearer ' + this.#token;
    if (this.#session) headers['MCP-Session-Id'] = this.#session;
    if (this.#version) headers['MCP-Protocol-Version'] = this.#version;
    if (lastEventId) headers['Last-Event-ID'] = lastEventId;
    let response;
    try {
      response = await fetch(this.#url, {
        method, headers, body, signal, mode: 'cors', credentials: 'omit', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer'
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw new Error('无法连接 MCP 服务。请核对地址和网络，并确认服务允许本网页跨域访问（CORS）且地址没有重定向。', { cause: error });
    }
    if (response.ok || method === 'DELETE' && (response.status === 404 || response.status === 405)) return response;

    void response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) {
      throw new Error('MCP 服务拒绝访问。请确认 Bearer 令牌和权限；网页暂不支持 OAuth 授权跳转。');
    }
    if (response.status === 404 && this.#session) {
      this.#session = '';
      this.#version = '';
      this.#connection = undefined;
      throw new Error('MCP 会话已过期，请重新连接后再调用。');
    }
    if (response.status === 400 && !this.#session && this.#version) {
      throw new Error('MCP 服务拒绝了会话请求。请确认服务通过 Access-Control-Expose-Headers 暴露 MCP-Session-Id。');
    }
    throw new Error('MCP 服务返回 HTTP ' + response.status + '。请确认此地址支持 Streamable HTTP。');
  }

  async #send(message, signal) {
    const response = await this.#fetch('POST', signal, JSON.stringify({ jsonrpc: '2.0', ...message }));
    void response.body?.cancel().catch(() => {});
    if (response.status !== 202 && response.status !== 204) {
      throw new Error('MCP 服务未接受协议通知。');
    }
  }

  async #readEventStream(response, requestId, cursor, signal) {
    let data = [];
    let eventId;
    for await (const line of responseLines(response, signal)) {
      if (!line) {
        if (eventId !== undefined) cursor.id = eventId;
        if (data.some(Boolean)) {
          const message = parseJson(data.join('\n'));
          if (message?.jsonrpc === '2.0' && Object.hasOwn(message, 'id')) {
            if (message.method === 'ping') {
              await this.#send({ id: message.id, result: {} }, signal);
            } else if (typeof message.method === 'string') {
              await this.#send({ id: message.id, error: { code: -32601, message: 'Method not found' } }, signal);
            } else if (message.id === requestId) {
              return message;
            }
          }
        }
        data = [];
        eventId = undefined;
        continue;
      }
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'data') data.push(value);
      else if (field === 'id' && /^[\x20-\x7e]*$/.test(value) && value.length <= 8192) eventId = value;
      else if (field === 'retry' && /^\d+$/.test(value)) cursor.retry = Number(value);
    }
  }

  async #readResponse(response, id, signal) {
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (type === 'application/json') return parseBody(response, signal);
    if (type !== 'text/event-stream') {
      void response.body?.cancel().catch(() => {});
      throw new Error('MCP 服务没有返回 JSON 或 SSE。请填写 Streamable HTTP 接口地址。');
    }
    const cursor = { id: '', retry: 1000 };
    let message = await this.#readEventStream(response, id, cursor, signal);
    for (let retry = 0; message === undefined && cursor.id && retry < 2; retry++) {
      await pause(Math.min(cursor.retry, 120000), signal);
      const resumed = await this.#fetch('GET', signal, undefined, cursor.id);
      if (!resumed.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
        void resumed.body?.cancel().catch(() => {});
        break;
      }
      message = await this.#readEventStream(resumed, id, cursor, signal);
    }
    if (message === undefined) throw new Error('MCP 事件流已结束，未收到结果。请检查服务端任务状态。');
    return message;
  }

  async #request(method, params, external, milliseconds = 30000) {
    const signal = withTimeout(AbortSignal.any([this.#lifetime.signal, ...(external ? [external] : [])]), milliseconds);
    signal.throwIfAborted();
    const id = ++this.#id;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    if (body.length > 1024 * 1024) throw new Error('单次 MCP 请求参数超过 1 MB。');
    try {
      const response = await this.#fetch('POST', signal, body);
      if (method === 'initialize') {
        const session = response.headers.get('MCP-Session-Id');
        if (session !== null && (!/^[\x21-\x7e]+$/.test(session) || session.length > 8192)) {
          void response.body?.cancel().catch(() => {});
          throw new Error('MCP 服务返回了无效的会话 ID。');
        }
        this.#session = session || '';
      }
      const envelope = await this.#readResponse(response, id, signal);
      if (!isObject(envelope) || envelope.jsonrpc !== '2.0' || envelope.id !== id) {
        throw new Error('MCP 返回的结果与当前请求不匹配。');
      }
      if (isObject(envelope.error)) {
        const error = removeCredentials(envelope.error, [this.#token, this.#session]);
        const detail = typeof error.message === 'string' ? '：' + error.message.slice(0, 500) : '。';
        throw new Error('MCP 请求失败' + detail);
      }
      if (!Object.hasOwn(envelope, 'result')) throw new Error('MCP 服务未返回结果。');
      return envelope.result;
    } catch (error) {
      if (signal.aborted && method !== 'initialize' && this.#version && !this.#lifetime.signal.aborted) {
        void this.#send({ method: 'notifications/cancelled', params: { requestId: id } }, AbortSignal.timeout(3000)).catch(() => {});
      }
      if (signal.reason?.name === 'TimeoutError' && !external?.aborted) {
        throw new Error('等待 MCP 响应超时。请检查服务端的任务状态。');
      }
      throw error;
    }
  }

  async #initialize(signal) {
    try {
      const initialized = await this.#request('initialize', {
        protocolVersion: versions[0], capabilities: {}, clientInfo: { name: 'Carb Workbench', version: '1.0.0' }
      }, signal);
      if (!isObject(initialized) || !versions.includes(initialized.protocolVersion) ||
          !isObject(initialized.capabilities) || typeof initialized.serverInfo?.name !== 'string') {
        throw new Error('服务端返回的 MCP 版本或初始化信息不受支持。');
      }
      this.#version = initialized.protocolVersion;
      this.#supportsTools = isObject(initialized.capabilities.tools);
      const alive = AbortSignal.any([this.#lifetime.signal, ...(signal ? [signal] : [])]);
      await this.#send({ method: 'notifications/initialized' }, withTimeout(alive, 30000));
      const tools = await this.#discoverTools(alive);
      alive.throwIfAborted();
      this.#connection = { serverInfo: removeCredentials(initialized.serverInfo, [this.#token, this.#session]), tools };
      return this.#connection;
    } catch (error) {
      await this.#endSession();
      throw error;
    } finally {
      this.#initializing = undefined;
    }
  }

  async connect(signal) {
    this.#lifetime.signal.throwIfAborted();
    signal?.throwIfAborted();
    if (this.#connection) return this.#connection;
    this.#initializing ??= this.#initialize(signal);
    return this.#initializing;
  }

  async #discoverTools(signal) {
    if (!this.#supportsTools) return [];
    const tools = new Map();
    const cursors = new Set();
    let cursor;
    for (let page = 0; page < maxToolPages; page++) {
      const result = await this.#request('tools/list', cursor ? { cursor } : undefined, signal);
      if (!Array.isArray(result?.tools)) throw new Error('MCP 服务返回了无效的工具列表。');
      for (const candidate of result.tools) {
        if (!isObject(candidate) || typeof candidate.name !== 'string' || !candidate.name ||
            candidate.name.length > 128 || !isObject(candidate.inputSchema)) {
          throw new Error('MCP 服务返回了无效的工具定义。');
        }
        const clean = removeCredentials(candidate, [this.#token, this.#session]);
        if (clean.name !== candidate.name || tools.has(clean.name)) throw new Error('MCP 工具名称无效或重复。');
        tools.set(clean.name, clean);
      }
      if (tools.size > maxTools) throw new Error('MCP 服务的工具数量超过 1000 个。');
      cursor = result.nextCursor;
      if (cursor === undefined) return [...tools.values()];
      if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) throw new Error('MCP 工具列表的分页信息无效。');
      cursors.add(cursor);
    }
    throw new Error('MCP 工具列表分页超过 20 页。');
  }

  async listTools(signal) {
    if (!this.#connection) return (await this.connect(signal)).tools;
    const tools = await this.#discoverTools(signal);
    if (this.#connection) this.#connection.tools = tools;
    return tools;
  }

  async callTool(name, args = {}, signal) {
    const { tools } = await this.connect(signal);
    if (!tools.some(tool => tool.name === name)) throw new Error('该工具不在当前 MCP 服务的工具列表中。');
    if (!isObject(args)) throw new Error('MCP 工具参数须为 JSON 对象。');
    const result = await this.#request('tools/call', { name, arguments: args }, signal, 120000);
    if (!isObject(result)) throw new Error('MCP 服务返回了无效的工具调用结果。');
    return removeCredentials(result, [this.#token, this.#session]);
  }

  async #endSession(signal) {
    const termination = this.#session ? this.#fetch('DELETE', withTimeout(signal, 4000)) : null;
    this.#session = '';
    this.#version = '';
    this.#connection = undefined;
    this.#supportsTools = false;
    try {
      const response = await termination;
      void response?.body?.cancel().catch(() => {});
    } catch {
      // A server may keep its session until expiry when termination is unavailable.
    }
  }

  async close(signal) {
    this.#lifetime.abort();
    await this.#endSession(signal);
    this.#token = '';
  }
}
