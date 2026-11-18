import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function extractCore(resources, destination) {
  const archive = await readFile(path.join(resources, 'app.asar'));
  if (archive.length < 16 || archive.readUInt32LE(0) !== 4) {
    throw new Error('所选目录不是有效的 Carb 发行包。');
  }
  const headerEnd = 16 + archive.readUInt32LE(12);
  const dataStart = 8 + archive.readUInt32LE(4);
  if (headerEnd > dataStart || dataStart > archive.length) {
    throw new Error('Carb 应用归档头不完整。');
  }
  const { files } = JSON.parse(archive.subarray(16, headerEnd));
  const unpacked = path.join(resources, 'app.asar.unpacked');

  async function extract(name, entry, parent = []) {
    if (!name || name === '.' || name === '..' || /[\\/:\0]/.test(name) || /[. ]$/.test(name)) {
      throw new Error('Carb 应用归档包含无效路径。');
    }
    if (!entry || entry.link) throw new Error('Carb 应用归档包含不支持的链接。');
    const parts = [...parent, name];
    if (parts.length === 4 && parts[0] === 'node_modules' && parts[1] === 'node-pty' &&
        parts[2] === 'prebuilds' && name !== 'win32-x64') {
      return;
    }
    const target = path.join(destination, ...parts);
    if (entry.files) {
      await mkdir(target, { recursive: true });
      for (const [fileName, child] of Object.entries(entry.files)) {
        await extract(fileName, child, parts);
      }
      return;
    }
    if (entry.unpacked) {
      await copyFile(path.join(unpacked, ...parts), target);
      return;
    }
    const offset = Number(entry.offset);
    const size = entry.size;
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(size) || size < 0 || size > archive.length - dataStart - offset) {
      throw new Error('Carb 应用归档包含不完整的文件。');
    }
    const start = dataStart + offset;
    await writeFile(target, archive.subarray(start, start + size));
  }

  await extract('package.json', files['package.json']);
  const metadata = JSON.parse(await readFile(path.join(destination, 'package.json'), 'utf8'));
  if (metadata.name !== 'carb' || metadata.version !== '5.6.13') {
    throw new Error('请使用 Carb 5.6.13 Windows x64 发行包。');
  }
  await extract('node_modules', files.node_modules);
  return metadata;
}
