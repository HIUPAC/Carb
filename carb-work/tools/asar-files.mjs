import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function readAsar(filename) {
  const bytes = await readFile(filename);
  assert.equal(bytes.readUInt32LE(0), 4, 'Invalid ASAR pickle');
  const headerBytes = bytes.subarray(16, 16 + bytes.readUInt32LE(12));
  const header = JSON.parse(headerBytes);
  const start = 8 + bytes.readUInt32LE(4);
  const entries = new Map();
  const unpacked = [];
  function walk(directory, prefix = '') {
    for (const [name, entry] of Object.entries(directory)) {
      const key = prefix + name;
      if (entry.files) walk(entry.files, key + '/');
      else if (entry.unpacked) unpacked.push(key);
      else if (!entry.link) {
        const offset = start + Number(entry.offset);
        assert(offset >= start && offset + entry.size <= bytes.length, `Invalid ASAR member ${key}`);
        const content = bytes.subarray(offset, offset + entry.size);
        if (entry.integrity) assert.equal(createHash('sha256').update(content).digest('hex'), entry.integrity.hash, `ASAR integrity mismatch ${key}`);
        entries.set(key, content);
      }
    }
  }
  walk(header.files);
  return { entries, unpacked, sha256: createHash('sha256').update(bytes).digest('hex'), headerSha256: createHash('sha256').update(headerBytes).digest('hex') };
}
