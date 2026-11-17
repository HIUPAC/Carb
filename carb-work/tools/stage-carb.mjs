import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { readAsar } from './asar-files.mjs';
import { brandText, prepareBrand, product, replaceOnce } from './prepare-brand.mjs';
import { patchSkillPicker, patchSkillTransportValidation, patchSkillWeb } from './patch-skill-web.mjs';
import { patchSkillServer, patchSkillOrchestrator, patchSkillLocalInstaller, patchSkillsListContract } from './patch-skill-install.mjs';
import { documentWorkflowPaths, patchDocumentWorkflow } from './patch-document-workflow.mjs';
import { patchArtifactWorkflow } from './patch-artifact-workflow.mjs';
import { patchSkillRuntime } from './patch-skill-runtime.mjs';
import { patchWelcomeLetter } from './patch-welcome-letter.mjs';
import { patchTaskCompletion } from './patch-task-completion.mjs';
import { patchApiEffort, patchModelConnections, patchModelEffortRenderer } from './patch-model-effort.mjs';
import { patchCliDetection, patchCliUpdatePath, patchProviderCliDetection, patchProviderStatusContract, patchCodexUpdateCommand } from './patch-cli-detection.mjs';
import { cliInstallNativePaths, patchCliInstall, patchInstallTerminal } from './patch-cli-install.mjs';
import { patchCliStatusWeb } from './patch-cli-status-web.mjs';
import { patchContactSettings } from './patch-contact-settings.mjs';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const baseline = path.resolve(process.env.CARB_BASELINE ?? 'D:/TasteCode/repack-test/Test-0.5.11-ux-enhancements');
const overlayRoot = path.join(root, 'overlay');
const payload = path.resolve(process.env.CARB_PAYLOAD ?? path.join(root, 'Carb-' + product.version));
const refresh = process.argv.includes('--refresh');
const brandingIcon = path.join(root, 'branding', 'source-shortcut.ico');
const brandingPng = path.join(root, 'branding', 'source-shortcut.png');
assert(path.dirname(payload) === root, 'Carb payload must be a direct child of carb-work');
assert.notEqual(payload.toLowerCase(), baseline.toLowerCase());
await mkdir(path.join(root, 'verification'), { recursive: true });
const exists = async filename => { try { await access(filename); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
assert(refresh || !(await exists(payload)), 'Payload already exists; use --refresh to retain it as a verification backup');
const staging = await mkdtemp(path.join(root, '.stage-carb-'));
const staged = path.join(staging, 'payload');
const nativeOverlay = path.join(staging, 'asar-overlay');
const sourceArchive = path.join(baseline, 'resources/app.asar');
const sourceExe = path.join(baseline, 'Test.exe');
const textTypes = /\.(?:js|cjs|mjs|json|html|css|md|txt|yml|yaml|sh)$/i;

async function filesUnder(directory, prefix = '') {
  if (!(await exists(directory))) return [];
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) output.push(...await filesUnder(path.join(directory, entry.name), name + '/'));
    else { assert(entry.isFile(), 'Only ordinary files are accepted: ' + name); output.push(name); }
  }
  return output;
}

async function originalIcon(filename) {
  if (await exists(brandingIcon)) {
    await cp(brandingIcon, filename);
    return;
  }
  const modules = 'D:/UIAgent/artifacts/build-tools/branding/node_modules';
  const { NtExecutable, NtExecutableResource } = await import(pathToFileURL(path.join(modules, 'pe-library/dist/index.js')).href);
  const entries = NtExecutableResource.from(NtExecutable.from(await readFile(sourceExe))).entries;
  const group = entries.find(entry => entry.type === 14);
  assert(group, 'Baseline executable has no icon group');
  const directory = Buffer.from(group.bin), count = directory.readUInt16LE(4);
  assert(count > 0 && directory.length === 6 + count * 14);
  const index = Buffer.alloc(6 + count * 16);
  directory.copy(index, 0, 0, 6);
  let offset = index.length;
  const images = [];
  for (let i = 0; i < count; i++) {
    const from = 6 + i * 14, to = 6 + i * 16, id = directory.readUInt16LE(from + 12);
    const entry = entries.find(item => item.type === 3 && item.id === id && item.lang === group.lang);
    assert(entry, 'Missing baseline icon image ' + id);
    const image = Buffer.from(entry.bin);
    assert.equal(image.length, directory.readUInt32LE(from + 8));
    directory.copy(index, to, from, from + 12);
    index.writeUInt32LE(offset, to + 12);
    images.push(image); offset += image.length;
  }
  await writeFile(filename, Buffer.concat([index, ...images]));
}

async function stage() {
  const archive = await readAsar(sourceArchive);
  const { overrides, options } = prepareBrand(archive.entries);
  for (const name of ['dist/main.js', 'dist/preload.cjs']) {
    overrides.set(name, Buffer.from(patchSkillPicker(name, (overrides.get(name) ?? archive.entries.get(name)).toString('utf8'))));
  }
  assert(await exists(brandingIcon), `Unified Carb icon is required: ${brandingIcon}`);
  assert(await exists(brandingPng), `Unified Carb PNG icon is required: ${brandingPng}`);
  options.branding.iconPath = brandingIcon;
  overrides.set('assets/carb-app-icon.png', await readFile(brandingPng));
  const appOverlay = path.join(overlayRoot, 'asar');
  for (const name of await filesUnder(appOverlay)) {
    // The shared native task overlay contains snapshots of main/preload. Merge
    // their task IPC through the pure transformer below so Carb's profile,
    // tokenized endpoint, and dual preload bridges remain based on the branded
    // 0.5.11 baseline.
    if (['dist/main.js', 'dist/preload.cjs'].includes(name)) continue;
    let bytes = await readFile(path.join(appOverlay, name));
    if (textTypes.test(name)) bytes = Buffer.from(brandText(bytes.toString('utf8'), { testProduct: name.startsWith('dist/') }));
    overrides.set(name, bytes);
  }
  {
    const name = 'node_modules/@harness/adapter-codex/dist/adapter.js';
    const source = overrides.get(name) ?? archive.entries.get(name);
    assert(source, 'Missing Codex adapter source for account status fallback');
    const { patchCodexAccountStatus } = await import('./patch-codex-account-status.mjs');
    overrides.set(name, Buffer.from(patchCodexAccountStatus(source.toString('utf8'))));
  }
  const taskPatch = path.join(root, 'tools/patch-task-interactions.mjs');
  if (await exists(taskPatch)) {
    const { patchTaskNativeFile, taskNativePaths } = await import(pathToFileURL(taskPatch).href);
    for (const name of taskNativePaths) {
      // Merge all task integrations after branding, including the API runtime
      // clarification protocol used by Carb's direct API connections.
      const source = overrides.get(name) ?? archive.entries.get(name);
      assert(source, 'Missing native task patch source: ' + name);
      let patched = patchTaskNativeFile(name, source.toString('utf8'));
      if (name === 'node_modules/@harness/server/dist/api-runtime.js') {
        const { patchToolRounds } = await import('./patch-tool-rounds.mjs');
        patched = patchToolRounds(patched);
        const { patchAttachmentApi } = await import('./patch-attachment-backend.mjs');
        patched = patchAttachmentApi(patched);
      }
      overrides.set(name, Buffer.from(patched));
    }
  }
  for (const name of documentWorkflowPaths) {
    const source = overrides.get(name) ?? archive.entries.get(name);
    assert(source, 'Missing document workflow source: ' + name);
    overrides.set(name, Buffer.from(patchDocumentWorkflow(name, source.toString('utf8'))));
  }
  {
    const name = 'node_modules/@harness/server/dist/api-runtime.js';
    const source = overrides.get(name) ?? archive.entries.get(name);
    assert(source, 'Missing API runtime source for artifact workflow');
    overrides.set(name, Buffer.from(patchApiEffort(patchTaskCompletion(patchSkillRuntime(patchArtifactWorkflow(source.toString('utf8')))))));
  }
  {
    const name = 'node_modules/@harness/server/dist/model-connections.js';
    const source = overrides.get(name) ?? archive.entries.get(name);
    assert(source, 'Missing model connections source');
    overrides.set(name, Buffer.from(patchModelConnections(source.toString('utf8'))));
  }
  {
    const name = 'node_modules/@harness/contracts/dist/protocol.js';
    const source = overrides.get(name) ?? archive.entries.get(name);
    assert(source, 'Missing protocol contract source for global skill listing');
    overrides.set(name, Buffer.from(patchSkillsListContract(source.toString('utf8'))));
  }
  {
    const name = 'node_modules/@harness/server/dist/orchestrator.js';
    const source = overrides.get(name) ?? archive.entries.get(name);
    assert(source, 'Missing skill orchestrator source');
    overrides.set(name, Buffer.from(patchSkillOrchestrator(source.toString('utf8'))));
  }
  {
    const name = 'node_modules/@harness/server/dist/skill-install.js';
    const source = overrides.get(name) ?? archive.entries.get(name);
    assert(source, 'Missing local skill installer source');
    overrides.set(name, Buffer.from(patchSkillLocalInstaller(source.toString('utf8'))));
  }
  // Detect the desktop application separately from the ACP command: finding
  // a GUI executable does not mean it can serve coding sessions.
  {
    const agentPath = 'node_modules/@harness/adapter-acp/dist/agents.js';
    const serverPath = 'node_modules/@harness/server/dist/server.js';
    const agentSource = (overrides.get(agentPath) ?? archive.entries.get(agentPath)).toString('utf8');
    const serverSource = (overrides.get(serverPath) ?? archive.entries.get(serverPath)).toString('utf8');
    const { patchDeepSeekAgent } = await import('./patch-deepseek-agent.mjs');
    let agents = patchDeepSeekAgent(replaceOnce(agentSource, "import { join } from 'node:path';", "import { join } from 'node:path';\nimport { detectAgentDesktops } from './carb-desktop-detection.js';"));
    agents = replaceOnce(agents,
      'return Promise.all(LISTED_AGENTS.map(async (agent) => ({ ...agent, installed: await isInstalled(agent.command) })));',
      'const desktops = await detectAgentDesktops(); return Promise.all(LISTED_AGENTS.map(async (agent) => ({ ...agent, installed: await isInstalled(agent.command), ...(Object.hasOwn(desktops, agent.id) ? { desktopInstalled: desktops[agent.id] } : {}) })));');
    const { patchAttachmentServer } = await import('./patch-attachment-backend.mjs');
    let server = patchAttachmentServer(replaceOnce(serverSource, 'const { id, name, installed, verified, install, setup, problem, maker } = agent;', 'const { id, name, installed, verified, install, setup, problem, maker, desktopInstalled } = agent;'));
    server = replaceOnce(server, '                            installed,\n                            verified,', '                            installed,\n                            desktopInstalled,\n                            verified,');
    overrides.set(agentPath, Buffer.from(agents));
    overrides.set(serverPath, Buffer.from(patchSkillServer(server)));
  }
  // Detection, versions, sessions, login and updates must select the same
  // standalone CLI. A desktop installation is an independent status signal.
  for (const [name, patch] of [
    ['node_modules/@harness/proc/dist/cli.js', patchCliDetection],
    ['node_modules/@harness/proc/dist/updates.js', patchCliUpdatePath],
    ['node_modules/@harness/server/dist/providers.js', patchProviderCliDetection],
    ['node_modules/@harness/contracts/dist/domain.js', patchProviderStatusContract],
    ['node_modules/@harness/adapter-codex/dist/updates.js', patchCodexUpdateCommand],
    ...cliInstallNativePaths.map(name => [name, source => patchCliInstall(name, source)]),
  ]) {
    const source = overrides.get(name) ?? archive.entries.get(name);
    assert(source, 'Missing CLI installation source: ' + name);
    overrides.set(name, Buffer.from(patch(source.toString('utf8'))));
  }
  for (const [name, bytes] of overrides) {
    assert(bytes, 'Missing overlay bytes: ' + name);
    const filename = path.join(nativeOverlay, name);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, bytes);
  }
  await cp(baseline, staged, { recursive: true, force: false, errorOnExist: true,
    filter: filename => !/^(?:Test\.exe|resources\/(?:app\.asar|app-update\.yml))(?:\/|$)/i.test(path.relative(baseline, filename).split(path.sep).join('/')) });
  const resourceOverlay = path.join(overlayRoot, 'resources');
  if (await exists(resourceOverlay)) await cp(resourceOverlay, path.join(staged, 'resources'), { recursive: true });
  // Transform application-owned renderer sources after all shared overlays are
  // applied, so onboarding and task interaction changes cannot lose branding.
  const web = path.join(staged, 'resources/web');
  // Use the same artwork in the renderer as in the executable and window.
  await cp(brandingPng, path.join(web, 'assets/carb-app-icon.png'));
  for (const name of await filesUnder(web)) {
    if (!textTypes.test(name) || /^(?:assets\/)?(?:grammar-|vendor\/)/.test(name)) continue;
    const filename = path.join(web, name);
    let source = await readFile(filename, 'utf8');
    if (/^assets\/Onboarding-[^/]+\.js$/.test(name)) {
      source = replaceOnce(source,
        '(0,A.jsx)(Fe,{size:15}),(0,A.jsx)(`span`,{children:`Test`})',
        '(0,A.jsx)(`img`,{src:`./assets/carb-app-icon.png`,width:20,height:20,alt:``,"aria-hidden":!0}),(0,A.jsx)(`span`,{children:`Test`})');
    }
    if (name === 'assets/index-dY3kjCLH.js') source = patchWelcomeLetter(patchModelEffortRenderer(source));
    const productLabels = name === 'index.html' || /(?:index-dY3kjCLH|ComposerResourcePicker|FeedbackDialog|Onboarding|PhoneSettings|PullRequestsView|Settings-CdgxHJV3|test-i18n)\b/.test(name);
    source = brandText(source, { testProduct: productLabels });
    if (name === 'index.html') {
      source = source.replaceAll('ws://127.0.0.1:14313', product.endpoint);
      const references = [
        ['carb-profile.css', 'style'], ['carb-task-interactions.css', 'style'], ['carb-task-interactions.js', 'module'],
        ['carb-skill-installer.css', 'style'], ['carb-theme.css', 'style'], ['carb-welcome-letter.css', 'style'],
      ];
      for (const [asset, type] of references) {
        if (!(await exists(path.join(web, 'assets', asset))) || source.includes('./assets/' + asset)) continue;
        const tag = type === 'style' ? `    <link rel="stylesheet" href="./assets/${asset}">` : `    <script type="module" src="./assets/${asset}"></script>`;
        source = source.replace('  </head>', tag + '\n  </head>');
      }
      assert(source.includes('<title>Carb</title>'));
    }
    if (name === 'assets/index-dY3kjCLH.js') {
      source = replaceOnce(source,
        'function GO(e){return e??`ws://127.0.0.1:14313`}',
        'const carbDesktopEndpoint=await (window.carb??window.harness)?.getCoreEndpoint?.();function GO(e){return e??carbDesktopEndpoint??' + JSON.stringify(product.endpoint) + '}');
    }
    if (name === 'assets/Settings-CdgxHJV3.js') source = patchSkillWeb(source);
    if (/^assets\/transport-validation-[^/]+\.js$/.test(name)) source = patchSkillTransportValidation(source);
    if (/^assets\/InstallTerminal-[^/]+\.js$/.test(name)) source = patchInstallTerminal(source);
    source = patchCliStatusWeb(name, source);
    source = patchContactSettings(name, source);
    await writeFile(filename, source);
  }
  // Brand bundled plugin metadata while retaining all third-party skill files.
  for (const name of ['skills.json', '.claude-plugin/plugin.json']) {
    const filename = path.join(staged, 'resources/default-skills', name);
    const manifest = JSON.parse(await readFile(filename, 'utf8'));
    const plugin = name === 'skills.json' ? manifest.plugin : manifest;
    plugin.name = product.slug;
    plugin.description = 'Agent Skills that ship with Carb.';
    plugin.author.name = product.name;
    await writeFile(filename, JSON.stringify(manifest, null, 2) + '\n');
  }
  const feedback = path.join(staged, 'resources/feedback/feedback.env');
  if (await exists(feedback)) await writeFile(feedback, brandText(await readFile(feedback, 'utf8')));
  // Preserve the upstream copyright and third-party attribution in NOTICE.
  const notice = path.join(staged, 'resources/NOTICE');
  await writeFile(notice, 'Carb\n\nBased on the following upstream software:\n' + await readFile(notice, 'utf8'));
  // Any app-owned unpacked JS uses the same product identifiers as its ASAR peers.
  const unpacked = path.join(staged, 'resources/app.asar.unpacked/node_modules/@harness');
  for (const name of await filesUnder(unpacked)) {
    if (!/\.(?:js|cjs|mjs|json)$/.test(name)) continue;
    const filename = path.join(unpacked, name), source = await readFile(filename, 'utf8');
    const updated = brandText(source);
    if (updated !== source) await writeFile(filename, updated);
  }
  const optionsFile = path.join(staging, 'asar-options.json');
  await writeFile(optionsFile, JSON.stringify(options));
  const result = await run(process.execPath, [
    'D:/TasteCode/repack-test/tools/rebuild-asar-overlay.mjs', sourceArchive, sourceExe, nativeOverlay,
    path.join(staged, 'resources/app.asar'), path.join(staged, 'Carb.exe'), product.version, optionsFile,
  ], { maxBuffer: 3 * 1024 * 1024 });
  const build = JSON.parse(result.stdout);
  const index = await readFile(path.join(web, 'index.html'), 'utf8');
  for (const [, relative] of index.matchAll(/\b(?:href|src)="\.\/([^"]+)"/g)) await access(path.join(web, relative));
  assert(index.includes(product.endpoint), 'Renderer CSP must contain Carb endpoint');
  if (await exists(payload)) {
    const backups = path.join(root, 'verification/payload-backups');
    await mkdir(backups, { recursive: true });
    await rename(payload, path.join(backups, path.basename(payload) + '-' + Date.now()));
  }
  await rename(staged, payload);
  const metadata = path.join(root, 'payload-metadata');
  await mkdir(metadata, { recursive: true });
  await originalIcon(path.join(metadata, 'carb.ico'));
  await writeFile(path.join(metadata, 'branding-manifest.json'), JSON.stringify({
    productName: product.name,
    executable: 'Carb.exe',
    publisher: product.publisher,
    version: product.version,
    appId: product.appId,
    installerId: product.installerId,
    iconSource: 'D:\\DESKTOP\\Test.lnk -> D:\\Test\\Test.exe,0',
    iconIco: brandingIcon,
    iconPng: brandingPng,
  }, null, 2));
  const manifest = { product: product.name, version: product.version, payload, endpoint: product.endpoint, baseline, baselineAsarSha256: archive.sha256, ...build };
  await writeFile(path.join(root, 'verification/windows-build.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest, null, 2));
}
try { await stage(); }
finally {
  assert.equal(path.dirname(staging), root);
  assert(path.basename(staging).startsWith('.stage-carb-'));
  await rm(staging, { recursive: true, force: true });
}
