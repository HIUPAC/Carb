import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readAsar } from './asar-files.mjs';

const baseline = 'D:/TasteCode/repack-test/Test-0.5.11-ux-enhancements';
const output = 'D:/TasteCode/carb-work/verification/native-baseline';
const archive = await readAsar(path.join(baseline, 'resources/app.asar'));
for (const [name, bytes] of archive.entries) {
  if (name === 'package.json' || name.startsWith('dist/') || name.startsWith('node_modules/@harness/')) {
    await mkdir(path.dirname(path.join(output, name)), { recursive: true });
    await writeFile(path.join(output, name), bytes);
  }
}
console.log(JSON.stringify({ output, sha256: archive.sha256, unpacked: archive.unpacked.length }));
