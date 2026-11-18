import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import nodePty from 'node-pty';
import { WebSocket, WebSocketServer } from 'ws';

const { values: options } = parseArgs({ options: {
  local: { type: 'boolean' },
  port: { type: 'string' },
  cwd: { type: 'string' },
} });

const port = Number(options.port ?? process.env.PORT ?? '4180');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a port between 1024 and 65535.');
const isLocal = options.local === true;
const codespace = process.env.CODESPACE_NAME;
const forwardDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? 'app.github.dev';
const hostname = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i;
if (!isLocal && (process.env.CODESPACES !== 'true' || !/^[a-z0-9][a-z0-9-]{0,55}$/i.test(codespace ?? '') || !hostname.test(forwardDomain))) {
  throw new Error('Run this single-user runtime in GitHub Codespaces, or use --local for a loopback-only test.');
}

const origin = isLocal ? `http://127.0.0.1:${port}` : `https://${codespace}-${port}.${forwardDomain}`.toLowerCase();
const allowedOrigins = new Set(isLocal ? [origin, `http://localhost:${port}`] : [origin]);
const root = await realpath(fileURLToPath(new URL('../docs/', import.meta.url)));
const cwd = await realpath(options.cwd ?? process.cwd());
if (!(await stat(cwd)).isDirectory()) throw new Error('Terminal working directory must be a directory.');
const pairingToken = randomBytes(32);
const endpoint = '/_carb/terminal';
const maxSockets = 8;
const maxTerminals = 2;
const maxMessageBytes = 64 * 1024;
const maxInputPerWindow = 512 * 1024;
const maxOutput = 16 * 1024 * 1024;
const maxBufferedOutput = 1024 * 1024;
const maxLifetime = 60 * 60 * 1000;
const maxIdle = 15 * 60 * 1000;
const heartbeatDelay = 20000;
const terminalSessions = new Set();
const clients = new Set();
const wss = new WebSocketServer({ noServer: true, maxPayload: maxMessageBytes, perMessageDeflate: false });

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

const headers = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "frame-ancestors 'self'; object-src 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
};

function respond(response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, { ...headers, 'Content-Type': type });
  response.end(body);
}

function withinRoot(filename) {
  const relative = path.relative(root, filename);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

const server = createServer(async (request, response) => {
  const isHead = request.method === 'HEAD';
  if (request.method !== 'GET' && !isHead) return respond(response, 405, 'Method not allowed');
  try {
    if (!request.url?.startsWith('/') || request.url.startsWith('//')) return respond(response, 400, 'Invalid path');
    const route = new URL(request.url, origin).pathname;
    if (route === '/_carb/status') return respond(response, 200, isHead ? '' : '{"cloud":true}', 'application/json; charset=utf-8');
    const decoded = decodeURIComponent(route);
    if (/[\\\u0000-\u001f:]/.test(decoded)) return respond(response, 400, 'Invalid path');
    let filename = path.resolve(root, '.' + decoded);
    if (!withinRoot(filename)) return respond(response, 404, 'Not found');
    if ((await stat(filename)).isDirectory()) {
      if (!route.endsWith('/')) {
        response.writeHead(308, { ...headers, Location: route + '/' });
        response.end();
        return;
      }
      filename = path.join(filename, 'index.html');
    }
    filename = await realpath(filename);
    const type = mimeTypes.get(path.extname(filename).toLowerCase());
    if (!type || !withinRoot(filename) || !(await stat(filename)).isFile()) return respond(response, 404, 'Not found');
    response.writeHead(200, { ...headers, 'Content-Type': type });
    if (isHead) response.end();
    else await pipeline(createReadStream(filename), response);
  } catch {
    if (!response.headersSent) respond(response, 404, 'Not found');
    else response.destroy();
  }
});
server.headersTimeout = 12000;
server.requestTimeout = 15000;

function validToken(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value, 'hex'), pairingToken);
}

function validSize(message) {
  return Number.isInteger(message.cols) && message.cols >= 2 && message.cols <= 500 &&
    Number.isInteger(message.rows) && message.rows >= 1 && message.rows <= 200;
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function openPty(size) {
  const windows = process.platform === 'win32';
  const shell = windows ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/bash');
  const env = { ...process.env, TERM: 'xterm-256color' };
  return nodePty.spawn(shell, windows ? ['/Q'] : ['-l'], {
    name: 'xterm-256color', rows: size.rows, cols: size.cols, cwd, env,
  });
}

wss.on('connection', socket => {
  clients.add(socket);
  let pty;
  let closing = false;
  let lastInput = Date.now();
  let lastPingAnswered = true;
  let inputBytes = 0;
  let inputWindow = Date.now();
  let outputBytes = 0;
  let lifetime;
  let hardStop;
  let exited = false;
  const authTimer = setTimeout(() => close('连接未通过验证。', 1008), 5000);
  const heartbeat = setInterval(() => {
    if (closing || pty == null) return;
    if (Date.now() - lastInput > maxIdle) close('终端长时间无操作，已关闭。');
    else if (!lastPingAnswered) close();
    else if (socket.readyState === WebSocket.OPEN) {
      lastPingAnswered = false;
      socket.ping();
    }
  }, heartbeatDelay);

  function close(message, code = 1000) {
    if (closing) return;
    closing = true;
    clearTimeout(authTimer);
    clearTimeout(lifetime);
    clearInterval(heartbeat);
    if (message) send(socket, { type: 'error', message });
    if (socket.readyState === WebSocket.OPEN) socket.close(code);
    if (pty && !exited) {
      try { pty.kill(); } catch {}
      if (process.platform !== 'win32' && !exited) {
        hardStop = setTimeout(() => {
          if (!exited) {
            try { pty.kill('SIGKILL'); } catch {}
          }
        }, 1500);
      }
    }
  }

  socket.on('pong', () => { lastPingAnswered = true; });
  socket.on('error', () => close());
  socket.on('close', () => {
    close();
    clients.delete(socket);
  });

  socket.on('message', (buffer, binary) => {
    if (closing) return;
    let message;
    try {
      if (binary) throw new Error();
      message = JSON.parse(buffer.toString());
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error();
    } catch {
      close('终端消息格式无效。', 1008);
      return;
    }

    if (pty == null) {
      if (message.type !== 'start' || !validToken(message.token) || !validSize(message)) {
        close('连接未通过验证。', 1008);
        return;
      }
      if (terminalSessions.size >= maxTerminals) {
        close('已达到此工作区的终端数量上限。', 1008);
        return;
      }
      clearTimeout(authTimer);
      try {
        pty = openPty(message);
      } catch {
        close('无法启动系统终端。', 1011);
        return;
      }
      terminalSessions.add(pty);
      lifetime = setTimeout(() => close('已达到终端单次连接时限。'), maxLifetime);
      pty.onData(data => {
        if (closing) return;
        outputBytes += Buffer.byteLength(data);
        if (outputBytes > maxOutput || socket.bufferedAmount > maxBufferedOutput) {
          close('终端输出达到上限。', 1009);
          return;
        }
        send(socket, { type: 'data', data });
      });
      pty.onExit(({ exitCode }) => {
        exited = true;
        clearTimeout(hardStop);
        terminalSessions.delete(pty);
        send(socket, { type: 'exit', exitCode });
        close();
      });
      send(socket, { type: 'ready' });
      return;
    }

    try {
      if (message.type === 'input' && typeof message.data === 'string') {
        const now = Date.now();
        if (now - inputWindow >= 10000) {
          inputWindow = now;
          inputBytes = 0;
        }
        inputBytes += Buffer.byteLength(message.data);
        if (inputBytes > maxInputPerWindow) {
          close('终端输入速度超过上限。', 1008);
          return;
        }
        lastInput = now;
        pty.write(message.data);
      } else if (message.type === 'resize' && validSize(message)) {
        pty.resize(message.cols, message.rows);
      } else {
        close('终端消息格式无效。', 1008);
      }
    } catch {
      close('终端连接已中止。', 1011);
    }
  });
});

server.on('upgrade', (request, socket, head) => {
  const validUpgrade = request.url === endpoint && allowedOrigins.has(request.headers.origin);
  if (!validUpgrade || clients.size >= maxSockets) {
    socket.end(`HTTP/1.1 ${validUpgrade ? '503 Service Unavailable' : '403 Forbidden'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    return;
  }
  wss.handleUpgrade(request, socket, head, connection => wss.emit('connection', connection));
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const socket of clients) socket.terminate();
  wss.close();
  server.close();
  setTimeout(() => process.exit(), 2500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(port, isLocal ? '127.0.0.1' : '0.0.0.0', () => {
  console.log(`Carb cloud workbench: ${origin}/workbench/#terminal-token=${pairingToken.toString('hex')}`);
});
