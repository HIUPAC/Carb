import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { product } from './prepare-brand.mjs';

const root = path.resolve(import.meta.dirname, '..');
const upstream = 'D:/TasteCode/repack-test';
const installer = path.join(root, 'installer');
await mkdir(installer, { recursive: true });
let script = await readFile(path.join(upstream, 'installer/Test.iss'), 'utf8');
script = script.replaceAll('Test', product.name).replaceAll('TESTWAITPID', 'CARBWAITPID')
  .replaceAll('--test-', '--carb-').replace('0.5.7', product.version)
  .replace('4DFEF1E8-B461-4D66-B3A4-EE807CA36466', product.installerId);
assert(script.includes('AppId={{' + product.installerId + '}'));
await writeFile(path.join(installer, 'Carb.iss'), script);
const uninstall = (await readFile(path.join(upstream, 'installer/Uninstall.iss'), 'utf8'))
  .replaceAll('Test', product.name).replaceAll('TESTWAITPID', 'CARBWAITPID').replaceAll('--test-', '--carb-');
await writeFile(path.join(installer, 'Uninstall.iss'), uninstall);
for (const file of ['ChineseSimplified.isl', 'Particles.iss']) {
  await cp(path.join(upstream, 'installer', file), path.join(installer, file));
}
let build = await readFile(path.join(upstream, 'tools/Build-Test.ps1'), 'utf8');
build = build.replace("[string] $Version = '0.5.7'", "[string] $Version = '" + product.version + "'")
  .replace("[string] $PayloadDirectory = 'D:\\TasteCode\\Test'", "[string] $PayloadDirectory = 'D:\\TasteCode\\carb-work\\Carb-" + product.version + "'")
  .replace("[string] $IconFile = 'D:\\UIAgent\\TasteDesktop\\Assets\\taste.ico'", "[string] $IconFile = 'D:\\TasteCode\\carb-work\\branding\\source-shortcut.ico'")
  .replaceAll('Test.exe', 'Carb.exe').replaceAll('Test.iss', 'Carb.iss').replaceAll("'Test'", "'Carb'")
  .replaceAll('Test-Setup-', 'Carb-Setup-').replaceAll('Programs\\Test', 'Programs\\Carb');
build = build.replace('$arguments = @(', '$existingInstaller = Join-Path $outputRoot "Carb-Setup-$Version-win-x64.exe"\nif (Test-Path -LiteralPath $existingInstaller) { throw "Installer output already exists: $existingInstaller" }\n\n$arguments = @(');
await writeFile(path.join(root, 'tools/Build-Carb.ps1'), build);
console.log(JSON.stringify({ installer, build: path.join(root, 'tools/Build-Carb.ps1'), installerId: product.installerId }));
