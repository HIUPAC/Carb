import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { product } from './prepare-brand.mjs';

const root = path.resolve(import.meta.dirname, '..');
const directory = path.join(root, 'verification', `app-${product.version}`);
const mode = process.argv[2] ?? '--inspect';
const expectedUrl = new URL('file:///' + path.join(root, `Carb-${product.version}`, 'resources/web/index.html').replaceAll('\\', '/')).href;
const session = JSON.parse(await fs.readFile(path.join(directory, 'session.json'), 'utf8'));
assert.equal(session.port, 19517, 'Only the isolated QA debugging port is accepted');
assert.equal(path.resolve(session.profile), path.join(directory, 'desktop-data'), 'QA profile identity mismatch');
const targets = await (await fetch(`http://127.0.0.1:${session.port}/json/list`)).json();
const target = targets.find(item => item.type === 'page' && item.url === expectedUrl);
assert(target, 'The expected isolated Carb QA renderer was not found');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map(), exceptions = [];
ws.addEventListener('message', event => {
  const data = JSON.parse(event.data);
  if (data.id) {
    const request = pending.get(data.id);
    if (!request) return;
    clearTimeout(request.timeout); pending.delete(data.id);
    data.error ? request.reject(new Error(JSON.stringify(data.error))) : request.resolve(data.result);
  } else if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000);
    pending.set(id, { resolve, reject, timeout });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(path.join(directory, name + '.png'), Buffer.from(result.data, 'base64'));
}
async function snapshot(name) {
  const value = await evaluate(`(() => {
    const visible = element => element.getClientRects().length > 0;
    const controls = Array.from(document.querySelectorAll('button,[role=tab],[role=combobox],a')).filter(visible).map(element => ({
      tag: element.tagName, role: element.getAttribute('role'), text: element.textContent.trim().slice(0, 160),
      aria: element.getAttribute('aria-label'), title: element.title, disabled: element.disabled,
      className: String(element.className),
    }));
    return { url: location.href, title: document.title, lang: document.documentElement.lang,
      body: document.body.innerText.slice(0, 24000), controls,
      fonts: { light: localStorage.getItem('harness.font.light'), dark: localStorage.getItem('harness.font.dark'),
        applied: getComputedStyle(document.documentElement).getPropertyValue('--font-ui') },
      modules: performance.getEntriesByType('resource').map(item => item.name).filter(name => /Settings-|carb-fonts|carb-skill-installer/.test(name)) };
  })()`);
  await fs.writeFile(path.join(directory, name + '.json'), JSON.stringify(value, null, 2) + '\n');
  await screenshot(name);
  return value;
}

await send('Runtime.enable');
await send('Page.enable');
try {
  if (mode === '--inspect') {
    const result = await snapshot('settings-initial');
    console.log(JSON.stringify({ target: target.id, ...result }, null, 2));
  } else if (mode === '--evaluate-file') {
    const filename = process.argv[3];
    assert(filename, 'Provide a local JavaScript expression file');
    const expression = await fs.readFile(filename, 'utf8');
    const result = await evaluate(expression);
    await fs.writeFile(path.join(directory, 'settings-action.json'), JSON.stringify(result ?? null, null, 2) + '\n');
    console.log(JSON.stringify(result ?? null, null, 2));
    await screenshot('settings-action');
  } else {
    throw new Error('Unknown mode: ' + mode);
  }
} finally { ws.close(); }
