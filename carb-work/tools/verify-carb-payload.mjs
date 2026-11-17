import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readAsar } from './asar-files.mjs';
import { product } from './prepare-brand.mjs';

const root = path.resolve(import.meta.dirname, '..');
const expectedVersion = process.env.CARB_VERSION ?? product.version;
const payload = path.resolve(process.env.CARB_PAYLOAD ?? path.join(root, `Carb-${expectedVersion}`));
const archive = await readAsar(path.join(payload, 'resources/app.asar'));
const text = name => {
  const value = archive.entries.get(name);
  assert(value, `ASAR member is missing: ${name}`);
  return value.toString('utf8');
};

const metadata = JSON.parse(text('package.json'));
assert.equal(metadata.productName, product.name);
assert.equal(metadata.version, expectedVersion);
assert.equal(metadata.name, product.slug);
assert(!archive.entries.has('assets/test-app-icon.png'));
assert(!archive.entries.has('dist/test-uninstall.js'));
assert(archive.entries.has('assets/carb-app-icon.png'));

const main = text('dist/main.js');
const preload = text('dist/preload.cjs');
const codexAdapter = text('node_modules/@harness/adapter-codex/dist/adapter.js');
assert(main.includes('CARB_DESKTOP_DATA_DIR') && main.includes('CarbData'));
assert(main.includes('CARB_DATA_DIR') && main.includes('HARNESS_DATA_DIR:productDataPath'));
assert(main.includes('HARNESS_CONFIG_DIR:path11.join(productDataPath'));
assert(main.includes('carb:coreEndpoint') && main.includes('nativeAppName="Carb"'));
assert(main.includes('Icewheel.Carb') && !main.includes('Icewheel.Test'));
assert(codexAdapter.includes("import { codexLoginStatus } from './auth.js';"));
assert(codexAdapter.includes("if (status === 'authenticated')"));
assert(codexAdapter.includes("if (status === 'unauthenticated')"));
assert(codexAdapter.includes("throw new Error('Unable to confirm Codex login status. Try again.')"));
assert(!codexAdapter.includes("return { signedIn: status === 'authenticated' }"));
assert(preload.includes('getCoreEndpoint') && preload.includes('exposeInMainWorld("carb"'));
assert(main.includes('carb:pickSkillZip') && preload.includes('pickSkillZip:'));
assert(text('node_modules/@harness/server/dist/server.js').includes('skills.previewInstall'));
assert(text('node_modules/@harness/server/dist/orchestrator.js').includes('installSingleGlobalSkill'));
assert(text('node_modules/@harness/server/dist/orchestrator.js').includes('listGlobalSkills'));
assert(text('node_modules/@harness/server/dist/skill-install.js').includes('carb-skill-ownership.js'));
for (const name of ['carb-skill-install.js', 'carb-skill-source.js', 'carb-skill-ownership.js', 'carb-skill-runtime.js', 'carb-global-skills.js', 'carb-document-evidence.js', 'carb-artifact-evidence.js']) text('node_modules/@harness/server/dist/' + name);
text('node_modules/sax/lib/sax.js');
assert(text('node_modules/@harness/server/dist/reply-style.js').includes('complete handoff'));
assert(text('node_modules/@harness/server/dist/api-runtime.js').includes('skillToolDefinitions'));
assert(text('node_modules/@harness/server/dist/api-runtime.js').includes('verifyDocumentReadback'));
assert(text('node_modules/@harness/server/dist/api-runtime.js').includes('artifact_inspect'));
assert(text('node_modules/@harness/server/dist/api-runtime.js').includes('verifyArtifactSet'));
assert(text('node_modules/@harness/server/dist/api-runtime.js').includes("from './reply-style.js'"));
assert(text('node_modules/@harness/server/dist/api-runtime.js').includes('toolStats: { failedToolCalls }'));
assert(!text('node_modules/@harness/server/dist/api-runtime.js').includes('more than 10 tool calls failed'));
assert(!text('node_modules/@harness/server/dist/carb-skill-source.js').includes('fetch('));
assert(text('node_modules/@harness/server/dist/data-location.js').includes('CarbData'));
assert(text('node_modules/@harness/server/dist/product-paths.js').includes('.carb'));

const web = path.join(payload, 'resources/web');
const index = await readFile(path.join(web, 'index.html'), 'utf8');
assert(index.includes('<title>Carb</title>'));
assert(index.includes(product.endpoint));
for (const [, relative] of index.matchAll(/\b(?:href|src)="\.\/([^\"]+)"/g)) {
  await access(path.join(web, relative));
}
for (const required of ['assets/carb-profile.js', 'assets/carb-task-interactions.js', 'assets/carb-fonts.js', 'assets/carb-skill-installer.js', 'assets/carb-skill-installer.css', 'assets/carb-theme.css']) {
  await access(path.join(web, required));
}
assert(index.indexOf('carb-theme.css') > index.indexOf('carb-skill-installer.css'));
const settings = await readFile(path.join(web, 'assets/Settings-CdgxHJV3.js'), 'utf8');
assert(settings.includes('createSkillInstaller as __carbCreateSkillInstaller'));
assert(settings.includes('(__carbSkillInstall,{enabled:true,'), 'The packaged global skill installer stays available without a selected workspace');
assert(settings.includes('projectPath:void 0,onInstalled:'), 'The packaged global installer does not bind installs to a workspace');
assert(!settings.includes('actions:e.projectPath&&y?.capabilities.install?'), 'The packaged installer entry is not hidden by workspace or provider capability state');
assert(settings.includes('carb-fonts.js'));
const installer = await readFile(path.join(web, 'assets/carb-skill-installer.js'), 'utf8');
assert(!installer.includes("['github'") && !installer.includes("type: 'url'") && !installer.includes('检查链接'));
assert(installer.includes('Local ZIP') && installer.includes('Skill folder'));
for (const name of ['Settings-CdgxHJV3.js', 'carb-fonts.js', 'carb-skill-installer.js', 'test-document-workflow.js']) {
  execFileSync(process.execPath, ['--input-type=module', '--check'], { input: await readFile(path.join(web, 'assets', name)), stdio: ['pipe', 'ignore', 'pipe'] });
}

let syntaxChecked = 0;
for (const [name, bytes] of archive.entries) {
  if (!/^(?:dist\/|node_modules\/@harness\/)/.test(name) || !/\.(?:js|cjs|mjs)$/.test(name)) continue;
  execFileSync(process.execPath, ['--input-type=module', '--check'], { input: bytes, stdio: ['pipe', 'ignore', 'pipe'] });
  syntaxChecked++;
}
assert(syntaxChecked > 0);

const manifestPath = path.resolve(process.env.CARB_BUILD_MANIFEST ?? path.join(root, 'verification/windows-build.json'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.equal(manifest.payload, payload);
assert.equal(manifest.asarSha256, archive.sha256);
console.log(JSON.stringify({ product: metadata.productName, version: metadata.version, payload, asarSha256: archive.sha256, syntaxChecked, webAssetsVerified: true }, null, 2));
