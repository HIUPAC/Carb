import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { product } from './prepare-brand.mjs';

// Use only the existing launcher-created isolated QA session. This script has
// no installation, authentication, update, purchase or external-navigation path.
const root = path.resolve(import.meta.dirname, '..');
const runtime = path.join(root, 'verification', `app-${product.version}-E2E`);
const output = path.join(root, `verification${product.version}`);
const session = JSON.parse(await fs.readFile(path.join(runtime, 'session.json'), 'utf8'));
const expectedExecutable = path.join(root, `Carb-${product.version}-E2E`, 'Carb.exe');
assert.equal(path.resolve(session.executable).toLowerCase(), expectedExecutable.toLowerCase());
assert.equal(path.resolve(session.profile).toLowerCase(), path.join(runtime, 'desktop-data').toLowerCase());
assert.equal(path.resolve(session.serverData).toLowerCase(), path.join(runtime, 'server-data').toLowerCase());
assert(path.resolve(session.codexHome).startsWith(runtime + path.sep), 'CODEX_HOME must remain inside the QA profile');
assert.notEqual(path.dirname(session.executable).toLowerCase(), path.resolve('D:/Carb').toLowerCase());
const expectedUrl = pathToFileURL(path.join(path.dirname(session.executable), 'resources/web/index.html')).href;
await fs.mkdir(output, { recursive: true });

async function until(action, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await action();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(message);
}
const target = await until(async () => {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${session.port}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
    return targets.find(item => item.type === 'page' && item.url === expectedUrl);
  } catch { return undefined; }
}, 'The isolated QA renderer did not become available');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map(), exceptions = [];
socket.addEventListener('message', event => {
  const response = JSON.parse(event.data);
  if (response.id) {
    const request = pending.get(response.id);
    if (!request) return;
    clearTimeout(request.timeout); pending.delete(response.id);
    response.error ? request.reject(new Error(JSON.stringify(response.error))) : request.resolve(response.result);
  } else if (response.method === 'Runtime.exceptionThrown') exceptions.push(response.params.exceptionDetails);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function snapshot(name) {
  const value = await evaluate(`(() => {
    const visible=e=>e.getClientRects().length>0;
    return {url:location.href,title:document.title,lang:document.documentElement.lang,body:document.body.innerText,
      rows:[...document.querySelectorAll('.provider-row')].filter(visible).map(row=>({text:row.innerText,
        status:row.querySelector('.provider-row__status-text')?.textContent,
        tooltip:row.querySelector('.provider-row__mark')?.title,
        buttons:[...row.querySelectorAll('button')].map(button=>({text:button.innerText,disabled:button.disabled}))})),
      controls:[...document.querySelectorAll('button')].filter(visible).map(button=>({text:button.innerText,aria:button.getAttribute('aria-label'),disabled:button.disabled}))};
  })()`);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(screenshot.data, 'base64'));
  await fs.writeFile(path.join(output, name + '.json'), JSON.stringify(value, null, 2) + '\n');
  return value;
}
const mode = process.argv[2] ?? '--inspect';
await send('Runtime.enable');
await send('Page.enable');
try {
  await until(() => evaluate('document.readyState===`complete` && !!document.body.innerText'), 'The isolated renderer stayed empty');
  if (mode === '--inspect') {
    console.log(JSON.stringify(await snapshot('cli-ui-initial'), null, 2));
  } else if (mode === '--open' || mode === '--verify') {
    await evaluate('document.querySelector(`.onboarding__skip`)?.click()');
    await until(() => evaluate('!document.querySelector(`.onboarding:not([hidden])`)'), 'Onboarding did not dismiss');
    await until(() => evaluate('(()=>{const b=document.querySelector(`.account-card__settings`);if(!b)return false;b.click();return true})()'), 'Settings button was not found');
    await until(() => evaluate('(()=>{const b=[...document.querySelectorAll(`button`)].find(e=>e.getClientRects().length>0&&[`服务提供方`,`Providers`].includes(e.innerText.trim()));if(!b)return false;b.click();return true})()'), 'Providers settings tab was not found');
    await until(() => evaluate('(()=>{const row=[...document.querySelectorAll(`.provider-row`)].find(e=>e.getClientRects().length>0&&/codex/i.test(e.querySelector(`.set-entity__name`)?.innerText??``));if(!row)return false;row.scrollIntoView({block:`nearest`});return true})()'), 'The Codex provider row was not found');
    const value = await snapshot('codex-cli-desktop');
    if (mode === '--verify') {
      const provider = await until(() => evaluate(`(async()=>{
        const endpoint=await window.carb.getCoreEndpoint();
        return new Promise((resolve,reject)=>{
          const connection=new WebSocket(endpoint),id='isolated-cli-status-qa';
          const timer=setTimeout(()=>{connection.close();reject(Error('Provider status timeout'))},12000);
          connection.onopen=()=>connection.send(JSON.stringify({id,method:'providers.list',params:{}}));
          connection.onmessage=event=>{const reply=JSON.parse(event.data);if(reply.id!==id)return;clearTimeout(timer);connection.close();
            if(reply.error){reject(Error(reply.error.message));return}const codex=reply.result.providers.find(e=>e.id==='codex');resolve(codex?.version?codex:undefined)};
          connection.onerror=()=>{clearTimeout(timer);connection.close();reject(Error('Isolated status connection failed'))};
        });
      })()`), 'The Codex CLI version did not settle');
      assert.equal(provider.installed, true, 'The standalone CLI is available');
      assert.equal(provider.desktopInstalled, true, 'Desktop presence is detected independently');
      assert(path.win32.isAbsolute(provider.cliPath), 'The resolved CLI location is absolute');
      assert.match(provider.version, /\d+\.\d+/);
      const row = value.rows.find(item => /codex/i.test(item.text));
      assert(row, 'Codex is visible in settings');
      assert.match(row.status, /CLI、桌面版均已安装|CLI \+ desktop installed/);
      assert(row.tooltip.includes(provider.cliPath), 'The UI shows the selected CLI location');
      assert(row.tooltip.includes(provider.version), 'The UI preserves its CLI version');
      assert.equal(exceptions.length, 0, 'No renderer exception occurred during this verification');
      await fs.writeFile(path.join(output, 'cli-ui-report.json'), JSON.stringify({ passed: true, executable: session.executable,
        profile: session.profile, serverData: session.serverData, codexHome: session.codexHome,
        provider, row, exceptions, screenshot: path.join(output, 'codex-cli-desktop.png') }, null, 2) + '\n');
      console.log(JSON.stringify({ passed: true, version: provider.version, cliPath: provider.cliPath, status: row.status, screenshot: path.join(output, 'codex-cli-desktop.png') }, null, 2));
    } else console.log(JSON.stringify(value, null, 2));
  } else throw new Error(`Unknown mode: ${mode}`);
} finally { socket.close(); }
