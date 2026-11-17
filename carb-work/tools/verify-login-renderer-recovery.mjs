import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { patchRendererLifecycle, rendererLifecycle } from './patch-login-renderer-recovery.mjs';
import { patchSkillWeb } from './patch-skill-web.mjs';
import { patchSkillOrchestrator } from './patch-skill-install.mjs';

const overlay = 'D:/TasteCode/carb-work/overlay';
const mainSource = await fs.readFile(`${overlay}/asar/dist/main.js`, 'utf8');
const settingsSource = await fs.readFile(`${overlay}/resources/web/assets/Settings-CdgxHJV3.js`, 'utf8');
const patchedMain = patchRendererLifecycle(mainSource);
const patchedSettings = patchSkillWeb(settingsSource);
const skillsComponentStart = patchedSettings.indexOf('function Qa(e)');
const skillsComponentEnd = patchedSettings.indexOf('const __carbSkillInstall=', skillsComponentStart);
assert(skillsComponentStart >= 0 && skillsComponentEnd > skillsComponentStart, 'The compiled Skills settings component remains present');
const skillsComponent = patchedSettings.slice(skillsComponentStart, skillsComponentEnd);
const orchestratorSource = await fs.readFile('D:/TasteCode/carb-work/verification/backend-app/node_modules/@harness/server/dist/orchestrator.js', 'utf8');
const patchedOrchestrator = patchSkillOrchestrator(orchestratorSource);
assert.notEqual(patchedMain, mainSource, 'Renderer crash recovery is patched in the main process');
assert(patchedSettings.includes('(__carbSkillInstall,{enabled:true,'), 'The global installer is enabled without a selected workspace or provider skill-list capability');
assert(patchedSettings.includes('projectPath:void 0,onInstalled:'), 'Global installation does not pass a workspace path');
assert(!patchedSettings.includes('enabled:!!e.projectPath&&!!y?.capabilities.install'), 'Installer enablement does not depend on projectPath or skills.list capability');
assert(!patchedSettings.includes('enabled:!!y?.capabilities.install'), 'Installer enablement does not depend on provider skill-list capability');
assert(!patchedSettings.includes('actions:e.projectPath&&y?.capabilities.install?'), 'Global installer entry is not hidden when no workspace is selected');
assert(!patchedSettings.includes('if(!e.projectPath){d.current+=1,n(void 0)'), 'Global and bundled skills are still skipped without a workspace');
assert(patchedSettings.includes('__carbGlobalSkills=y?.skills.filter(e=>e.scope===`global`)??[]'), 'Global skills returned by skills.list are separated for display');
assert(patchedSettings.includes('y.skills.map(t=>(0,q.jsx)(__carbSkillManager'), 'All discovered skills appear in the management list');
assert(patchedSettings.includes('e.transport.request(`skills.list`,{provider:e.provider,projectPath:e.projectPath})'), 'The skill inventory request still runs with an optional workspace path');
assert(patchedSettings.includes('onInstalled:()=>u(e=>e+1)'), 'Successful installs trigger a fresh skill inventory request');
assert(patchedSettings.includes('},[e.transport,e.provider,e.projectPath,l])'), 'The post-install refresh counter reruns the skill inventory effect');
assert(!skillsComponent.includes('Select a project in the sidebar first.'), 'The settings UI no longer blocks the global skill view without a project');
assert(patchedOrchestrator.includes('if (!projectPath) {\n            return { capabilities: NO_SKILL_CAPABILITIES, skills: mergeSkills(global.skills, bundled), errors: [...global.errors] };'), 'No-workspace skills.list returns the global and bundled inventory without calling cwd-dependent APIs');
assert(patchedOrchestrator.includes('const local = projectPath && control.capabilities.agentsSkillsDir'), 'Local skill enumeration is skipped when no workspace is selected');
assert.equal(patchSkillOrchestrator(patchedOrchestrator), patchedOrchestrator, 'No-workspace inventory handling is idempotent');
assert(patchedSettings.includes('function __carbOpenAuthUrl('), 'Auth links use the explicit external-link helper');
assert(!/window\.open\([nr]\.authUrl/.test(patchedSettings), 'OAuth auth URLs no longer rely on window.open return values');
assert(!patchedSettings.includes('window.open(r.openedAuthUrl'), 'The login retry button uses the controlled external-link helper');
assert(patchedSettings.includes('bridge.writeClipboardText(url)'), 'A failed browser launch copies the URL when possible');
assert(patchedSettings.includes('(__testT("Copy link"))'), 'The sign-in panel exposes a direct copy-link action');

function getHelper(window) {
  const helperStart = patchedSettings.indexOf('function __carbOpenAuthUrl(');
  const helperEnd = patchedSettings.indexOf('\n', helperStart);
  assert(helperStart >= 0 && helperEnd > helperStart, 'Auth link helper can be isolated for behavior tests');
  return new vm.Script(`(${patchedSettings.slice(helperStart, helperEnd)})`).runInNewContext({ window });
}

const opened = [];
const copied = [];
const openHelper = getHelper({ carb: {
  async openExternal(url) { opened.push(url); },
  async writeClipboardText(url) { copied.push(url); },
} });
const successfulOpen = await openHelper('https://auth.example/start');
assert.equal(successfulOpen.opened, true);
assert.equal(successfulOpen.copied, false);
assert.deepEqual(opened, ['https://auth.example/start']);
assert.deepEqual(copied, []);

const failedOpenHelper = getHelper({ harness: {
  async openExternal() { throw new Error('browser unavailable'); },
  async writeClipboardText(url) { copied.push(url); },
} });
const copiedAfterFailure = await failedOpenHelper('https://auth.example/retry');
assert.equal(copiedAfterFailure.opened, false);
assert.equal(copiedAfterFailure.copied, true);
assert.deepEqual(copied, ['https://auth.example/retry']);

const failedFallbackHelper = getHelper({ harness: {
  async openExternal() { throw new Error('browser unavailable'); },
  async writeClipboardText() { throw new Error('clipboard unavailable'); },
} });
const failedFallback = await failedFallbackHelper('https://auth.example/manual');
assert.equal(failedFallback.opened, false);
assert.equal(failedFallback.copied, false);
assert.match(failedFallback.error.message, /browser unavailable/);

const popupCalls = [];
const browserFallback = getHelper({ open(url, target, features) { popupCalls.push([url, target, features]); return {}; } });
const popupResult = await browserFallback('https://auth.example/web');
assert.equal(popupResult.opened, true);
assert.equal(popupResult.copied, false);
assert.deepEqual(popupCalls, [['https://auth.example/web', '_blank', 'noopener,noreferrer']]);

let nextTimer = 0;
const timers = new Map();
const cleared = [];
const sandbox = {
  setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
  clearTimeout(id) { cleared.push(id); timers.delete(id); },
};
const configure = new vm.Script(`(${rendererLifecycle})`).runInNewContext(sandbox);
const listeners = new Map();
const calls = { reload: 0, repeated: 0, cancelCaptures: 0, replaced: 0, destroyed: false, quitting: false };
const contents = {
  on(event, listener) { listeners.set(event, listener); },
  isDestroyed() { return calls.destroyed; },
  reload() { calls.reload++; },
};
configure(contents, {
  cancelCaptures() { calls.cancelCaptures++; },
  onPageReplaced() { calls.replaced++; },
  onRepeatedCrash() { calls.repeated++; },
  isQuitting() { return calls.quitting; },
});
const emit = event => listeners.get(event)?.();
emit('render-process-gone');
assert.equal(calls.reload, 1, 'First renderer crash reloads automatically');
emit('render-process-gone');
assert.equal(calls.repeated, 1, 'A second crash before a stable load reports repeated failure');
emit('did-finish-load');
const healthyTimer = [...timers.keys()][0];
assert.equal(timers.get(healthyTimer).delay, 30_000);
timers.get(healthyTimer).callback();
timers.delete(healthyTimer);
emit('render-process-gone');
assert.equal(calls.reload, 2, 'A later isolated crash is eligible for automatic recovery again');
emit('did-finish-load');
const pendingTimer = [...timers.keys()][0];
emit('render-process-gone');
assert(cleared.includes(pendingTimer), 'A crash cancels the current health window');
assert.equal(calls.repeated, 2, 'A crash during the health window remains protected');
emit('did-navigate');
assert.equal(calls.replaced, 1, 'Page replacement still cancels captures and is reported');
calls.destroyed = true;
emit('destroyed');
assert.equal(calls.cancelCaptures, 6, 'Renderer lifecycle keeps capture cancellation on crash, navigation, and destroy');
console.log('Login link fallback and renderer crash recovery checks passed.');
