import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { patchProviderCliDetection, patchProviderStatusContract, patchCodexUpdateCommand } from './patch-cli-detection.mjs';
import { readAsar } from './asar-files.mjs';

const backend = new URL('../verification/backend-app/node_modules/@harness/', import.meta.url);
const files = ['server/dist/providers.js', 'contracts/dist/domain.js', 'adapter-codex/dist/updates.js'];
const payload = process.env.CARB_INSTALL_PAYLOAD;
const archive = payload ? await readAsar(path.join(path.resolve(payload), 'resources', 'app.asar')) : undefined;
const sources = await Promise.all(files.map(name => archive
  ? archive.entries.get(`node_modules/@harness/${name}`)?.toString('utf8')
  : fs.readFile(new URL(name, backend), 'utf8')));
for (const [index, source] of sources.entries()) assert.equal(typeof source, 'string', `${files[index]} is present`);
const patched = [patchProviderCliDetection(sources[0]), patchProviderStatusContract(sources[1]), patchCodexUpdateCommand(sources[2])];
for (const [index, transform] of [patchProviderCliDetection, patchProviderStatusContract, patchCodexUpdateCommand].entries()) {
  if (payload) assert.equal(sources[index], patched[index], `${files[index]} is already patched in the packaged payload`);
  assert.equal(transform(patched[index]), patched[index], `${files[index]} transformation is idempotent`);
  execFileSync(process.execPath, ['--check', '--input-type=module'], { input: patched[index] });
}

const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const candidateSource = archive
  ? archive.entries.get('node_modules/@harness/proc/dist/carb-cli-candidates.js')?.toString('utf8')
  : await fs.readFile(new URL('../overlay/asar/node_modules/@harness/proc/dist/carb-cli-candidates.js', import.meta.url), 'utf8');
assert.equal(typeof candidateSource, 'string', 'The CLI candidate and shell-command helper is present');
const candidates = await import(dataUrl(candidateSource));
let scenario;
const newScenario = (overrides = {}) => scenario = {
  cli: false, desktop: false, selected: path.resolve('C:/Users/Test User/.local/bin/codex.exe'),
  otherInstalled: false, updatePath: undefined, help: { code: 0, stdout: 'codex update [OPTIONS]' },
  locateCalls: [], shellCalls: [], runCalls: [], versionCalls: [], desktopCalls: 0, ...overrides,
};

// Import the actual transformed modules with controlled boundary dependencies.
// Nothing in this check spawns a CLI, installer, browser or updater.
const stateKey = `__carbProviderCliCheck${Date.now()}`;
const capabilities = { steer: true, fork: true, interrupt: true, reasoningItems: true, approvals: true, images: true };
const state = {
  ACP_CAPABILITIES: capabilities, ANTIGRAVITY_CAPABILITIES: capabilities, CURSOR_CAPABILITIES: capabilities, OPENCODE_CAPABILITIES: capabilities,
  PI_CAPABILITIES: capabilities, CLAUDE_CAPABILITIES: capabilities, CODEX_CAPABILITIES: capabilities, GROK_CAPABILITIES: capabilities,
  CLAUDE_UPDATES: {}, GROK_UPDATES: {},
  antigravityInstallCommand: () => 'install antigravity', cursorInstallCommand: () => 'install cursor',
  claudeInstallCommand: () => 'install claude', grokInstallCommand: () => 'install grok',
  codexLoginStatus: async () => 'authenticated', refreshWindowsPath: async () => {},
  providerOffered: () => true, assertProviderOffered: () => {},
  locateCommand: async command => { scenario.locateCalls.push(command); return command === 'codex' && scenario.cli ? scenario.selected : undefined; },
  detectAgentDesktops: async () => { scenario.desktopCalls++; return { codex: scenario.desktop }; },
  cliShellCommand: (executable, args) => { scenario.shellCalls.push({ executable, args }); return candidates.cliShellCommand(executable, args); },
  cliProbe: {
    installed: async command => command === 'codex' ? scenario.cli : scenario.otherInstalled,
    version: async command => { scenario.versionCalls.push(command); return '1.2.3'; },
    binary: async () => undefined,
  },
  detectAgents: async () => [], findAgentSpec: () => undefined,
  cliPath: async command => { assert.equal(command, 'codex'); return scenario.updatePath; },
  runCli: async (command, args) => { scenario.runCalls.push({ command, args }); return scenario.help; },
  latestNpmVersion: async () => '2.0.0', latestBrewVersion: async () => '2.0.0',
};
globalThis[stateKey] = state;
const stubUrl = dataUrl(`const s=globalThis[${JSON.stringify(stateKey)}];\n` + Object.keys(state).map(name => `export const ${name}=s.${name};`).join('\n'));
const rewriteImports = (source, overrides = {}) => source.replace(/(['"])([^'"\r\n]+)\1/g, (full, quote, specifier) => {
  if (overrides[specifier]) return JSON.stringify(overrides[specifier]);
  return specifier.startsWith('@harness/') || specifier.endsWith('/carb-cli-candidates.js') || specifier.endsWith('/carb-desktop-detection.js') || ['./cli-probe.js', './provider-edition.js'].includes(specifier)
    ? JSON.stringify(stubUrl) : full;
});

function assertSelectedShellCommand(command, executable, argument) {
  assert.equal(command, candidates.cliShellCommand(executable, [argument]));
  if (process.platform === 'win32') {
    const encoded = /-EncodedCommand\s+([A-Za-z0-9+/=]+)$/.exec(command)?.[1];
    assert(encoded, 'Windows interactive CLI commands survive cmd/node-pty argv assembly through encoded PowerShell');
    const script = Buffer.from(encoded, 'base64').toString('utf16le');
    assert(script.includes(executable), 'The encoded launch script names the selected absolute CLI');
    assert(script.includes(`'${argument}'`), 'The encoded launch script preserves its explicit login/update argument');
    assert.doesNotMatch(command, /-NonInteractive/, 'Provider login remains interactive');
  }
}

try {
  const updatesUrl = dataUrl(rewriteImports(patched[2]));
  const updates = await import(updatesUrl);
  const providers = await import(dataUrl(rewriteImports(patched[0], { '@harness/adapter-codex/updates': updatesUrl })));
  const require = createRequire(new URL('contracts/package.json', backend));
  // The verification extraction contains the ESM distribution; its package's
  // CommonJS entry intentionally is not part of the extracted production files.
  const zodUrl = pathToFileURL(path.join(path.dirname(require.resolve('zod/package.json')), 'index.js')).href;
  const contracts = await import(dataUrl(patched[1].replace("from 'zod'", `from ${JSON.stringify(zodUrl)}`)));

  for (const cli of [false, true]) for (const desktop of [false, true]) {
    newScenario({ cli, desktop });
    const statuses = await providers.detectProviders();
    const codex = statuses.find(item => item.id === 'codex');
    assert.equal(codex.installed, cli, 'CLI readiness is independent of desktop presence');
    assert.equal(codex.desktopInstalled, desktop, 'Desktop presence is auxiliary');
    assert.equal(codex.cliPath, cli ? scenario.selected : undefined);
    assert.equal(codex.auth, cli ? 'authenticated' : 'unknown');
    assert.equal(scenario.desktopCalls, 1, 'One auxiliary desktop check is enough per provider listing');
    assert.equal(scenario.versionCalls.includes('codex'), cli, 'A missing CLI is never executed just because the desktop app exists');
    if (!cli) assert.match(codex.problem, desktop ? /desktop is installed.*standalone Codex CLI/ : /CLI was not found/);
    const parsed = contracts.ProviderStatusSchema.parse(codex);
    assert.equal(parsed.desktopInstalled, desktop, 'The real Zod contract retains desktop information');
    assert.equal(parsed.cliPath, cli ? scenario.selected : undefined, 'The real Zod contract retains the selected CLI path');
    for (const other of statuses.filter(item => item.id !== 'codex')) {
      assert.equal(Object.hasOwn(other, 'desktopInstalled'), false, `${other.id} receives no Codex desktop fields`);
      assert.equal(Object.hasOwn(other, 'cliPath'), false, `${other.id} receives no Codex CLI fields`);
    }
  }

  const minimal = { id: 'codex', displayName: 'Codex', installed: false, auth: 'unknown' };
  assert(contracts.ProviderStatusSchema.safeParse(minimal).success, 'Replies without optional desktop/CLI metadata remain valid');
  assert.equal(contracts.ProviderStatusSchema.safeParse({ ...minimal, desktopInstalled: 'yes' }).success, false);
  assert.equal(contracts.ProviderStatusSchema.safeParse({ ...minimal, cliPath: false }).success, false);

  newScenario({ cli: true, desktop: true });
  assertSelectedShellCommand(await providers.launchCommandFor('codex'), scenario.selected, 'login');
  assert.deepEqual(scenario.shellCalls, [{ executable: scenario.selected, args: ['login'] }], 'Login uses the selected absolute CLI path with shell quoting');
  assert.equal(await providers.launchCommandFor('claude-code'), 'claude auth login');
  assert.equal(await providers.launchCommandFor('grok'), 'grok login');
  assert.equal(await providers.launchCommandFor('opencode'), 'opencode auth login');
  assert.equal(await providers.launchCommandFor('antigravity'), 'agy');
  newScenario({ desktop: true });
  await assert.rejects(providers.launchCommandFor('codex'), /standalone Codex CLI/);

  newScenario({ cli: true, desktop: true });
  const skip = await providers.installCommandFor('codex');
  assert.match(skip, /already installed.*Skipping installation/);
  assert.doesNotMatch(skip, /Invoke-RestMethod|install\.ps1|npm install|install\.sh/);
  newScenario({ desktop: true });
  assert.equal(await providers.installCommandFor('codex'), updates.codexInstallCommand(), 'A desktop-only installation still offers the standalone CLI installer');
  assert.equal(await providers.installCommandFor('claude-code'), 'install claude');
  assert.equal(await providers.installCommandFor('grok'), 'install grok');
  await assert.rejects(providers.installCommandFor('nonexistent'), /unknown install target/);

  newScenario({ cli: true });
  scenario.updatePath = scenario.selected;
  const native = await updates.CODEX_UPDATES.check('1.0.0');
  assert.equal(native.latestVersion, '2.0.0');
  assertSelectedShellCommand(native.command, scenario.selected, 'update');
  assert.deepEqual(scenario.shellCalls, [{ executable: scenario.selected, args: ['update'] }], 'Native updates use the selected standalone CLI, including spaces in its absolute path');
  assert.deepEqual(scenario.runCalls, [{ command: 'codex', args: ['update', '--help'] }]);
  newScenario({ cli: true, help: { code: 1, stdout: '' } });
  scenario.updatePath = scenario.selected;
  assert.equal((await updates.CODEX_UPDATES.check('1.0.0')).command, undefined, 'Older CLIs without native update support have no native command');

  for (const [directory, command] of [
    ['Caskroom', 'brew upgrade --cask codex'], ['.pnpm', 'pnpm add -g @openai/codex@latest'],
    ['.bun', 'bun add -g @openai/codex@latest'], ['yarn', 'yarn global add @openai/codex@latest'],
    ['node_modules', 'npm install -g @openai/codex@latest'],
  ]) {
    newScenario({ cli: true, updatePath: path.join(path.parse(scenario.selected).root, directory, 'codex', 'codex.exe') });
    assert.equal((await updates.CODEX_UPDATES.check('1.0.0')).command, command, `${directory} keeps its existing package-manager update route`);
    assert.equal(scenario.runCalls.length, 0);
  }

  // Files can be replaced or removed between the initial probe and command
  // creation. Do not emit a bare command that could then launch the desktop app.
  newScenario({ cli: false, desktop: true, updatePath: 'C:/Tools/codex.exe' });
  assert.equal((await updates.CODEX_UPDATES.check('1.0.0')).command, undefined, 'A disappearing CLI disables its native update command');
  console.log('Provider CLI/desktop separation, selected-path login/update, install deduplication, and contract checks passed.');
} finally {
  delete globalThis[stateKey];
}
