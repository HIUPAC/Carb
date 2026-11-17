import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { product } from './prepare-brand.mjs';

const root = path.resolve(import.meta.dirname, '..');
const version = process.env.CARB_UI_VERSION ?? product.version;
assert(/^\d+\.\d+\.\d+$/.test(version));
const runtime = path.join(root, 'verification', `app-${version}-E2E`);
const output = path.join(root, 'verification', `settings-${version}`);
const session = JSON.parse(await fs.readFile(path.join(runtime, 'session.json'), 'utf8'));
const expectedExecutable = path.join(root, `Carb-${version}-E2E`, 'Carb.exe');
assert.equal(path.resolve(session.executable).toLowerCase(), expectedExecutable.toLowerCase());
assert.equal(path.resolve(session.profile).toLowerCase(), path.join(runtime, 'desktop-data').toLowerCase());
assert.equal(path.resolve(session.serverData).toLowerCase(), path.join(runtime, 'server-data').toLowerCase());
assert(path.resolve(session.codexHome).startsWith(runtime + path.sep));
const expectedUrl = pathToFileURL(path.join(path.dirname(session.executable), 'resources/web/index.html')).href;
await fs.mkdir(output, { recursive: true });
async function until(action, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await action();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(message);
}
const target = await until(async () => {
  try {
    return (await (await fetch(`http://127.0.0.1:${session.port}/json/list`, { signal: AbortSignal.timeout(1000) })).json())
      .find(item => item.type === 'page' && item.url === expectedUrl);
  } catch { return null; }
}, 'Isolated QA renderer is unavailable');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let sequence = 0;
const pending = new Map(), exceptions = [], consoleErrors = [], logErrors = [], snapshots = [];
const cases = [];
socket.addEventListener('message', event => {
  const response = JSON.parse(event.data);
  if (response.id) {
    const request = pending.get(response.id); if (!request) return;
    clearTimeout(request.timeout); pending.delete(response.id);
    response.error ? request.reject(Error(JSON.stringify(response.error))) : request.resolve(response.result);
  } else if (response.method === 'Runtime.exceptionThrown') exceptions.push(response.params.exceptionDetails);
  else if (response.method === 'Runtime.consoleAPICalled' && response.params.type === 'error') consoleErrors.push(response.params);
  else if (response.method === 'Log.entryAdded' && response.params.entry.level === 'error') logErrors.push(response.params.entry);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function snapshot(name) {
  const value = await evaluate(`(() => {
    const visible = e => e.getClientRects().length > 0;
    const scope=document.querySelector('#carb-settings-qa-root')??document;
    return { name: ${JSON.stringify(name)}, body: scope===document?document.body.innerText:scope.innerText,
      controls: [...scope.querySelectorAll('button,a,[role=tab],[role=combobox],input')].filter(visible).map(e => ({
        text: (e.innerText ?? e.textContent ?? '').trim(), tag: e.tagName, role: e.getAttribute('role'),
        aria: e.getAttribute('aria-label'), title: e.title, className: String(e.className), type: e.type,
        disabled: e.disabled, placeholder: e.getAttribute('placeholder')
      })), rows: [...scope.querySelectorAll('.provider-row')].filter(visible).map(e=>({text:e.innerText,
        name:e.querySelector('.set-entity__name')?.innerText,status:e.querySelector('.provider-row__status-text')?.textContent,
        tooltip:e.querySelector('.provider-row__mark')?.title,account:e.querySelector('.settings__account')?.textContent,
        accountEmailToggle:!!e.querySelector('.settings__email-toggle')})),
      loadedSettings: performance.getEntriesByType('resource').map(e=>e.name).filter(e=>/Settings-/.test(e)) };
  })()`);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await fs.writeFile(path.join(output, name + '.png'), Buffer.from(screenshot.data, 'base64'));
  await fs.writeFile(path.join(output, name + '.json'), JSON.stringify(value, null, 2) + '\n');
  snapshots.push(value); return value;
}
async function clickText(text, selector = 'button') {
  return await evaluate(`(() => { const scope=document.querySelector('#carb-settings-qa-root')??document;const e=[...scope.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length>0&&e.innerText.trim()===${JSON.stringify(text)}); if(!e)return false;e.click();return true; })()`);
}
async function openSettings() {
  await evaluate('document.querySelector(`.onboarding__skip`)?.click()');
  await until(() => evaluate('!document.querySelector(`.onboarding:not([hidden])`)'), 'Onboarding remained visible');
  if (!await evaluate('!!document.querySelector(`.settings__nav-item`)')) {
    await until(() => evaluate('(()=>{const b=document.querySelector(`.account-card__settings`);if(!b)return false;b.click();return true})()'), 'Settings button missing');
  }
  await until(() => evaluate('!!document.querySelector(`.settings__nav-item`)'), 'Settings did not open');
}
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 650));
  assert(!await evaluate('/遇到了问题|Something went wrong/.test(document.body.innerText)'), 'A settings error boundary was displayed');
}
async function fixture(installed, desktopInstalled, signedIn) {
  // This exercises the shipped Settings component, React account child and
  // formatter together. All changes live only in this isolated renderer's
  // component props and transport seam; no credentials or installation changes.
  const changed = await evaluate(`(async () => {
    const element=document.querySelector('.settings__nav-item');
    const key=Object.keys(element).find(e=>e.startsWith('__reactFiber$'));
    let fiber=element[key];
    while(fiber && !(fiber.memoizedProps?.transport?.request && Array.isArray(fiber.memoizedProps?.providerStatuses)))fiber=fiber.return;
    if(!fiber)return false;
    const props=window.__settingsQABaseProps??fiber.memoizedProps;
    window.__settingsQABaseProps=props;
    const original=props.transport;
    const account={signedIn:${signedIn},${signedIn ? "email:'qa-account@example.invalid',plan:'QA Plan'" : ''}};
    const provider={...props.providerStatuses.find(e=>e.id==='codex'),id:'codex',displayName:'Codex',installed:${installed},desktopInstalled:${desktopInstalled},version:'codex-cli 9.9.9-qa',cliPath:${installed ? "'C:\\\\QA\\\\codex.cmd'" : 'undefined'}};
    const transport=new Proxy(original,{get(target,key){
      if(key==='request')return (method,params)=>method==='auth.status'&&params?.provider==='codex'?Promise.resolve(account):target.request(method,params);
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    const overrides={...props,transport,provider:'codex',account,accountLoading:false,providersLoading:false,
      providerStatuses:[provider],providerRoster:['codex'],initialSection:'providers',providersView:undefined,
      sectionRequest:Date.now(),onAccountChange:()=>{},onModelsWanted:()=>{}};
    const index=await import('./assets/index-dY3kjCLH.js');
    const settings=await import('./assets/Settings-CdgxHJV3.js');
    const React=index.__qaReact,ReactDOM=index.__qaReactDOM;
    if(!React?.createElement||!ReactDOM?.createRoot)return false;
    let container=document.querySelector('#carb-settings-qa-root');
    if(!container){container=document.createElement('div');container.id='carb-settings-qa-root';
      Object.assign(container.style,{position:'fixed',inset:'0',zIndex:'2147483647',background:'var(--bg,#111)'});document.body.appendChild(container);}
    const root=window.__settingsQARoot??ReactDOM.createRoot(container);window.__settingsQARoot=root;
    if(!window.__settingsQABoundary)window.__settingsQABoundary=class extends React.Component{
      state={error:null};static getDerivedStateFromError(error){return {error:String(error)}}
      render(){return this.state.error?React.createElement('div',{'data-qa-error':true},this.state.error):this.props.children;}
    };
    root.render(React.createElement(window.__settingsQABoundary,{key:${JSON.stringify(`${installed}-${desktopInstalled}-${signedIn}`)}},React.createElement(settings.Settings,overrides)));
    return true;
  })()`);
  assert(changed, 'The shipped Settings component fixture seam was not found');
  await settle();
  assert(!await evaluate('!!document.querySelector(`#carb-settings-qa-root [data-qa-error]`)'),'A fixture error boundary was displayed');
  const name = `codex-${installed ? 'cli' : 'no-cli'}-${desktopInstalled ? 'desktop' : 'no-desktop'}-${signedIn ? 'signed-in' : 'signed-out'}`;
  const value = await snapshot(name);
  const row = value.rows.find(e=>e.name==='Codex');
  assert(row, 'The Codex fixture row was not rendered');
  if(signedIn) {
    assert(row.accountEmailToggle, 'The real account email child was not preserved');
    assert.match(row.account,/QA Plan/,'The real account plan child was not preserved');
    assert(!row.text.includes('[object Object]'), 'The React account node was converted to a string');
  } else {
    const expected = installed ? desktopInstalled ? 'CLI、桌面版均已安装' : 'CLI 已安装' : desktopInstalled ? '桌面版已安装，需安装 CLI' : 'CLI 未安装';
    assert(row.status?.includes(expected), `Expected ${expected}, got ${row.status}`);
  }
  if(installed) assert.match(row.tooltip,/C:\\QA\\codex\.cmd/,'The CLI path tooltip was not preserved');
  cases.push({installed,desktopInstalled,signedIn,status:row.status,account:row.account,screenshot:path.join(output,name+'.png')});
  return value;
}
const mode = process.argv[2] ?? '--inspect';
let failure;
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  if(mode==='--verify-suite') {
    const indexPath=path.join(path.dirname(session.executable),'resources/web/assets/index-dY3kjCLH.js');
    const index=await fs.readFile(indexPath,'utf8');
    if(!index.includes('Zs as __qaReactDOM'))await fs.appendFile(indexPath,'\nexport{Zs as __qaReactDOM,y as __qaReact};\n');
    await send('Page.reload',{ignoreCache:true});
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  await until(() => evaluate('document.readyState===`complete` && !!document.body.innerText'), 'Renderer stayed empty');
  if (mode === '--inspect') await snapshot('initial');
  else if (mode === '--open') {
    await openSettings(); await settle();
    await snapshot('opened');
  } else if (mode === '--verify-suite') {
    await openSettings(); await settle(); await snapshot('default-open');
    const tabs=await evaluate('[...document.querySelectorAll(`.settings__nav-item`)].map(e=>e.innerText.trim())');
    assert(tabs.length>=11,'Expected all settings navigation categories');
    for(let index=0;index<tabs.length;index++) {
      assert(await clickText(tabs[index],'.settings__nav-item'),'Settings tab missing: '+tabs[index]);
      await settle(); const value=await snapshot('navigation-'+String(index+1).padStart(2,'0'));
      assert(value.body.trim(),'A settings tab stayed empty');
    }
    await evaluate('document.querySelector(`.ta-api-icon-button[aria-label="关闭"]`)?.click();[...document.querySelectorAll(`button`)].find(e=>e.innerText.trim()===`开始使用`)?.click()');
    assert(await clickText('服务提供方','.settings__nav-item')); await settle();
    assert(await clickText('添加服务商','.provider-roster__add'),'Provider picker control missing');
    await settle(); await snapshot('provider-picker');
    assert(await clickText('常规','.settings__nav-item')); await settle();
    for(const signedIn of [false,true])for(const installed of [false,true])for(const desktopInstalled of [false,true])await fixture(installed,desktopInstalled,signedIn);
    await evaluate('window.__settingsQARoot.unmount();document.querySelector(`#carb-settings-qa-root`).remove()');
    assert(await clickText('API 连接','.settings__nav-item')); await settle();
    const api=await snapshot('api-connections');
    const add=api.controls.find(e=>e.className?.includes('ta-api')&&/添加|Add/.test(e.text));
    if(add) { assert(await clickText(add.text)); await settle(); await snapshot('api-add-form'); }
    assert.equal(cases.length,8);
    assert.equal(exceptions.length,0,'A renderer exception occurred');
    assert.equal(consoleErrors.length,0,'A React console error occurred');
  } else if (mode === '--click') {
    assert(process.argv[3], 'Supply exact visible button text');
    assert(await clickText(process.argv[3]), 'Requested button is missing');
    await new Promise(resolve => setTimeout(resolve, 800));
    await snapshot('clicked-' + Date.now());
  } else if (mode === '--evaluate-file') {
    const value = await evaluate(await fs.readFile(process.argv[3], 'utf8'));
    console.log(JSON.stringify(value, null, 2)); await snapshot('action-' + Date.now());
  } else throw Error('Unknown verification mode: ' + mode);
} catch (error) { failure = error.message; }
finally {
  const assetDirectory=path.join(path.dirname(session.executable),'resources/web/assets');
  const settingsFile=(await fs.readdir(assetDirectory)).find(e=>/^Settings-.*\.js$/.test(e));
  const settingsPath=path.join(assetDirectory,settingsFile);
  const settingsSha256=createHash('sha256').update(await fs.readFile(settingsPath)).digest('hex');
  const report = { passed: !failure && exceptions.length === 0 && consoleErrors.length === 0 && !snapshots.some(e=>/遇到了问题|Something went wrong/.test(e.body)),
    failure, executable: session.executable, profile: session.profile, settingsPath,settingsSha256,exceptions, consoleErrors, logErrors,cases,snapshots };
  await fs.writeFile(path.join(output, mode.slice(2)+'-report.json'), JSON.stringify(report, null, 2) + '\n');
  if(mode==='--verify-suite')console.log(JSON.stringify({...report,snapshots:report.snapshots.map(e=>({name:e.name,bodyLength:e.body.length}))}, null, 2));
  else console.log(JSON.stringify(report, null, 2));
  if(!report.passed)process.exitCode=1;
  socket.close();
}
if (failure) process.exitCode = 1;
