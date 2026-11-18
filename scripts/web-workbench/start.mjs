import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer, request as httpRequest, STATUS_CODES } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { extractCore } from './release.mjs';

const loopback = '127.0.0.1';
const token = () => randomBytes(32).toString('hex');
const bootstrapSecret = token();
const sessionSecret = token();
const socketSecret = token();
const coreSecret = token();
const cookie = 'carb_local_' + randomBytes(6).toString('hex');
const formPage = '<!doctype html><html lang="zh-CN"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>启动 Carb 工作台</title><main><h1>Carb 本机工作台</h1>' +
  '<p role="status" id="status">请使用启动器给出的访问链接。</p></main>' +
  '<script src="/local-session.js" defer></script></html>';
const types = new Map(Object.entries({
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}));
const responseHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

function sameValue(actual, expected) {
  if (typeof actual !== 'string') return false;
  const supplied = Buffer.from(actual);
  const known = Buffer.from(expected);
  return supplied.length === known.length && timingSafeEqual(supplied, known);
}

function hasSession(request) {
  const cookies = request.headers.cookie?.split(';') ?? [];
  return cookies.some(value => sameValue(value.trim(), cookie + '=' + sessionSecret));
}

function send(response, status, type, body, extra) {
  response.writeHead(status, { ...responseHeaders, 'Content-Type': type, ...extra });
  response.end(body);
}

function rejectUpgrade(socket, status) {
  socket.end('HTTP/1.1 ' + status + ' ' + STATUS_CODES[status] +
    '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, loopback, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function selectCorePort() {
  const probe = createTcpServer();
  const port = await listen(probe);
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

function proxySocket(request, socket, head, corePort, origin, connections) {
  const key = request.headers['sec-websocket-key'];
  if (request.headers.upgrade?.toLowerCase() !== 'websocket' ||
      request.headers['sec-websocket-version'] !== '13' ||
      !/^[A-Za-z0-9+/]{22}==$/.test(key ?? '')) {
    rejectUpgrade(socket, 400);
    return;
  }
  const upstream = httpRequest({
    host: loopback,
    port: corePort,
    path: '/?token=' + coreSecret,
    headers: {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      Origin: origin,
      'Sec-WebSocket-Key': key,
      'Sec-WebSocket-Version': '13',
    },
  });
  connections.add(socket);
  socket.on('error', () => socket.destroy());
  socket.once('close', () => {
    connections.delete(socket);
    upstream.destroy();
  });
  upstream.setTimeout(5000, () => upstream.destroy());
  upstream.once('response', response => {
    response.resume();
    rejectUpgrade(socket, 502);
  });
  upstream.once('error', () => rejectUpgrade(socket, 502));
  upstream.once('upgrade', (response, peer, upstreamHead) => {
    if (socket.destroyed) {
      peer.destroy();
      return;
    }
    peer.setTimeout(0);
    peer.on('error', () => socket.destroy());
    peer.once('close', () => socket.destroy());
    socket.once('close', () => peer.destroy());
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n' +
      'Sec-WebSocket-Accept: ' + response.headers['sec-websocket-accept'] + '\r\n\r\n');
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) peer.write(head);
    socket.pipe(peer).pipe(socket);
  });
  upstream.end();
}

async function start() {
  const { values } = parseArgs({
    options: {
      payload: { type: 'string' },
      'data-dir': { type: 'string' },
      port: { type: 'string', default: '16482' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || !values.payload) {
    console.log('用法：node start.mjs --payload "Carb 5.6.13 安装或解压目录" [--data-dir "工作台数据目录"] [--port 16482]');
    process.exitCode = values.help ? 0 : 1;
    return;
  }
  if (process.platform !== 'win32' || process.arch !== 'x64' || Number(process.versions.node.split('.')[0]) < 24) {
    throw new Error('需要 Windows x64 和 Node.js 24 或更高版本。');
  }
  const requestedPort = Number(values.port);
  if (!/^\d{1,5}$/.test(values.port) || requestedPort > 65535) {
    throw new Error('--port 必须是 0 到 65535 之间的端口号。');
  }
  const resources = path.join(await realpath(values.payload), 'resources');
  const web = await realpath(path.join(resources, 'web'));
  const assets = path.join(web, 'assets');
  const sessionScript = await readFile(new URL('./local-session.js', import.meta.url));
  const data = path.resolve(values['data-dir'] ?? path.join(
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Carb', 'BrowserWorkbench',
  ));
  await mkdir(data, { recursive: true });
  const launcherTemp = path.resolve(os.tmpdir());
  const staging = await mkdtemp(path.join(launcherTemp, 'carb-local-workbench-'));
  const cleanStaging = async () => {
    if (path.dirname(staging) === launcherTemp && path.basename(staging).startsWith('carb-local-workbench-')) {
      await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  };
  let core;
  let site;
  const connections = new Set();
  try {
    await extractCore(resources, staging);
    Object.assign(process.env, {
      HARNESS_DATA_DIR: data,
      CARB_DATA_DIR: data,
      HARNESS_CONFIG_DIR: path.join(data, 'config'),
      CARB_GLOBAL_SKILLS_DIR: path.join(data, 'skills'),
      HARNESS_DEFAULT_SKILLS_DIR: path.join(resources, 'default-skills'),
      HARNESS_EDITION: 'release',
      HARNESS_PHONE_ACCESS: '0',
    });
    delete process.env.ELECTRON_RUN_AS_NODE;
    delete process.env.HARNESS_ACCESS_TOKEN;
    const serverDir = path.join(staging, 'node_modules', '@harness', 'server', 'dist');
    const { takeEdition } = await import(pathToFileURL(path.join(serverDir, 'provider-edition.js')));
    takeEdition(process.env);
    const { startServer } = await import(pathToFileURL(path.join(serverDir, 'server.js')));
    const html = await readFile(path.join(web, 'index.html'), 'utf8');
    const bundledEndpoint = 'ws://127.0.0.1:16481';
    if (!html.includes(bundledEndpoint) || !html.includes('</title>')) {
      throw new Error('Carb 网页资源缺少兼容的入口。');
    }
    const corePort = await selectCorePort();
    let port;
    let origin;
    let renderer;
    let ready = false;

    site = createServer(async (request, response) => {
      const plain = 'text/plain; charset=utf-8';
      if (!ready || request.headers.host !== loopback + ':' + port) {
        send(response, 403, plain, '请从本机启动器访问。');
        return;
      }
      const fetchSite = request.headers['sec-fetch-site'];
      if (fetchSite && fetchSite !== 'none' && fetchSite !== 'same-origin') {
        send(response, 403, plain, '请从本机启动器访问。');
        return;
      }
      const route = request.url?.split('?')[0];
      if (route === '/local-session' && request.method === 'POST') {
        if (request.headers.origin !== origin ||
            !sameValue(request.headers.authorization, 'Bearer ' + bootstrapSecret)) {
          send(response, 403, plain, '请使用启动器给出的访问链接。');
          return;
        }
        send(response, 200, types.get('.json'), JSON.stringify({ socketSecret }), {
          'Set-Cookie': cookie + '=' + sessionSecret + '; Path=/; HttpOnly; SameSite=Strict',
        });
        return;
      }
      if (request.method !== 'GET') {
        send(response, 405, plain, '请求方式无效。');
        return;
      }
      if (route === '/') {
        send(response, 200, 'text/html; charset=utf-8', hasSession(request) ? renderer : formPage);
        return;
      }
      if (route === '/local-connect') {
        send(response, 200, 'text/html; charset=utf-8', formPage);
        return;
      }
      if (route === '/local-session.js') {
        send(response, 200, types.get('.js'), sessionScript);
        return;
      }
      if (!hasSession(request)) {
        send(response, 403, plain, '请使用启动器给出的访问链接。');
        return;
      }
      if (route === '/local-bridge.js') {
        send(response, 200, types.get('.js'),
          "window.carb = Object.freeze({ getCoreEndpoint: () => 'ws://' + location.host + '/local-core?session=' + " +
          "encodeURIComponent(sessionStorage.getItem('carb.localSocketToken') ?? '') });");
        return;
      }
      if (!/^\/assets(?:\/[A-Za-z0-9_.~-]+)+$/.test(route ?? '') || route.split('/').some(part => part === '.' || part === '..')) {
        send(response, 404, plain, '文件不存在。');
        return;
      }
      try {
        const filename = await realpath(path.join(web, route.slice(1)));
        const relative = path.relative(assets, filename);
        if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
          send(response, 404, plain, '文件不存在。');
          return;
        }
        send(response, 200, types.get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream',
          await readFile(filename));
      } catch {
        send(response, 404, plain, '文件不存在。');
      }
    });
    site.on('upgrade', (request, socket, head) => {
      if (!ready || !sameValue(request.url, '/local-core?session=' + socketSecret) ||
          request.headers.host !== loopback + ':' + port ||
          request.headers.origin !== origin || !hasSession(request)) {
        rejectUpgrade(socket, 403);
        return;
      }
      proxySocket(request, socket, head, corePort, origin, connections);
    });
    port = await listen(site, requestedPort);
    origin = 'http://' + loopback + ':' + port;
    renderer = html.replace(bundledEndpoint, 'ws://' + loopback + ':' + port)
      .replace('</title>', '</title>\n    <script src="/local-session.js"></script>\n    <script src="/local-bridge.js"></script>');
    core = startServer({ port: corePort, host: loopback, accessToken: coreSecret, rendererOrigin: origin });
    ready = true;
    console.log('请在本机浏览器打开： ' + origin + '/#' + bootstrapSecret);
    console.log('工作台数据目录： ' + data);
    console.log('关闭本机工作台请在此窗口按 Ctrl+C。');
  } catch (error) {
    await core?.close().catch(() => {});
    site?.close();
    await cleanStaging();
    throw error;
  }

  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    for (const socket of connections) socket.destroy();
    try {
      await Promise.all([
        core.close(),
        new Promise((resolve, reject) => site.close(error => error ? reject(error) : resolve())),
      ]);
    } finally {
      await cleanStaging();
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => stop().catch(error => {
      process.exitCode = 1;
      console.error(error.message);
    }));
  }
}

await start().catch(error => {
  process.exitCode = 1;
  console.error('Carb 本机工作台启动失败：' + error.message);
});
