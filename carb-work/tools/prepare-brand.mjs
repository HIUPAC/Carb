import assert from 'node:assert/strict';
import { patchRendererLifecycle } from './patch-login-renderer-recovery.mjs';

export const product = Object.freeze({
  name: 'Carb', slug: 'carb', version: '5.6.13', publisher: '冰轮',
  appId: 'Icewheel.Carb', installerId: '65CB7ABA-432C-4AC1-BA3E-93F8CA097145',
  endpoint: 'ws://127.0.0.1:16481',
});

export function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `Expected one branding anchor: ${from}`);
  return text.replace(from, () => to);
}

// Preserve dependency namespaces, external service URLs and upstream license
// attribution. These identifiers are shared contracts rather than product labels.
const stableStrings = [
  'https://github.com/Leonxlnx/tastecode', 'https://api.github.com/repos/Leonxlnx/tastecode',
  'Leonxlnx/tastecode', 'tastecode-link/1', 'tastecode-history',
];
export function brandText(source, { testProduct = false } = {}) {
  const protectedText = [];
  let text = source;
  for (const stable of stableStrings) {
    if (!text.includes(stable)) continue;
    const token = `__CARB_STABLE_${protectedText.length}__`;
    protectedText.push([token, stable]);
    text = text.replaceAll(stable, token);
  }
  text = text.replaceAll('Taste Desktop', product.name).replaceAll('TasteCode', product.name)
    .replaceAll('PersonalHarness', product.name).replaceAll('personalharness', product.slug)
    .replaceAll('TASTECODE', 'CARB').replaceAll('tastecode', product.slug)
    .replaceAll('Icewheel.Test', product.appId).replaceAll('TestData', 'CarbData')
    .replaceAll('--test-quit-for-uninstall', '--carb-quit-for-uninstall')
    .replaceAll('--test-remove-credentials', '--carb-remove-credentials')
    .replaceAll('TESTWAITPID', 'CARBWAITPID');
  if (testProduct) text = text.replace(/\bTest\b/g, product.name).replace(/\bCrab\b/g, product.name);
  for (const [token, stable] of protectedText) text = text.replaceAll(token, stable);
  return text;
}

function patchMain(text) {
  text = replaceOnce(text, '"./test-uninstall.js"', '"./carb-uninstall.js"');
  text = replaceOnce(text,
    'productDataPath=process.env.HARNESS_DESKTOP_DATA_DIR?path11.resolve(process.env.HARNESS_DESKTOP_DATA_DIR):path11.join(app.getPath("appData"),"TestData")',
    'productDataPath=path11.isAbsolute(process.env.CARB_DESKTOP_DATA_DIR??process.env.CARB_DATA_DIR??process.env.HARNESS_DESKTOP_DATA_DIR??"")?path11.normalize(process.env.CARB_DESKTOP_DATA_DIR??process.env.CARB_DATA_DIR??process.env.HARNESS_DESKTOP_DATA_DIR):path11.join(app.getPath("appData"),"CarbData")');
  text = replaceOnce(text,
    'HARNESS_DATA_DIR:process.env.HARNESS_DATA_DIR||productDataPath,HARNESS_CONFIG_DIR:process.env.HARNESS_CONFIG_DIR||path11.join(productDataPath,"config")',
    'HARNESS_DATA_DIR:productDataPath,HARNESS_CONFIG_DIR:path11.join(productDataPath,"config"),HARNESS_ACCESS_TOKEN:carbCoreToken');
  text = replaceOnce(text,
    'var attachmentPreviewSecret=randomBytes(32)',
    'var carbCoreToken=randomBytes(32).toString("hex"),carbCoreEndpoint,attachmentPreviewSecret=randomBytes(32)');
  text = replaceOnce(text, 'let serverEntry=app.isPackaged?require2.resolve("@harness/server")',
    'carbCoreEndpoint="ws://127.0.0.1:"+serverEnv.HARNESS_PORT+"/?token="+carbCoreToken;let serverEntry=app.isPackaged?require2.resolve("@harness/server")');
  text = replaceOnce(text, 'ipcMain.handle("harness:pickFolder"',
    'ipcMain.handle("carb:coreEndpoint",event=>{requireOwnRenderer(event.sender);return carbCoreEndpoint});ipcMain.handle("harness:pickFolder"');
  text = text.replaceAll('process.env.HARNESS_STARTUP_RENDERER', '(process.env.CARB_STARTUP_RENDERER??process.env.HARNESS_STARTUP_RENDERER)');
  text = text.replaceAll('uninstall-test.sh', 'uninstall-carb.sh');
  // The icon bytes are retained; only their app-owned filename changes.
  text = text.replaceAll('test-app-icon.png', 'carb-app-icon.png');
  text = patchRendererLifecycle(text);
  return brandText(text, { testProduct: true });
}

function patchPreload(text) {
  text = replaceOnce(text, 'api={pickFolder:', 'api={getCoreEndpoint:()=>import_electron.ipcRenderer.invoke("carb:coreEndpoint"),pickFolder:');
  text = replaceOnce(text, 'import_electron.contextBridge.exposeInMainWorld("harness",api);',
    'import_electron.contextBridge.exposeInMainWorld("harness",api);import_electron.contextBridge.exposeInMainWorld("carb",api);');
  return brandText(text);
}

export function prepareBrand(entries) {
  const original = JSON.parse(entries.get('package.json'));
  assert.equal(original.productName, 'Test');
  assert.equal(original.version, '0.5.11');
  const overrides = new Map();
  for (const [name, bytes] of entries) {
    if (!(name.startsWith('dist/') || name.startsWith('node_modules/@harness/')) || !/\.(?:js|cjs|mjs|json)$/.test(name)) continue;
    const source = bytes.toString('utf8');
    const text = brandText(source, { testProduct: name.startsWith('dist/') });
    if (text !== source) overrides.set(name, Buffer.from(text));
  }
  const metadata = { ...original, name: product.slug, productName: product.name, version: product.version };
  overrides.set('package.json', Buffer.from(JSON.stringify(metadata, null, 2) + '\n'));
  overrides.set('dist/main.js', Buffer.from(patchMain(entries.get('dist/main.js').toString('utf8'))));
  overrides.set('dist/preload.cjs', Buffer.from(patchPreload(entries.get('dist/preload.cjs').toString('utf8'))));
  overrides.delete('dist/test-uninstall.js');
  const uninstall = brandText(entries.get('dist/test-uninstall.js').toString('utf8')).replaceAll('uninstall-test.sh', 'uninstall-carb.sh');
  overrides.set('dist/carb-uninstall.js', Buffer.from(uninstall));
  overrides.set('assets/carb-app-icon.png', entries.get('assets/test-app-icon.png'));
  const server = 'node_modules/@harness/server/dist/';
  const get = name => (overrides.get(name) ?? entries.get(name)).toString('utf8');
  let main = get(server + 'main.js');
  main = replaceOnce(main, 'const server = startServer({', 'const accessToken = process.env.HARNESS_ACCESS_TOKEN;\ndelete process.env.HARNESS_ACCESS_TOKEN;\nconst server = startServer({');
  main = replaceOnce(main, "accessToken: process.env['HARNESS_ACCESS_TOKEN'],", 'accessToken,');
  overrides.set(server + 'main.js', Buffer.from(main));
  // Carb never moves data from the previous products into its own profile.
  let locations = get(server + 'data-location.js');
  locations = replaceOnce(locations,
    "migrateDatabase(path.join(base, 'Carb', 'carb.db'), path.join(base, 'Carb', 'harness.db'))",
    "migrateDatabase(path.join(base, 'CarbData', 'carb.db'), path.join(base, 'CarbData', 'harness.db'))");
  overrides.set(server + 'data-location.js', Buffer.from(locations));
  let paths = get(server + 'product-paths.js');
  paths = replaceOnce(paths,
    "migrateProductFile(path.join(os.homedir(), '.carb', name), path.join(os.homedir(), '.carb', name))",
    "path.join(os.homedir(), '.carb', name)");
  overrides.set(server + 'product-paths.js', Buffer.from(paths));
  const identity = 'You are Carb, the coding assistant in this workspace. When asked who you are, introduce yourself as Carb. Identify your model or provider separately when known.';
  let reply = get(server + 'reply-style.js');
  reply = replaceOnce(reply, 'Write like a clear, capable teammate.', identity + '\n\nWrite like a clear, capable teammate.');
  overrides.set(server + 'reply-style.js', Buffer.from(reply));
  let api = get(server + 'api-runtime.js');
  const fallback = 'Use the workspace tools to complete the task. List and read files as needed, carry out the requested changes, then verify the results. Report actions only when the tools confirm them. The application handles any approval prompts.';
  api = replaceOnce(api, "options.instructions || '" + fallback + "'", 'options.instructions || ' + JSON.stringify(identity + '\n\n' + fallback));
  overrides.set(server + 'api-runtime.js', Buffer.from(api));
  // The packaged updater is already disabled. Its source-check RPC must also
  // avoid comparing this distribution with the upstream product's releases.
  overrides.set(server + 'update-check.js', Buffer.from("export async function checkForUpdates() { return { error: 'Carb 通过独立安装包更新。' }; }\n"));
  return {
    overrides,
    options: {
      excludeMembers: ['dist/test-uninstall.js', 'assets/test-app-icon.png'],
      branding: { versionStrings: {
        ProductName: product.name, FileDescription: product.name, InternalName: product.name,
        OriginalFilename: product.name + '.exe', CompanyName: product.publisher,
      } },
    },
  };
}
