import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Rebuild an ASAR from a directory of member overrides, then update the matching
// ELECTRONASAR resource in a copied Electron executable. Outputs are new files;
// source payload files are never modified.
const [sourceAsarPathArg, sourceExePathArg, overlayDirectoryArg, outputAsarPathArg, outputExePathArg, version, optionsPath] = process.argv.slice(2);
assert(sourceAsarPathArg && sourceExePathArg && overlayDirectoryArg && outputAsarPathArg && outputExePathArg,
  'Usage: node rebuild-asar-overlay.mjs <source-app.asar> <source.exe> <overlay-dir> <output-app.asar> <output.exe> [version] [options.json]');
if (version !== undefined) {
  assert.match(version, /^\d+\.\d+\.\d+(?:\.\d+)?$/u, 'Expected a numeric product version');
  assert(version.split('.').every(part => Number(part) <= 65535), 'Product version components must fit in 16 bits');
}

const sourceAsarPath = path.resolve(sourceAsarPathArg);
const sourceExePath = path.resolve(sourceExePathArg);
const overlayDirectory = path.resolve(overlayDirectoryArg);
const outputAsarPath = path.resolve(outputAsarPathArg);
const outputExePath = path.resolve(outputExePathArg);
const options = optionsPath ? JSON.parse(await readFile(optionsPath, 'utf8')) : {};
const excludedMembers = new Set(options.excludeMembers ?? []);
const branding = options.branding;
const icon = branding?.iconPath ? await readFile(branding.iconPath) : undefined;
assert.notEqual(outputAsarPath.toLowerCase(), sourceAsarPath.toLowerCase(), 'ASAR output must differ from source');
assert.notEqual(outputExePath.toLowerCase(), sourceExePath.toLowerCase(), 'EXE output must differ from source');
assert.notEqual(outputAsarPath.toLowerCase(), outputExePath.toLowerCase(), 'ASAR and EXE outputs must differ');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const toArrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

function parseAsar(bytes) {
  assert(bytes.length >= 16, 'ASAR header is incomplete');
  assert.equal(bytes.readUInt32LE(0), 4, 'Unsupported ASAR header pickle');
  const headerSize = bytes.readUInt32LE(4);
  const jsonSize = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(8), headerSize - 4, 'Invalid ASAR header pickle');
  assert(jsonSize <= headerSize - 8 && 8 + headerSize <= bytes.length, 'Invalid ASAR header bounds');
  const headerBytes = bytes.subarray(16, 16 + jsonSize);
  const header = JSON.parse(headerBytes.toString('utf8'));
  assert(header.files && typeof header.files === 'object', 'ASAR root has no files');
  return { bytes, header, headerBytes, payloadStart: 8 + headerSize };
}

function safeName(name) {
  assert(name && name !== '.' && name !== '..' && !/[\\/\0]/u.test(name), `Unsafe ASAR member name: ${name}`);
}

function walk(files, prefix = '') {
  return Object.entries(files).flatMap(([name, entry]) => {
    safeName(name);
    assert(entry && typeof entry === 'object', `Invalid ASAR entry: ${prefix}${name}`);
    return entry.files ? walk(entry.files, `${prefix}${name}/`) : [[`${prefix}${name}`, entry]];
  });
}

function readMember(archive, name, entry) {
  assert(!entry.unpacked && !entry.link, `Expected packed ASAR member ${name}`);
  const offset = Number(entry.offset);
  assert(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(entry.size) && entry.size >= 0,
    `Invalid ASAR member bounds: ${name}`);
  const start = archive.payloadStart + offset;
  assert(start + entry.size <= archive.bytes.length, `ASAR member exceeds archive: ${name}`);
  const bytes = archive.bytes.subarray(start, start + entry.size);
  if (entry.integrity) {
    assert.equal(entry.integrity.algorithm, 'SHA256', `Unsupported ASAR integrity algorithm: ${name}`);
    assert.equal(sha256(bytes), entry.integrity.hash, `Source ASAR integrity mismatch: ${name}`);
  }
  return bytes;
}

function setIntegrity(entry, bytes) {
  const blockSize = entry.integrity?.blockSize ?? 4 * 1024 * 1024;
  const blocks = [];
  for (let offset = 0; offset < bytes.length; offset += blockSize)
    blocks.push(sha256(bytes.subarray(offset, offset + blockSize)));
  if (bytes.length === 0) blocks.push(sha256(bytes));
  entry.integrity = { algorithm: 'SHA256', hash: sha256(bytes), blockSize, blocks };
}

async function collectOverlay(directory, prefix = '', entries = new Map()) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    safeName(item.name);
    const fullPath = path.join(directory, item.name);
    const memberPath = `${prefix}${item.name}`;
    if (item.isDirectory()) {
      await collectOverlay(fullPath, `${memberPath}/`, entries);
      continue;
    }
    assert(item.isFile(), `Overlay must contain regular files only: ${fullPath}`);
    entries.set(memberPath, await readFile(fullPath));
  }
  return entries;
}

function setOverlayMember(files, memberPath, bytes, changedNames) {
  const segments = memberPath.split('/');
  assert(segments.length > 0, 'ASAR member path is empty');
  for (const segment of segments) safeName(segment);
  let directory = files;
  for (const segment of segments.slice(0, -1)) {
    if (!Object.hasOwn(directory, segment)) directory[segment] = { files: {} };
    assert(directory[segment]?.files && typeof directory[segment].files === 'object',
      `ASAR path collides with an existing file: ${memberPath}`);
    directory = directory[segment].files;
  }
  const fileName = segments.at(-1);
  const current = directory[fileName];
  if (current) {
    assert(!current.files && !current.unpacked && !current.link,
      `ASAR overlay target must be a packed file: ${memberPath}`);
    current.size = bytes.length;
    setIntegrity(current, bytes);
  } else {
    const entry = { size: bytes.length };
    setIntegrity(entry, bytes);
    directory[fileName] = entry;
  }
  changedNames.add(memberPath);
}

function removePackedMember(files, memberPath) {
  const segments = memberPath.split('/');
  const directories = [];
  for (const segment of segments) safeName(segment);
  for (const segment of segments.slice(0, -1)) {
    assert(files[segment]?.files, `Missing ASAR directory for ${memberPath}`);
    directories.push([files, segment]);
    files = files[segment].files;
  }
  const name = segments.at(-1);
  const entry = files[name];
  assert(entry && !entry.unpacked && !entry.link && !entry.files,
    `Only existing packed files may be excluded: ${memberPath}`);
  delete files[name];
  for (const [parent, directory] of directories.reverse()) {
    if (Object.keys(parent[directory].files).length > 0) break;
    delete parent[directory];
  }
}

function encodeAsarHeader(header) {
  const json = Buffer.from(JSON.stringify(header));
  const headerSize = 8 + Math.ceil(json.length / 4) * 4;
  const prefix = Buffer.alloc(8 + headerSize);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(headerSize, 4);
  prefix.writeUInt32LE(headerSize - 4, 8);
  prefix.writeUInt32LE(json.length, 12);
  json.copy(prefix, 16);
  return { prefix, json };
}

function peCertificateDirectory(bytes) {
  assert(bytes.length >= 64 && bytes[0] === 0x4d && bytes[1] === 0x5a, 'Invalid PE executable');
  const peOffset = bytes.readUInt32LE(0x3c);
  assert(peOffset >= 64 && peOffset + 24 <= bytes.length, 'Invalid PE header offset');
  assert.equal(bytes.toString('ascii', peOffset, peOffset + 4), 'PE\0\0', 'Invalid PE signature');
  const optional = peOffset + 24;
  const magic = bytes.readUInt16LE(optional);
  assert(magic === 0x20b || magic === 0x10b, 'Unsupported PE optional-header format');
  const directory = optional + (magic === 0x20b ? 112 : 96) + 4 * 8;
  return { offset: bytes.readUInt32LE(directory), size: bytes.readUInt32LE(directory + 4) };
}

async function resourceLibraries() {
  const modules = 'D:\\UIAgent\\artifacts\\build-tools\\branding\\node_modules';
  const [{ NtExecutable, NtExecutableResource }, { Data, Resource }] = await Promise.all([
    import(pathToFileURL(path.join(modules, 'pe-library', 'dist', 'index.js')).href),
    import(pathToFileURL(path.join(modules, 'resedit', 'dist', 'index.js')).href),
  ]);
  return { NtExecutable, NtExecutableResource, Data, Resource };
}

function rebuildAsar(sourceBytes, overlay) {
  const source = parseAsar(sourceBytes);
  const sourceEntries = new Map(walk(source.header.files));
  for (const [name, entry] of sourceEntries) {
    if (!entry.unpacked && !entry.link) readMember(source, name, entry);
  }
  if (version !== undefined) {
    const name = 'package.json';
    const metadata = JSON.parse((overlay.get(name) ?? readMember(source, name, sourceEntries.get(name))).toString('utf8'));
    assert(metadata.version === version || !overlay.has(name), 'Overlay package version differs from the version argument');
    metadata.version = version;
    overlay.set(name, Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`));
  }

  const header = structuredClone(source.header);
  for (const name of excludedMembers) {
    assert(!overlay.has(name), `Cannot replace and exclude the same ASAR member: ${name}`);
    removePackedMember(header.files, name);
  }
  const changedNames = new Set();
  for (const [name, bytes] of overlay) setOverlayMember(header.files, name, bytes, changedNames);

  let payloadLength = 0;
  const payloads = [];
  const updatedEntries = new Map(walk(header.files));
  for (const [name, entry] of updatedEntries) {
    if (entry.unpacked || entry.link) continue;
    assert(sourceEntries.has(name) || overlay.has(name), `New ASAR member has no overlay bytes: ${name}`);
    const bytes = overlay.get(name) ?? readMember(source, name, sourceEntries.get(name));
    entry.offset = String(payloadLength);
    payloads.push(bytes);
    payloadLength += bytes.length;
  }

  const { prefix, json } = encodeAsarHeader(header);
  const bytes = Buffer.concat([prefix, ...payloads]);
  const result = parseAsar(bytes);
  const resultEntries = new Map(walk(result.header.files));
  assert.equal(resultEntries.size, updatedEntries.size, 'ASAR member count changed unexpectedly');
  for (const [name, entry] of resultEntries) {
    if (entry.unpacked || entry.link) {
      assert.deepEqual(entry, sourceEntries.get(name), `ASAR unpacked/link declaration changed: ${name}`);
      continue;
    }
    const content = readMember(result, name, entry);
    if (!changedNames.has(name)) {
      assert(sourceEntries.has(name), `Unexpected new ASAR member: ${name}`);
      assert.equal(sha256(content), sha256(readMember(source, name, sourceEntries.get(name))),
        `Unchanged ASAR member changed: ${name}`);
    }
    assert.equal(entry.integrity?.hash, sha256(content), `Rebuilt ASAR integrity mismatch: ${name}`);
  }

  return {
    bytes,
    oldHeaderHash: sha256(source.headerBytes),
    headerHash: sha256(json),
    memberCountBefore: sourceEntries.size,
    memberCountAfter: resultEntries.size,
    changedNames: [...changedNames].sort(),
  };
}

async function rebuildExecutable(sourceBytes, oldHeaderHash, newHeaderHash) {
  const { NtExecutable, NtExecutableResource, Data, Resource } = await resourceLibraries();
  const certificate = peCertificateDirectory(sourceBytes);
  assert.equal(certificate.offset, 0, 'Refusing to rewrite a PE with an embedded certificate table');
  assert.equal(certificate.size, 0, 'Refusing to rewrite a PE with an embedded certificate table');

  const executable = NtExecutable.from(sourceBytes);
  const resources = NtExecutableResource.from(executable);
  const sourceSections = executable.getAllSections().filter(section => section.info.name !== '.rsrc')
    .map(section => Buffer.from(section.data ?? new ArrayBuffer(0)));
  const integrityEntries = resources.entries.filter(entry => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR');
  assert.equal(integrityEntries.length, 1, 'Expected one ELECTRONASAR integrity resource');
  let archiveRecords = 0;
  for (const entry of integrityEntries) {
    const values = JSON.parse(Buffer.from(entry.bin).toString('utf8').replace(/\0+$/u, ''));
    for (const value of values) {
      if (value.file.replaceAll('\\', '/').toLowerCase() !== 'resources/app.asar') continue;
      assert.equal(value.alg, 'SHA256', 'Unsupported ELECTRONASAR integrity algorithm');
      assert.equal(value.value, oldHeaderHash, 'Source executable does not match the source ASAR header');
      value.value = newHeaderHash;
      archiveRecords++;
    }
    entry.bin = toArrayBuffer(Buffer.from(JSON.stringify(values)));
  }
  assert.equal(archiveRecords, 1, 'Expected exactly one resources/app.asar integrity record');
  if (icon) {
    const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
    const images = Data.IconFile.from(icon).icons.map(item => item.data);
    assert(groups.length > 0 && images.length > 0, 'Expected source icon groups and replacement images');
    for (const group of groups) Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, images);
  }
  if (version !== undefined || branding) {
    const versions = Resource.VersionInfo.fromEntries(resources.entries);
    assert(versions.length > 0, 'Missing PE version resource');
    for (const info of versions) {
      if (version !== undefined) {
        const numbers = version.split('.').map(Number);
        while (numbers.length < 4) numbers.push(0);
        info.setFileVersion(...numbers);
        info.setProductVersion(...numbers);
      }
      for (const language of info.getAllLanguagesForStringValues()) {
        info.setStringValues(language, {
          ...(version === undefined ? {} : { FileVersion: version, ProductVersion: version }),
          ...branding?.versionStrings,
        });
      }
      info.outputToResourceEntries(resources.entries);
    }
  }
  resources.outputResource(executable);
  const bytes = Buffer.from(executable.generate());

  const verified = NtExecutable.from(bytes);
  const outputSections = verified.getAllSections().filter(section => section.info.name !== '.rsrc')
    .map(section => Buffer.from(section.data ?? new ArrayBuffer(0)));
  assert.deepEqual(outputSections, sourceSections, 'Executable code/non-resource sections changed');
  const outputCertificate = peCertificateDirectory(bytes);
  assert.equal(outputCertificate.offset, 0, 'Output executable unexpectedly has a certificate table');
  assert.equal(outputCertificate.size, 0, 'Output executable unexpectedly has a certificate table');
  const outputResources = NtExecutableResource.from(verified).entries;
  const outputIntegrityEntries = outputResources.filter(entry => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR');
  assert.equal(outputIntegrityEntries.length, 1, 'Patched executable lost ELECTRONASAR integrity resource');
  const outputValues = JSON.parse(Buffer.from(outputIntegrityEntries[0].bin).toString('utf8').replace(/\0+$/u, ''));
  const archiveValue = outputValues.filter(value => value.file.replaceAll('\\', '/').toLowerCase() === 'resources/app.asar');
  assert.equal(archiveValue.length, 1);
  assert.equal(archiveValue[0].value, newHeaderHash);
  if (version !== undefined || branding) {
    const versions = Resource.VersionInfo.fromEntries(outputResources);
    assert(versions.length > 0, 'Rebuilt PE lost version information');
    for (const info of versions) for (const language of info.getAllLanguagesForStringValues()) {
      const strings = info.getStringValues(language);
      if (version !== undefined) {
        assert.equal(strings.FileVersion, version);
        assert.equal(strings.ProductVersion, version);
      }
      for (const [key, value] of Object.entries(branding?.versionStrings ?? {})) assert.equal(strings[key], value);
    }
  }
  return bytes;
}

const [sourceAsar, sourceExe, overlayStats] = await Promise.all([
  readFile(sourceAsarPath), readFile(sourceExePath), stat(overlayDirectory),
]);
assert(overlayStats.isDirectory(), `Overlay path must be a directory: ${overlayDirectory}`);
const overlay = await collectOverlay(overlayDirectory);
assert(overlay.size > 0, 'Overlay directory contains no files');
const archive = rebuildAsar(sourceAsar, overlay);
const executable = await rebuildExecutable(sourceExe, archive.oldHeaderHash, archive.headerHash);

await mkdir(path.dirname(outputAsarPath), { recursive: true });
await mkdir(path.dirname(outputExePath), { recursive: true });
await writeFile(outputAsarPath, archive.bytes, { flag: 'wx' });
try {
  await writeFile(outputExePath, executable, { flag: 'wx' });
} catch (error) {
  await rm(outputAsarPath, { force: true });
  throw error;
}

console.log(JSON.stringify({
  source: { asar: sourceAsarPath, exe: sourceExePath },
  output: { asar: outputAsarPath, exe: outputExePath },
  version,
  changedAsarMembers: archive.changedNames,
  excludedAsarMembers: [...excludedMembers].sort(),
  memberCountBefore: archive.memberCountBefore,
  memberCountAfter: archive.memberCountAfter,
  asarBytes: archive.bytes.length,
  asarSha256: sha256(archive.bytes),
  asarHeaderSha256: archive.headerHash,
  executableBytes: executable.length,
  executableSha256: sha256(executable),
}, null, 2));
