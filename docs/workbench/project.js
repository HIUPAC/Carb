const MAX_FILES = 1500;
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_TEXT = 1024 * 1024;

export function validPath(path) {
  if (typeof path !== 'string' || path.length > 320 || path.split('/').some(part =>
    !part || part === '.' || part === '..' || /[\\<>:"|?*\u0000-\u001f]/u.test(part) ||
    /[ .]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
  )) throw new Error('请输入有效的项目相对路径，例如 notes/summary.md。');
  return path;
}

function fits(files) {
  const total = [...files.values()].reduce((sum, blob) => sum + blob.size, 0);
  if (files.size > MAX_FILES || total > MAX_BYTES) {
    throw new Error('每个项目最多导入 1500 个文件，总大小不超过 100 MB。');
  }
}

export function fileEntries(files, folder) {
  const imported = new Map();
  for (const file of files) {
    const path = folder ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;
    if (path) imported.set(validPath(path), file);
  }
  fits(imported);
  return imported;
}

export async function directoryEntries(handle) {
  const imported = new Map();
  let bytes = 0;
  async function visit(directory, base) {
    if (base.split('/').length > 24) throw new Error('项目文件夹层级不能超过 24 层。');
    for await (const entry of directory.values()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const path = validPath(base + entry.name);
      if (entry.kind === 'directory') {
        await visit(entry, path + '/');
      } else {
        const file = await entry.getFile();
        bytes += file.size;
        if (imported.size >= MAX_FILES || bytes > MAX_BYTES) {
          throw new Error('每个项目最多导入 1500 个文件，总大小不超过 100 MB。');
        }
        imported.set(path, file);
      }
    }
  }
  await visit(handle, '');
  return imported;
}

export async function snapshotEntries(imported) {
  const snapshots = new Map();
  for (const [path, blob] of imported) {
    snapshots.set(path, new Blob([await blob.arrayBuffer()], { type: blob.type }));
  }
  return snapshots;
}

export function mergeEntries(current, imported) {
  const merged = new Map(current);
  for (const [path, file] of imported) {
    const distinct = [...merged.keys()].find(existing =>
      existing.toLowerCase() === path.toLowerCase() ||
      existing.toLowerCase().startsWith(path.toLowerCase() + '/') ||
      path.toLowerCase().startsWith(existing.toLowerCase() + '/')
    );
    if (distinct) throw new Error('项目中已有同名文件或文件夹：' + distinct);
    merged.set(path, file);
  }
  fits(merged);
  return merged;
}

export async function textOf(blob) {
  if (!blob) throw new Error('没有找到该文件。');
  if (blob.size > MAX_TEXT) throw new Error('超过 1 MB 的文件可下载查看。');
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await blob.arrayBuffer());
    if (text.includes('\0')) throw new Error('binary');
    return text;
  } catch {
    throw new Error('此文件无法作为 UTF-8 文本编辑，可以下载原文件。');
  }
}

export function textBlob(text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  if (blob.size > MAX_TEXT) throw new Error('文本文件大小不能超过 1 MB。');
  return blob;
}

export async function searchFiles(files, query, signal) {
  if (!query || query.length > 200) throw new Error('请输入 1 至 200 个字符的搜索词。');
  const results = [];
  const needle = query.toLowerCase();
  let inspected = 0;
  for (const [path, blob] of files) {
    signal?.throwIfAborted();
    if (++inspected > 250 || results.length >= 50) break;
    const text = await textOf(blob).catch(() => null);
    if (text == null) continue;
    const lines = text.split('\n');
    for (let line = 0; line < lines.length && results.length < 50; line++) {
      if (lines[line].toLowerCase().includes(needle)) {
        results.push(path + ':' + (line + 1) + '  ' + lines[line].slice(0, 220));
      }
    }
  }
  if (inspected > 250 || results.length >= 50) results.push('已达到搜索上限。');
  return results.join('\n') || '没有匹配的结果。';
}

export async function compactDiff(previous, next) {
  const before = previous ? (await textOf(previous)).split('\n') : [];
  const after = (await textOf(next)).split('\n');
  let start = 0;
  let end = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  while (end < Math.min(before.length, after.length) - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const removed = before.slice(start, before.length - end);
  const added = after.slice(start, after.length - end);
  const lines = [];
  if (start) lines.push(['', '  …… 前 ' + start + ' 行相同']);
  for (const line of removed.slice(0, 100)) lines.push(['removed', '− ' + line.slice(0, 1000)]);
  for (const line of added.slice(0, 100)) lines.push(['added', '+ ' + line.slice(0, 1000)]);
  if (removed.length > 100 || added.length > 100) lines.push(['', '  仅显示每组的前 100 行']);
  if (end) lines.push(['', '  …… 后 ' + end + ' 行相同']);
  if (!removed.length && !added.length) lines.push(['', '  文件内容一致']);
  return { lines, removed: removed.length, added: added.length };
}

async function digest(blob) {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return new Uint8Array(hash).join(',');
}

export async function writeFile(root, path, current, original) {
  const parts = validPath(path).split('/');
  const filename = parts.pop();
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: !original });
  let handle;
  let existing;
  try {
    handle = await directory.getFileHandle(filename);
    existing = await handle.getFile();
  } catch (error) {
    if (error.name !== 'NotFoundError') throw error;
  }
  const existingHash = existing ? await digest(existing) : null;
  if (existing && existing.size === current.size && existingHash === await digest(current)) return;
  if (original && (!existing || existing.size !== original.size || existingHash !== await digest(original))) {
    throw new Error('本地文件已变动，保留了磁盘上的版本。');
  }
  if (!original && existing) throw new Error('本地已有同名文件。');
  handle ??= await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable({ mode: 'exclusive' });
  try {
    await writable.write(current);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

export function safePreview(text) {
  const template = document.createElement('template');
  template.innerHTML = text;
  const fragment = template.content;
  for (const node of fragment.querySelectorAll('script, iframe, frame, object, embed, base, meta, link, svg, math, video, audio, form, template')) node.remove();
  for (const node of fragment.querySelectorAll('*')) {
    for (const attribute of node.getAttributeNames()) {
      if (/^on/i.test(attribute) || /^(href|srcset|srcdoc|ping|action|formaction|background|data|poster)$/i.test(attribute) ||
        (attribute === 'src' && !/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(node.getAttribute(attribute)))) {
        node.removeAttribute(attribute);
      }
    }
  }
  return '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' + template.innerHTML;
}
