import assert from 'node:assert/strict';
import { patchAuthUrlCalls } from './patch-login-renderer-recovery.mjs';
export function patchSkillWeb(source) {
  if (source.includes('__carbGlobalSkills')) return patchAuthUrlCalls(patchSkillManagementWeb(source));
  source = "import {createSkillInstaller as __carbCreateSkillInstaller} from './carb-skill-installer.js';\n" + source;
  const start = source.indexOf('function __carbSkillInstall(');
  const end = source.indexOf('function $a(', start);
  assert(start >= 0 && end > start, 'Skill installer component anchors missing');
  source = source.slice(0, start) + 'const __carbSkillInstall=__carbCreateSkillInstaller(K,q);' + source.slice(end);

  // Global skills live outside the selected project. Always query the skill
  // inventory (with an optional project path), including in the no-project
  // state, so its global and bundled entries remain visible in Settings.
  const projectGate = 'if(!e.projectPath){d.current+=1,n(void 0),f.current=void 0,p.current=void 0,i(!1),o(void 0),c(new Set);return}';
  assert.equal(source.split(projectGate).length, 2, 'No-project skill inventory gate missing');
  source = source.replace(projectGate, '');
  const inventoryState = 'S=y?.skills.filter($a)??[],C=!!e.projectPath&&r&&!t';
  assert.equal(source.split(inventoryState).length, 2, 'Skill inventory state anchor missing');
  source = source.replace(inventoryState, 'S=y?.skills.filter($a)??[],__carbGlobalSkills=y?.skills.filter(e=>e.scope===`global`)??[],C=r&&!t');
  const noProjectState = ':(0,q.jsx)(Xn,{title:(__testT("Select a project in the sidebar first."))})';
  const qaStart = source.indexOf('function Qa(e)');
  const installerStart = source.indexOf('const __carbSkillInstall=', qaStart);
  assert(qaStart >= 0 && installerStart > qaStart, 'Skills settings component boundaries missing');
  let settingsComponent = source.slice(qaStart, installerStart);
  assert.equal(settingsComponent.split(noProjectState).length, 2, 'No-project empty state anchor missing');
  settingsComponent = settingsComponent.replace('e.projectPath?C?', 'C?').replace(noProjectState, '');
  source = source.slice(0, qaStart) + settingsComponent + source.slice(installerStart);
  const projectOnlyBundled = 'e.projectPath&&S.length?';
  assert.equal(source.split(projectOnlyBundled).length, 2, 'Bundled skills project gate missing');
  source = source.replace(projectOnlyBundled, 'S.length?');
  const bundledGroup = 'children:S.map(e=>(0,q.jsx)(to,{skill:e,configurable:!1,busy:!1,onToggle:()=>void 0},e.id))}):null';
  assert.equal(source.split(bundledGroup).length, 2, 'Bundled skill group anchor missing');
  source = source.replace(bundledGroup, bundledGroup + ',__carbGlobalSkills.length?(0,q.jsx)(G,{title:(__testT("Crab 全局技能")),note:(__testT("这些技能已安装到 Crab，全局工作区和支持的代理均可使用。")),children:__carbGlobalSkills.map(e=>(0,q.jsx)(to,{skill:e,configurable:!1,busy:!1,onToggle:()=>void 0},e.id))}):null');

  const anchor = '(0,q.jsx)(__carbSkillInstall,{enabled:!!e.projectPath&&!!y?.capabilities.install,busy:s.size>0,onInstall:_})';
  assert.equal(source.split(anchor).length, 2, 'Skill installer props anchor missing');
  // Skill installation writes to Crab's global directory, so it is available
  // without a selected workspace or a provider skill-list capability.
  source = source.replace(anchor, '(0,q.jsx)(__carbSkillInstall,{enabled:true,busy:s.size>0,transport:e.transport,provider:e.provider,projectPath:void 0,onInstalled:()=>u(e=>e+1)})');
  // Both local pickers share preview and validation.
  const a = source.indexOf('actions:e.projectPath&&y?.capabilities.install?', source.indexOf('function Qa('));
  const b = source.indexOf('children:[(0,q.jsx)(__carbSkillInstall', a);
  assert(a >= 0 && b > a, 'Skill folder action anchor missing');
  source = source.slice(0, a) + source.slice(b);
  assert(!settingsComponent.includes('Select a project in the sidebar first.'), 'Global skill settings still require a selected project');
  return patchAuthUrlCalls(patchSkillManagementWeb(source));
}


export function patchSkillManagementWeb(source) {
  if (source.includes('__carbSkillManager=')) return source;
  const importAnchor = "import {createSkillInstaller as __carbCreateSkillInstaller} from './carb-skill-installer.js';\n";
  assert(source.startsWith(importAnchor), 'Skill installer import missing');
  source = source.replace(importAnchor, importAnchor + "import {createSkillManager as __carbCreateSkillManager} from './carb-skill-installer.js';\n");
  const componentAnchor = 'const __carbSkillInstall=__carbCreateSkillInstaller(K,q);';
  assert.equal(source.split(componentAnchor).length, 2, 'Skill management component anchor missing');
  source = source.replace(componentAnchor, componentAnchor + 'const __carbSkillManager=__carbCreateSkillManager(K,q);');
  const from = 'C?(0,q.jsx)(Zn,{label:(__testT("Discovering skills…"))}):y?.capabilities.inventory?x.length?x.map(e=>(0,q.jsx)(to,{skill:e,configurable:y.capabilities.configure,busy:s.has(e.id),onToggle:()=>void g(e)},e.id)):(0,q.jsx)(Xn,{title:(__testT("No Agent Skills have been imported into this project."))}):null,S.length?(0,q.jsx)(G,{title:(__testT("Included with Test")),note:(__testT("Every chat can use these. An agent opens one only when the task calls for it.")),children:S.map(e=>(0,q.jsx)(to,{skill:e,configurable:!1,busy:!1,onToggle:()=>void 0},e.id))}):null,__carbGlobalSkills.length?(0,q.jsx)(G,{title:(__testT("Crab 全局技能")),note:(__testT("这些技能已安装到 Crab，全局工作区和支持的代理均可使用。")),children:__carbGlobalSkills.map(e=>(0,q.jsx)(to,{skill:e,configurable:!1,busy:!1,onToggle:()=>void 0},e.id))}):null';
  const to = 'C?(0,q.jsx)(Zn,{label:(__testT("Discovering skills…"))}):y?.skills.length?y.skills.map(t=>(0,q.jsx)(__carbSkillManager,{skill:t,transport:e.transport,provider:e.provider,projectPath:e.projectPath,onChanged:()=>u(e=>e+1)},t.id)):(0,q.jsx)(Xn,{title:(__testT("No Agent Skills found."))})';
  const brandedFrom = from.replace('Included with Test', 'Included with Carb');
  const matchingFrom = source.includes(from) ? from : brandedFrom;
  assert.equal(source.split(matchingFrom).length, 2, 'Skill list management anchor missing');
  return source.replace(matchingFrom, to);
}

export function patchSkillTransportValidation(source) {
  const marker = '__carbParseSkillInstallResult';
  if (source.includes(marker)) return source;
  const anchor = 'function f(e,t){let n=a(e,t);return n===void 0?i[e].result.parse(t):n}';
  assert.equal(source.split(anchor).length, 2, 'Skill RPC result parser anchor missing');
  const parser = 'function __carbParseSkillInstallResult(e,t){const object=n=>typeof n===`object`&&n!==null&&!Array.isArray(n),string=n=>typeof n===`string`,strings=n=>Array.isArray(n)&&n.every(string),uuid=n=>string(n)&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(n);if(e===`skills.previewInstall`){if(!object(t)||!uuid(t.previewId)||![`zip`,`folder`].includes(t.sourceType)||!string(t.sourceLabel)||!string(t.destination)||!Number.isFinite(t.expiresAt)||!strings(t.warnings)||!Array.isArray(t.skills)||!t.skills.every(n=>object(n)&&uuid(n.id)&&string(n.name)&&string(n.description)&&string(n.relativePath)&&Number.isInteger(n.files)&&n.files>=0&&Number.isFinite(n.bytes)&&n.bytes>=0&&typeof n.alreadyExists===`boolean`&&(n.blockedReason===void 0||string(n.blockedReason))))throw Error(`Invalid skills.previewInstall reply`);return t}if(e===`skills.commitInstall`){if(!object(t)||!Array.isArray(t.installed)||!strings(t.warnings)||!t.installed.every(n=>object(n)&&string(n.id)&&string(n.name)&&string(n.description)&&object(n.source)&&n.source.type===`folder`&&string(n.source.path)&&Array.isArray(n.dependencyErrors)))throw Error(`Invalid skills.commitInstall reply`);return t}if(e===`skills.discardInstall`){if(!object(t))throw Error(`Invalid skills.discardInstall reply`);return t}}';
  const replacement = parser + 'function f(e,t){let n=a(e,t);if(n!==void 0)return n;let r=__carbParseSkillInstallResult(e,t);return r===void 0?i[e].result.parse(t):r}';
  return source.replace(anchor, replacement);
}

export function patchSkillPicker(name, source) {
  if (name === 'dist/main.js') {
    const anchor = 'ipcMain.handle("harness:pickSkillFolder"';
    if (!source.includes('carb:pickSkillZip')) {
      assert.equal(source.split(anchor).length, 2, 'Native skill picker anchor missing');
      source = source.replace(anchor, 'ipcMain.handle("carb:pickSkillZip",async event=>{requireOwnRenderer(event.sender);let result=await dialog.showOpenDialog({properties:["openFile"],title:"选择技能 ZIP 文件 / Choose skill ZIP",filters:[{name:"ZIP",extensions:["zip"]}]});return result.canceled?void 0:result.filePaths[0]});' + anchor);
    }
    if (source.includes('carb:openSkillBrowser')) return source;
    assert.equal(source.split(anchor).length, 2, 'Native skill browser IPC anchor missing');
    const browser = `let __carbSkillBrowserWindow;let __carbSkillBrowserSession;let __carbSkillBrowserOwner;let __carbSkillBrowserDownloadRoot;const __carbSkillBrowserArchives=new Set;const __carbSkillWebUrl=value=>{try{let url=new URL(value);return url.protocol==="https:"||url.protocol==="http:"}catch{return false}};ipcMain.handle("carb:openSkillBrowser",async event=>{requireOwnRenderer(event.sender);if(__carbSkillBrowserWindow&&!__carbSkillBrowserWindow.isDestroyed()){__carbSkillBrowserWindow.show();__carbSkillBrowserWindow.focus();return true}__carbSkillBrowserOwner=BrowserWindow.fromWebContents(event.sender);__carbSkillBrowserDownloadRoot=path11.join(app.getPath("temp"),"Carb","skill-imports");await mkdir3(__carbSkillBrowserDownloadRoot,{recursive:true,mode:448});__carbSkillBrowserSession=session.fromPartition("carb-skill-browser");__carbSkillBrowserSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));__carbSkillBrowserWindow=new BrowserWindow({width:1120,height:820,minWidth:760,minHeight:600,parent:__carbSkillBrowserOwner,show:true,title:"Crab Skill 页面",webPreferences:{partition:"carb-skill-browser",contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false}});let browser=__carbSkillBrowserWindow;browser.webContents.setWindowOpenHandler(({url})=>{if(__carbSkillWebUrl(url))void browser.loadURL(url);return{action:"deny"}});browser.webContents.on("will-navigate",(navigationEvent,url)=>{if(!__carbSkillWebUrl(url))navigationEvent.preventDefault()});__carbSkillBrowserSession.on("will-download",(downloadEvent,item,contents)=>{if(contents!==browser.webContents){item.cancel();return}let filename=item.getFilename()||"",url=item.getURL()||"";if(!/\\.zip$/i.test(filename)&&!/\\.zip(?:$|[?#])/i.test(url)){item.cancel();return}let destination=path11.join(__carbSkillBrowserDownloadRoot,randomBytes(16).toString("hex")+".zip");item.setSavePath(destination);item.once("done",(_doneEvent,state)=>{if(state!=="completed"){void rm2(destination,{force:true});return}__carbSkillBrowserArchives.add(destination);let owner=__carbSkillBrowserOwner;if(owner&&!owner.isDestroyed()&&isOwnRenderer(owner.webContents))owner.webContents.send("carb:skillArchiveDownloaded",destination);else{__carbSkillBrowserArchives.delete(destination);void rm2(destination,{force:true})}})});browser.on("closed",()=>{if(__carbSkillBrowserWindow===browser)__carbSkillBrowserWindow=void 0});await browser.loadURL("https://findskill.com/");return true});ipcMain.handle("carb:discardSkillArchive",async(event,value)=>{requireOwnRenderer(event.sender);if(typeof value!=="string"||!__carbSkillBrowserArchives.has(value))return false;__carbSkillBrowserArchives.delete(value);await rm2(value,{force:true});return true});app.on("will-quit",()=>{for(let archive of __carbSkillBrowserArchives)void rm2(archive,{force:true});__carbSkillBrowserArchives.clear()});`;
    const handlerStart = browser.indexOf('__carbSkillBrowserSession.on("will-download",');
    const closedStart = browser.indexOf('browser.on("closed",', handlerStart);
    assert(handlerStart >= 0 && closedStart > handlerStart, 'Skill browser download handler anchors missing');
    const downloadHandler = `if(!__carbSkillBrowserDownloadHandler){__carbSkillBrowserDownloadHandler=(_downloadEvent,item,contents)=>{let activeBrowser=__carbSkillBrowserWindow;if(!activeBrowser||contents!==activeBrowser.webContents){item.cancel();return}let filename=item.getFilename()||"",url=item.getURL()||"",downloadedAsZip=filename.toLowerCase().endsWith(".zip");try{downloadedAsZip||=new URL(url).pathname.toLowerCase().endsWith(".zip")}catch{}if(!downloadedAsZip){item.cancel();return}let destination=path11.join(__carbSkillBrowserDownloadRoot,randomBytes(16).toString("hex")+".zip");item.setSavePath(destination);item.once("done",(_doneEvent,state)=>{if(state!=="completed"){void rm2(destination,{force:true});return}__carbSkillBrowserArchives.add(destination);let owner=__carbSkillBrowserOwner;if(owner&&!owner.isDestroyed()&&isOwnRenderer(owner.webContents))owner.webContents.send("carb:skillArchiveDownloaded",destination);else{__carbSkillBrowserArchives.delete(destination);void rm2(destination,{force:true})}})};__carbSkillBrowserSession.on("will-download",__carbSkillBrowserDownloadHandler)};`;
    let patchedBrowser = browser.replace('let __carbSkillBrowserDownloadRoot;', 'let __carbSkillBrowserDownloadRoot;let __carbSkillBrowserDownloadHandler;');
    assert.notEqual(patchedBrowser, browser, 'Skill browser download handler state anchor missing');
    const patchedHandlerStart = patchedBrowser.indexOf('__carbSkillBrowserSession.on("will-download",');
    const patchedClosedStart = patchedBrowser.indexOf('browser.on("closed",', patchedHandlerStart);
    assert(patchedHandlerStart >= 0 && patchedClosedStart > patchedHandlerStart, 'Patched skill browser handler anchors missing');
    patchedBrowser = patchedBrowser.slice(0, patchedHandlerStart) + downloadHandler + patchedBrowser.slice(patchedClosedStart);
    patchedBrowser = patchedBrowser.replace('app.on("will-quit",()=>{for(let archive', 'app.on("will-quit",()=>{if(__carbSkillBrowserDownloadHandler&&__carbSkillBrowserSession)__carbSkillBrowserSession.removeListener("will-download",__carbSkillBrowserDownloadHandler);__carbSkillBrowserDownloadHandler=void 0;for(let archive');
    assert.notEqual(patchedBrowser, browser.slice(0, handlerStart) + downloadHandler + browser.slice(closedStart), 'Skill browser shutdown cleanup anchor missing');
    return source.replace(anchor, patchedBrowser + anchor);
  }
  if (name === 'dist/preload.cjs') {
    const anchor = 'api={';
    assert.equal(source.split(anchor).length, 2, 'Native skill preload anchor missing');
    const additions = [
      source.includes('pickSkillZip:') ? '' : 'pickSkillZip:()=>import_electron.ipcRenderer.invoke("carb:pickSkillZip"),',
      source.includes('openSkillBrowser:') ? '' : 'openSkillBrowser:()=>import_electron.ipcRenderer.invoke("carb:openSkillBrowser"),',
      source.includes('onSkillArchiveDownloaded:') ? '' : 'onSkillArchiveDownloaded:listener=>{if(typeof listener!=="function")return()=>{};let handler=(_event,filePath)=>{typeof filePath==="string"&&filePath.length<=32768&&!filePath.includes("\\0")&&listener(filePath)};import_electron.ipcRenderer.on("carb:skillArchiveDownloaded",handler);return()=>import_electron.ipcRenderer.removeListener("carb:skillArchiveDownloaded",handler)},',
      source.includes('discardSkillArchive:') ? '' : 'discardSkillArchive:filePath=>import_electron.ipcRenderer.invoke("carb:discardSkillArchive",filePath),',
    ].join('');
    if (!additions) return source;
    return source.replace(anchor, anchor + additions);
  }
  return source;
}
