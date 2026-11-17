import { readFile } from 'node:fs/promises';
import { readAsar } from './asar-files.mjs';

const { entries } = await readAsar('D:/TasteCode/repack-test/Test-0.5.11-ux-enhancements/resources/app.asar');
const selected = process.argv.slice(2);
const matches = [];
for (const [name, bytes] of entries) {
  if (selected.length ? !selected.some(prefix => name.startsWith(prefix)) : !(name.startsWith('dist/') || name.startsWith('node_modules/@harness/'))) continue;
  if (!/\.(?:js|cjs|mjs|json|html|md|css)$/.test(name)) continue;
  const text = bytes.toString('utf8');
  for (const m of text.matchAll(/TasteCode|tastecode|Taste Desktop|PersonalHarness|\bTest\b|\bCrab\b|Icewheel\.Test/g)) {
    matches.push({ file: name, offset: m.index, context: text.slice(Math.max(0, m.index - 75), m.index + 140).replaceAll('\n', ' ') });
  }
}
console.log(JSON.stringify(matches, null, 2));
