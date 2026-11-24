import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function patchDesktopStability(source) {
  function replaceOnce(needle, replacement) {
    assert.equal(source.split(needle).length, 2, `Unexpected desktop bundle anchor: ${needle.slice(0, 120)}`);
    source = source.replace(needle, () => replacement);
  }

  const lifecycle = source.match(/function configureRendererLifecycle\(contents,options\)\{[^\r\n]+?(?=import\{spawn as spawn2\})/u);
  assert(lifecycle, 'Expected the Carb 5.6.13 renderer lifecycle');
  replaceOnce(lifecycle[0], 'import{configureRendererLifecycle}from"./carb-renderer-recovery.mjs";');

  const launch = 'let child="launch"in this.#options?this.#options.launch():supervisedChildProcess((this.#options.spawnFn??spawn2)(this.#options.command,this.#options.args,{env:this.#options.env,...this.#options.cwd?{cwd:this.#options.cwd}:{},stdio:["ignore","pipe","pipe","ipc"],windowsHide:!0}));';
  replaceOnce('start(){if(this.#stopped||this.#child)return;this.#startedAt=Date.now();'+launch, `
start(){
  if(this.#stopped||this.#child||this.#restartTimer!==void 0||this.#gaveUp)return;
  this.#startedAt=Date.now();
  let child;
  try {
    ${launch.slice(4)}
  } catch(error) {
    this.#options.onLog(\`server failed to start: \${String(error)}\`);
    this.#scheduleRestart();
    return;
  }
`);
  replaceOnce('#onExit(child){if(this.#child!==child||(this.#child=void 0,this.#stopped))return;', `#onExit(child){
  if(this.#child!==child)return;
  this.#child=void 0;
  this.#scheduleRestart();
}
#scheduleRestart(){
  if(this.#stopped||this.#restartTimer!==void 0||this.#gaveUp)return;
`);

  const crashLog = 'window.webContents.on("render-process-gone",(_event,details)=>{console.error(`[desktop] main window renderer exited: ${details.reason} (code ${details.exitCode})`),diagnostics?.record("renderer crash",`${details.reason} (code ${details.exitCode})`)});';
  replaceOnce(`,${crashLog}`, ';');
  const lifecycleOptions = source.match(/configureRendererLifecycle\(window\.webContents,\{cancelCaptures:[^\r\n]+?\}\}\)(?=,window\.webContents\.once\("did-finish-load")/u);
  assert(lifecycleOptions, 'Expected to find the Carb 5.6.13 startup window recovery callback');
  replaceOnce(`,${lifecycleOptions[0]},`, `;
const loadRenderer=configureRendererLifecycle(window.webContents,{
  cancelCaptures:()=>previewCaptures.cancelAll(),
  onPageReplaced:()=>{
    nativeMenuDispatch.reset(window.webContents);
    chatNotifier.pageReplaced();
    window.webContents.setIgnoreMenuShortcuts(false);
  },
  isQuitting:()=>appIsQuitting,
  loadPage:()=>window.loadURL(devServer??rendererFileUrl(rendererIndexPath())),
  onFailure:({kind,reason,exitCode})=>{
    const detail=\`\${kind}: \${reason}\${exitCode===void 0?"":\` (code \${exitCode})\`}\`;
    console.error(\`[desktop] renderer recovery: \${detail}\`);
    diagnostics?.record("renderer recovery",detail);
  },
  onRepeatedCrash:({reason},retry)=>{
    if(recoveryPromptOpen)return;
    recoveryPromptOpen=true;
    const en=testNativeLanguage==="en";
    const message={
      type:"error",title:nativeAppName,
      message:en?"Carb could not load the window.":"Carb 窗口未能恢复。",
      detail:en?\`Retry loading the window. (\${reason})\`:\`可重新加载窗口。（\${reason}）\`,
      buttons:en?["Retry","Not now"]:["重新加载","稍后"],defaultId:0,cancelId:1
    };
    const prompt=window.isVisible()?dialog.showMessageBox(window,message):dialog.showMessageBox(message);
    prompt.then(({response})=>{if(response===0)retry()})
      .catch(error=>console.error("[desktop] could not display the recovery prompt",error))
      .finally(()=>{recoveryPromptOpen=false});
  }
});
`);
  replaceOnce('devServer?window.loadURL(devServer):window.loadURL(rendererFileUrl(rendererIndexPath()))}', 'loadRenderer()}');

  const readyEnd = 'restoreMainWindowPresence(process.platform,app,window)}))}));function configureAttachmentPreviews()';
  replaceOnce(readyEnd, `restoreMainWindowPresence(process.platform,app,window)}))}).catch(error=>{
  console.error("[desktop] startup failed",error);
  diagnostics?.record("startup",error);
  if(appIsQuitting)return;
  dialog.showErrorBox(nativeAppName,testNativeLanguage==="en"?"Carb could not start. Close the app and try again.":"Carb 启动失败，请退出后重试。");
  app.quit();
}));function configureAttachmentPreviews()`);
  return source;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , main, overlay] = process.argv;
  assert(main && overlay, 'Usage: node patch-desktop-stability.mjs <original main.js> <overlay-directory>');
  const dist = path.join(overlay, 'dist');
  await mkdir(dist, { recursive: true });
  await writeFile(path.join(dist, 'main.js'), patchDesktopStability(await readFile(main, 'utf8')));
  await cp(new URL('../../app/asar/dist/carb-renderer-recovery.mjs', import.meta.url), path.join(dist, 'carb-renderer-recovery.mjs'));
}
