import assert from 'node:assert/strict';

const previousRendererLifecycle = 'function configureRendererLifecycle(contents,options){let recovered=!1;contents.on("did-navigate",()=>{options.cancelCaptures(),options.onPageReplaced()}),contents.on("destroyed",options.cancelCaptures),contents.on("render-process-gone",()=>{if(options.cancelCaptures(),!(options.isQuitting()||contents.isDestroyed())){if(recovered){options.onRepeatedCrash();return}recovered=!0,contents.reload()}})}';

export const rendererLifecycle = 'function configureRendererLifecycle(contents,options){let recovered=!1,healthyTimer;contents.on("did-navigate",()=>{options.cancelCaptures(),options.onPageReplaced()}),contents.on("did-finish-load",()=>{healthyTimer&&clearTimeout(healthyTimer),healthyTimer=setTimeout(()=>{healthyTimer=void 0,recovered=!1},3e4)}),contents.on("destroyed",()=>{healthyTimer&&clearTimeout(healthyTimer),options.cancelCaptures()}),contents.on("render-process-gone",()=>{healthyTimer&&(clearTimeout(healthyTimer),healthyTimer=void 0),options.cancelCaptures(),!(options.isQuitting()||contents.isDestroyed())&&(recovered?options.onRepeatedCrash():(recovered=!0,contents.reload()))})}';

export function patchRendererLifecycle(source) {
  if (source.includes('healthyTimer=void 0,recovered=!1')) return source;
  assert.equal(source.split(previousRendererLifecycle).length, 2, 'Renderer recovery lifecycle anchor is present once');
  return source.replace(previousRendererLifecycle, rendererLifecycle);
}

export function patchAuthUrlCalls(source) {
  if (source.includes('function __carbOpenAuthUrl(')) return source;
  const helper = `function __carbOpenAuthUrl(url){let bridge=window.carb??window.harness;if(bridge?.openExternal)return Promise.resolve().then(()=>bridge.openExternal(url)).then(()=>({opened:!0,copied:!1}),async error=>{try{await bridge.writeClipboardText(url);return{opened:!1,copied:!0,error}}catch{return{opened:!1,copied:!1,error}}});try{return Promise.resolve({opened:!!window.open(url,"_blank","noopener,noreferrer"),copied:!1})}catch(error){return Promise.resolve({opened:!1,copied:!1,error})}}`;
  const mcpFrom = 'delete r.completion,window.open(n.authUrl,`_blank`,`noopener,noreferrer`)?f(`Finish signing in in your browser.`):f(`Your browser blocked the sign-in window. Open it yourself: ${n.authUrl}`)';
  const mcpTo = 'delete r.completion,void __carbOpenAuthUrl(n.authUrl).then(e=>f(e.opened?`Finish signing in in your browser.`:e.copied?`Could not open the browser. The sign-in link was copied to the clipboard.`:`Your browser could not open the sign-in link: ${n.authUrl}`))';
  const startFrom = 'r.authUrl&&window.open(r.authUrl,`_blank`,`noopener,noreferrer`)';
  const startTo = 'r.authUrl&&void __carbOpenAuthUrl(r.authUrl).then(o=>{o.opened||f(e=>({...e,[t]:o.copied?`Could not open the browser. The sign-in link was copied to the clipboard.`:`Your browser could not open the sign-in link: ${r.authUrl}`}))})';
  const reopenFrom = 'r.openedAuthUrl?(0,q.jsx)(`button`,{className:`set-button`,type:`button`,onClick:()=>window.open(r.openedAuthUrl,`_blank`,`noopener,noreferrer`),children:(__testT("Open link again"))}):null';
  const reopenTo = 'r.openedAuthUrl?(0,q.jsxs)(q.Fragment,{children:[(0,q.jsx)(`button`,{className:`set-button`,type:`button`,onClick:()=>{void __carbOpenAuthUrl(r.openedAuthUrl).then(e=>e.copied?l(!0):void 0)},children:(__testT("Open link again"))}),(0,q.jsx)(`button`,{className:`set-button`,type:`button`,onClick:()=>{Ve(r.openedAuthUrl).then(()=>l(!0),()=>void 0)},children:c?(__testT("Copied")):(__testT("Copy link"))})]}):null';
  for (const anchor of [mcpFrom, startFrom, reopenFrom]) {
    assert.equal(source.split(anchor).length, 2, `Auth link anchor is present once: ${anchor}`);
    source = source.replace(anchor, ({ [mcpFrom]: mcpTo, [startFrom]: startTo, [reopenFrom]: reopenTo })[anchor]);
  }
  const importAnchor = "import {createSkillInstaller as __carbCreateSkillInstaller} from './carb-skill-installer.js';\n";
  assert(source.startsWith(importAnchor), 'Skill installer import remains first');
  return source.replace(importAnchor, importAnchor + helper + '\n');
}
