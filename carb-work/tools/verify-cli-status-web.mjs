import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cliStatusHelper, formatCliInstallStatus, patchCliStatusWeb } from './patch-cli-status-web.mjs';

const root = new URL('../overlay/resources/web/assets/', import.meta.url);
const payload = process.env.CARB_INSTALL_PAYLOAD;
const names = ['Settings-CdgxHJV3.js', 'Onboarding-Bx0aaqrc.js', 'index-dY3kjCLH.js'];
const patched = new Map();
for (const name of names) {
  const before = await fs.readFile(payload ? path.join(path.resolve(payload), 'resources/web/assets', name) : new URL(name, root), 'utf8');
  const after = patchCliStatusWeb(`assets/${name}`, before);
  if (payload) assert.equal(after, before, `${name} is already patched in the packaged payload`);
  else assert.notEqual(after, before, `${name} is patched`);
  assert.equal(patchCliStatusWeb(`assets/${name}`, after), after, `${name} patch is idempotent`);
  // Syntax-check complete ESM bundles without executing browser dependencies.
  execFileSync(process.execPath, ['--check', '--input-type=module'], { input: after });
  patched.set(name, after);
}

// Provider rows accept ReactNode, not just strings. Signed-in accounts use a
// Yl element whose props retain the account email and plan. Keep that exact
// element intact through the helper, and make accidental stringification fail.
const fragment = Symbol.for('react.fragment');
const element = (type, props) => Object.freeze({
  $$typeof: Symbol.for('react.transitional.element'), type, key: null,
  props: Object.freeze(props),
  toString() { throw new Error('A provider status React element was stringified'); },
});
const jsxRuntime = { Fragment: fragment, jsx: element, jsxs: element };
const account = Object.freeze({ signedIn: true, email: 'qa@example.test', plan: 'Pro' });
const SignedInAccount = props => element('span', { children: [props.account.email, ' · ', props.account.plan] });
const accountStatus = element(SignedInAccount, { provider: 'codex', account });
function renderedText(value) {
  if (value === undefined || value === null || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(renderedText).join('');
  assert.equal(value.$$typeof, Symbol.for('react.transitional.element'));
  return renderedText(typeof value.type === 'function' ? value.type(value.props) : value.props.children);
}

for (const language of ['en', 'zh-CN']) {
  const translate = text => language === 'zh-CN' ? ({ Installed: '已安装', 'Not installed': '未安装', 'Signed in': '已登录' }[text] ?? text) : text;
  for (const runtimeName of ['q', 'A']) {
  const format = new vm.Script(`${cliStatusHelper(runtimeName)};__carbCliStatus`).runInNewContext({
    __testLocale: () => language, __testT: translate, [runtimeName]: jsxRuntime,
  });
  const base = { id: 'codex', installed: false, desktopInstalled: false };
  assert.equal(format(base, translate('Not installed')), language === 'en' ? 'CLI not installed' : 'CLI 未安装');
  assert.equal(format({ ...base, desktopInstalled: true }, translate('Not installed')), language === 'en' ? 'Desktop installed; CLI required' : '桌面版已安装，需安装 CLI');
  assert.equal(format({ ...base, desktopInstalled: true }, '桌面版已安装，需安装 CLI'), language === 'en' ? 'Desktop installed; CLI required' : '桌面版已安装，需安装 CLI');
  assert.equal(format({ ...base, installed: true }, translate('Installed')), language === 'en' ? 'CLI installed' : 'CLI 已安装');
  const both = { ...base, installed: true, desktopInstalled: true };
  const bothLabel = language === 'en' ? 'CLI + desktop installed' : 'CLI、桌面版均已安装';
  assert.equal(format(both, translate('Installed')), bothLabel);
  for (const empty of [undefined, null, '', false]) {
    assert.equal(format(both, empty), bothLabel, 'Absent account status retains the installation label');
  }
  assert.equal(format(both, translate('Signed in')), `${bothLabel} · ${translate('Signed in')}`);
  assert.equal(format(both, `OpenAI · ${translate('Installed')}`), `OpenAI · ${bothLabel}`);
  for (const phase of ['Installing…', 'Checking…', 'Install failed', 'Installed · refreshing…']) {
    assert.equal(format({ ...base, desktopInstalled: true }, phase), phase, 'An auxiliary desktop signal does not mask the active install state');
  }
  assert.equal(format({ id: 'claude', installed: true, desktopInstalled: true }, 'Signed in'), 'Signed in', 'Other providers retain their existing wording');
  const composed = format(both, accountStatus);
  assert.equal(composed.type, fragment, `${runtimeName} composes account status with the bundle JSX runtime`);
  assert.equal(composed.props.children[0], bothLabel);
  assert.equal(composed.props.children[1], ' · ');
  assert.equal(composed.props.children[2], accountStatus, 'The original signed-in component is preserved by identity');
  assert.equal(composed.props.children[2].props.account, account, 'Account props retain their original identity');
  assert.equal(renderedText(composed), `${bothLabel} · qa@example.test · Pro`, 'CLI readiness, email, and plan all remain visible');
  const cliOnlyLabel = language === 'en' ? 'CLI installed' : 'CLI 已安装';
  assert.equal(renderedText(format({ ...base, installed: true }, accountStatus)), `${cliOnlyLabel} · qa@example.test · Pro`);
  assert.equal(format(base, accountStatus), accountStatus, 'An unexpected node on a missing CLI remains intact');
  assert.equal(format(undefined, accountStatus), accountStatus, 'An absent provider preserves its status node');
  assert.equal(format({ id: 'claude', installed: true }, accountStatus), accountStatus, 'Other provider account nodes remain intact');
  assert.equal(formatCliInstallStatus(both, accountStatus, language, translate), accountStatus, 'The pure formatter preserves nodes without a renderer composer');
  }
}

const main = patched.get('index-dY3kjCLH.js');
const validatorStart = main.indexOf('function h_(e)');
const validatorEnd = main.indexOf('function V_(e)', validatorStart);
assert(validatorStart >= 0 && validatorEnd > validatorStart);
const validate = new vm.Script(`${main.slice(validatorStart, validatorEnd)};R_`).runInNewContext();
const reply = { providers: [{ id: 'codex', displayName: 'Codex', installed: false, desktopInstalled: true, cliPath: 'C:/Tools/codex.exe', auth: 'unknown' }] };
assert.equal(validate(reply), reply, 'The fast transport parser retains CLI and desktop properties');
assert.equal(validate({ providers: [{ ...reply.providers[0], desktopInstalled: 'yes' }] }), undefined);
assert.equal(validate({ providers: [{ ...reply.providers[0], cliPath: false }] }), undefined);
assert.equal(validate({ providers: [{ id: 'codex', displayName: 'Codex', installed: false, auth: 'unknown' }] })?.providers[0].installed, false, 'Legacy replies remain supported');
const compareStart = main.indexOf('function iA(e,t)');
const compareEnd = main.indexOf('function aA(', compareStart);
assert(compareStart >= 0 && compareEnd > compareStart);
const changed = new vm.Script(`(${main.slice(compareStart, compareEnd)})`).runInNewContext();
const original = [{ id: 'codex', installed: true, auth: 'authenticated', cliPath: 'C:/Users/example/.local/bin/codex.exe' }];
assert.equal(changed(original, original), false);
assert.equal(changed(original, [{ ...original[0], desktopInstalled: true }]), true, 'Installing the desktop app refreshes auxiliary state');
assert.equal(changed(original, [{ ...original[0], cliPath: 'C:/Users/example/AppData/Roaming/npm/codex.cmd' }]), true, 'Switching to a distinct CLI refreshes its resolved location');
assert.equal(changed(original, [{ ...original[0], desktopInstalled: false }]), false, 'Absent auxiliary desktop state is equivalent to false');
assert.equal(changed(original, [{ ...original[0], installed: false, desktopInstalled: true }]), true, 'A desktop installation cannot preserve CLI readiness after CLI removal');
assert(main.includes('desktopInstalled:H().optional(),cliPath:B().optional()'), 'The schema retains auxiliary status fields');
assert(main.includes('desktopInstalled:x_(v_),cliPath:x_(__)'), 'The fast validator checks optional field types');
assert(patched.get('Onboarding-Bx0aaqrc.js').includes('installed:n?.installed??!1'), 'Unknown status does not count as an installed CLI');
assert(patched.get('Onboarding-Bx0aaqrc.js').startsWith(cliStatusHelper('A')), 'Onboarding uses its own JSX runtime when composing node statuses');
assert(patched.get('Settings-CdgxHJV3.js').startsWith(cliStatusHelper('q')), 'Settings uses its own JSX runtime when composing signed-in accounts');
assert(patched.get('Settings-CdgxHJV3.js').includes('title:[e.provider.version,e.provider.cliPath].filter(Boolean).join(`\\n`)'), 'The CLI location tooltip also preserves the existing version information');
console.log('CLI and desktop renderer status checks passed.');
