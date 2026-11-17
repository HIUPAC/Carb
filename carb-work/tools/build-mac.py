"""Build Carb for Intel and Apple Silicon from the staged desktop payload."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import shutil
import stat
import struct
import subprocess
import tarfile
import zipfile

ELECTRON = '43.4.0'
ARCHES = {'x64': 0x01000007, 'arm64': 0x0100000c}
ELECTRON_SHA256 = {
    'x64': '7ab39ec1b0bcf5463f2dc0040142fbc1c30cd7bc3f99086066f588c717b11e24',
    'arm64': '827f9f182566f46846377575b51c547b9926b111637313a373b6f717462aebac',
}
NATIVE_SHA512 = {
    'node-pty-1.2.0-beta.15.tgz': 'vORSzHXi4Ofl7HemVWpuudLqCPdaQb4LfpRCUpE5HPxhp4JYscl8zZwxh11p26v2wvW24WMwnMfLjhRLixrfxA==',
    'napi-rs-keyring-darwin-arm64-1.3.0.tgz': 'pl76hJvdYUBn6I24bXiOBMA9nbDapo3I5B+f3OorjDU4dUMSypXeKbOVehJe8fhgTiH24flMyTS3aAIy43xegQ==',
    'napi-rs-keyring-darwin-x64-1.3.0.tgz': 'YcJtEV5LA3cvA4z3BurgxH5IhTsW1JfIvcAAcqcecwk06Si9F9NqkxbZVIfDwQ8oRHgaBmT3zZJnLAotCrVahw==',
}
FUSE_SENTINEL = b'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
INTEGRITY_SENTINEL = b'AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A'
BUNDLE_ID = 'com.icewheel.carb'
TOOLS = Path(__file__).resolve().parent
ORIGINAL_ICON = TOOLS.parent / 'branding' / 'carb.icns'


def digest(path, algorithm='sha256'):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, algorithm).digest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def extract_electron(archive, destination, arch):
    require(digest(archive).hex() == ELECTRON_SHA256[arch], f'Invalid Electron archive: {archive}')
    with zipfile.ZipFile(archive) as package:
        links = []
        for member in package.infolist():
            name = PurePosixPath(member.filename)
            require(not name.is_absolute() and '..' not in name.parts, f'Unsafe ZIP member {name}')
            output = destination.joinpath(*name.parts)
            mode = member.external_attr >> 16
            if stat.S_ISLNK(mode):
                links.append((output, package.read(member).decode()))
            elif member.is_dir():
                output.mkdir(parents=True, exist_ok=True)
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                with package.open(member) as source, output.open('xb') as stream:
                    shutil.copyfileobj(source, stream)
                output.chmod(stat.S_IMODE(mode) or 0o644)
        while links:
            unresolved = []
            for link, relative in links:
                require(not PurePosixPath(relative).is_absolute(), f'Unsafe ZIP link {link}')
                target = link.parent / relative
                require(target.resolve().is_relative_to(destination), f'Unsafe ZIP link {link}')
                if not target.exists():
                    unresolved.append((link, relative))
                    continue
                link.symlink_to(Path(relative), target_is_directory=target.is_dir())
            require(len(unresolved) < len(links), f'Unresolved ZIP links: {unresolved}')
            links = unresolved


def macho_arch(path):
    with path.open('rb') as stream:
        header = stream.read(12)
    if header[:4] == b'\xcf\xfa\xed\xfe':
        return struct.unpack_from('<II', header, 4)
    return None


def merge_macho(x64, arm64, destination):
    alignment = 14
    boundary = 1 << alignment
    next_offset = boundary
    slices = []
    for arch, source in [('x64', x64), ('arm64', arm64)]:
        cpu, subtype = macho_arch(source)
        require(cpu == ARCHES[arch], f'Unexpected Mach-O architecture: {source}')
        size = source.stat().st_size
        slices.append((source, cpu, subtype, next_offset, size))
        next_offset = (next_offset + size + boundary - 1) & -boundary

    with destination.open('wb') as stream:
        stream.write(struct.pack('>II', 0xcafebabe, len(slices)))
        for _, cpu, subtype, offset, size in slices:
            stream.write(struct.pack('>IIIII', cpu, subtype, offset, size, alignment))
        for source, _, _, offset, _ in slices:
            stream.seek(offset)
            with source.open('rb') as thin:
                shutil.copyfileobj(thin, stream)


def iter_tree(root):
    for directory, subdirectories, files in os.walk(root, followlinks=False):
        current = Path(directory)
        for name in sorted(subdirectories + files):
            path = current / name
            yield path.relative_to(root), path
        subdirectories.sort()


def merge_runtime(x64, arm64, destination, x64_archive):
    # On Windows, copytree can create an invalid file symlink for a directory
    # whose target has not been copied yet. Extract the verified archive again.
    extract_electron(x64_archive, destination.parent / 'runtime', 'x64')
    (destination.parent / 'runtime' / 'Electron.app').rename(destination)
    for relative, intel in iter_tree(x64):
        silicon = arm64 / relative
        if intel.is_symlink() or intel.is_dir():
            continue
        target = destination / relative
        if not silicon.is_file():
            require(relative.suffix == '.bin', f'No arm64 counterpart for {relative}')
        elif macho_arch(intel):
            merge_macho(intel, silicon, target)
        elif relative.name != 'Info.plist' and '_CodeSignature' not in relative.parts:
            require(digest(intel) == digest(silicon), f'Platform data differs: {relative}')
    for relative, silicon in iter_tree(arm64):
        target = destination / relative
        if not target.exists() and not target.is_symlink():
            require(relative.suffix == '.bin', f'No x64 counterpart for {relative}')
            shutil.copy2(silicon, target)


def asar_member(header, relative):
    entry = header
    for part in PurePosixPath(relative).parts:
        entry = entry['files'][part]
    return entry


def integrity(data):
    size = 4 * 1024 * 1024
    chunks = [data[offset:offset + size] for offset in range(0, len(data), size)] or [b'']
    return {'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(), 'blockSize': size,
            'blocks': [hashlib.sha256(block).hexdigest() for block in chunks]}


def store_native(root, header, package, source, relative, arch=None, executable=False):
    member = package.getmember(f'package/{source}')
    require(member.isfile(), f'Expected a regular npm member: {source}')
    with package.extractfile(member) as stream:
        data = stream.read()
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    target.chmod(0o755 if executable or arch else 0o644)
    if arch:
        require(macho_arch(target)[0] == ARCHES[arch], f'Unexpected native architecture: {relative}')
    parts = PurePosixPath(relative).parts
    entry = header['files']
    for part in parts[:-1]:
        entry = entry.setdefault(part, {'files': {}})['files']
    entry[parts[-1]] = {'size': len(data), 'unpacked': True, 'integrity': integrity(data)}


def update_resources(payload, dependencies, contents):
    resources = contents / 'Resources'
    for name in ('default-skills', 'feedback', 'licenses', 'web'):
        shutil.copytree(payload / name, resources / name)
    for name in ('LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES.txt', 'THIRD_PARTY_NOTICES.md'):
        shutil.copy2(payload / name, resources / name)
    default_asar = resources / 'default_app.asar'
    default_asar.unlink(missing_ok=True)

    archive = (payload / 'app.asar').read_bytes()
    header_length, = struct.unpack_from('<I', archive, 12)
    data_offset = 8 + struct.unpack_from('<I', archive, 4)[0]
    header = json.loads(archive[16:16 + header_length])
    native = resources / 'app.asar.unpacked'
    shutil.copytree(payload / native.name, native,
                    ignore=shutil.ignore_patterns('win32-*', 'keyring-win32-x64-msvc'))
    napi = asar_member(header, 'node_modules/@napi-rs')['files']
    del napi['keyring-win32-x64-msvc']
    pty = asar_member(header, 'node_modules/node-pty/prebuilds')['files']
    del pty['win32-x64'], pty['win32-arm64']

    for name, expected in NATIVE_SHA512.items():
        require(base64.b64encode(digest(dependencies / name, 'sha512')).decode() == expected,
                f'Invalid npm tarball: {name}')
    with tarfile.open(dependencies / 'node-pty-1.2.0-beta.15.tgz') as package:
        for arch in ARCHES:
            for filename in ('pty.node', 'spawn-helper'):
                relative = f'prebuilds/darwin-{arch}/{filename}'
                store_native(native, header, package, relative, f'node_modules/node-pty/{relative}',
                             arch, executable=filename == 'spawn-helper')
    for arch in ARCHES:
        package_name = f'keyring-darwin-{arch}'
        with tarfile.open(dependencies / f'napi-rs-{package_name}-1.3.0.tgz') as package:
            filename = f'keyring.darwin-{arch}.node'
            for file, native_arch in [('package.json', None), (filename, arch)]:
                store_native(native, header, package, file, f'node_modules/@napi-rs/{package_name}/{file}', native_arch)

    metadata = asar_member(header, 'package.json')
    metadata_offset = data_offset + int(metadata['offset'])
    package_metadata = json.loads(archive[metadata_offset:metadata_offset + metadata['size']])
    require(package_metadata.get('productName') == 'Carb', 'Expected a Carb desktop payload')
    shutil.copy2(ORIGINAL_ICON, resources / 'carb.icns')
    helper = resources / 'uninstall-carb.sh'
    shutil.copy2(TOOLS / 'installer' / helper.name, helper)
    helper.chmod(0o755)
    return header, archive[data_offset:], package_metadata['version']


def write_asar(contents, header, data):
    serialized = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode()
    padding = bytes(-len(serialized) % 4)
    header_size = 8 + len(serialized) + len(padding)
    prefix = struct.pack('<IIII', 4, header_size, header_size - 4, len(serialized))
    (contents / 'Resources' / 'app.asar').write_bytes(prefix + serialized + padding + data)
    return hashlib.sha256(serialized).hexdigest()


def configure_app(contents, asar_hash, version):
    plist = contents / 'Info.plist'
    info = plistlib.loads(plist.read_bytes())
    (contents / 'MacOS' / info['CFBundleExecutable']).rename(contents / 'MacOS' / 'Carb')
    info.update(CFBundleIdentifier=BUNDLE_ID, CFBundleExecutable='Carb', CFBundleName='Carb',
                CFBundleDisplayName='Carb', CFBundleIconFile='carb.icns', CFBundleShortVersionString=version,
                CFBundleVersion=version, NSMicrophoneUsageDescription='Carb uses the microphone for voice input.',
                ElectronAsarIntegrity={'Resources/app.asar': {'algorithm': 'SHA256', 'hash': asar_hash}})
    plist.write_bytes(plistlib.dumps(info))

    helpers = list((contents / 'Frameworks').glob('Electron Helper*.app'))
    helpers.extend((contents / 'Library' / 'LoginItems').glob('Electron Login Helper.app'))
    for bundle in helpers:
        helper_plist = bundle / 'Contents' / 'Info.plist'
        helper = plistlib.loads(helper_plist.read_bytes())
        executable_name = helper.get('CFBundleExecutable', bundle.stem)
        name = executable_name.replace('Electron', 'Carb', 1)
        identifier = helper['CFBundleIdentifier'].replace('com.github.Electron', BUNDLE_ID, 1)
        require(identifier.startswith(BUNDLE_ID), f'Unexpected helper bundle identifier: {identifier}')
        if '(' in name:
            identifier += '.' + name.split('(')[-1].rstrip(')')
        executable = bundle / 'Contents' / 'MacOS' / executable_name
        executable.rename(executable.with_name(name))
        helper.update(CFBundleExecutable=name, CFBundleName=name, CFBundleDisplayName=name,
                      CFBundleIdentifier=identifier, CFBundleVersion=version, CFBundleShortVersionString=version,
                      NSMicrophoneUsageDescription=info['NSMicrophoneUsageDescription'])
        helper_plist.write_bytes(plistlib.dumps(helper))
        bundle.rename(bundle.with_name(f'{name}.app'))

    framework = contents / 'Frameworks' / 'Electron Framework.framework' / 'Versions' / 'A' / 'Electron Framework'
    with framework.open('r+b') as stream:
        binary = stream.read()
        cursor = 0
        for _ in ARCHES:
            position = binary.index(FUSE_SENTINEL, cursor) + len(FUSE_SENTINEL)
            require(binary[position] == 1 and binary[position + 1] >= 6, 'Unexpected Electron fuse wire')
            # Enable embedded ASAR integrity and require ASAR-only app loading.
            stream.seek(position + 2 + 4)
            stream.write(b'11')
            cursor = position + 2 + binary[position + 1]
        require(FUSE_SENTINEL not in binary[cursor:], 'Unexpected number of Electron fuse wires')
        dictionary_hash = hashlib.sha256(f'Resources/app.asarSHA256{asar_hash}'.encode()).digest()
        slot = INTEGRITY_SENTINEL + bytes(34)
        require(binary.count(slot) == len(ARCHES), 'Unexpected number of Electron integrity digest slots')
        cursor = 0
        for _ in ARCHES:
            position = binary.index(slot, cursor) + len(INTEGRITY_SENTINEL)
            stream.seek(position)
            stream.write(b'\x01\x01' + dictionary_hash)
            cursor = position + 34


def verify_code_pages(path):
    with path.open('rb') as stream:
        magic, count = struct.unpack('>II', stream.read(8))
        if magic == 0xcafebabe:
            slices = [struct.unpack('>IIIII', stream.read(20))[:4] for _ in range(count)]
            require({cpu for cpu, _, _, _ in slices} == set(ARCHES.values()), f'Incomplete universal binary: {path}')
        else:
            slices = [(*macho_arch(path), 0, path.stat().st_size)]
        for cpu, _, start, size in slices:
            stream.seek(start)
            signed = stream.read(size)
            require(struct.unpack_from('<I', signed, 4)[0] == cpu, f'Invalid Mach-O slice: {path}')
            ncmds, = struct.unpack_from('<I', signed, 16)
            offset = 32
            signature = None
            for _ in range(ncmds):
                command, command_size = struct.unpack_from('<II', signed, offset)
                if command == 0x1d:  # LC_CODE_SIGNATURE
                    begin, length = struct.unpack_from('<II', signed, offset + 8)
                    signature = signed[begin:begin + length]
                    break
                offset += command_size
            require(signature is not None, f'No Mach-O signature: {path}')
            signature_magic, _, slot_count = struct.unpack_from('>III', signature)
            require(signature_magic == 0xfade0cc0, f'Invalid signature container: {path}')
            directories = 0
            for slot in range(slot_count):
                kind, begin = struct.unpack_from('>II', signature, 12 + slot * 8)
                if kind != 0 and not 0x1000 <= kind < 0x1005:
                    continue
                directories += 1
                directory = signature[begin:]
                cd_magic, _, _, _, hash_offset, _, _, pages, limit, hash_size, hash_type, _, page_bits, _ = (
                    struct.unpack_from('>9I4BI', directory))
                require(cd_magic == 0xfade0c02, f'Invalid CodeDirectory: {path}')
                algorithm = {1: 'sha1', 2: 'sha256', 3: 'sha256', 4: 'sha384'}[hash_type]
                page_size = 1 << page_bits
                require(pages == (limit + page_size - 1) // page_size, f'Invalid signature page count: {path}')
                for page in range(pages):
                    data = signed[page * page_size:min(limit, (page + 1) * page_size)]
                    expected = directory[hash_offset + page * hash_size:hash_offset + (page + 1) * hash_size]
                    require(hashlib.new(algorithm, data).digest()[:hash_size] == expected,
                            f'Invalid signature page {page}: {path}')
            require(directories > 0, f'No CodeDirectory: {path}')


def archive_app(app, output, executable_paths):
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as package:
        for relative, path in iter_tree(app):
            name = f'{app.name}/{relative.as_posix()}'
            if path.is_symlink():
                link = zipfile.ZipInfo(name)
                link.create_system = 3
                link.external_attr = (stat.S_IFLNK | 0o777) << 16
                package.writestr(link, path.readlink().as_posix())
            elif not path.is_dir():
                info = zipfile.ZipInfo.from_file(path, arcname=name)
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | (0o755 if relative in executable_paths else 0o644)) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                info.compress_level = 6
                with path.open('rb') as source, package.open(info, 'w') as entry:
                    shutil.copyfileobj(source, entry)
    with zipfile.ZipFile(output) as package:
        require(package.testzip() is None, 'Corrupt output ZIP')
        names = set(package.namelist())
        for member in package.infolist():
            relative = PurePosixPath(member.filename)
            mode = member.external_attr >> 16
            if stat.S_ISLNK(mode):
                target = relative.parent / PurePosixPath(package.read(member).decode())
                require(any(name == target.as_posix() or name.startswith(target.as_posix() + '/') for name in names)
                        or (app.parent / target).exists(), f'Invalid archive symlink: {relative}')
        for relative in executable_paths:
            member = package.getinfo(f'{app.name}/{relative.as_posix()}')
            require((member.external_attr >> 16) & stat.S_IXUSR, f'Missing executable ZIP permission: {relative}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('payload', 'dependencies', 'work', 'output', 'rcodesign'):
        parser.add_argument(name, type=lambda value: Path(value).resolve())
    args = parser.parse_args()
    require(not args.output.exists(), f'Output already exists: {args.output}')
    args.work.mkdir()
    for arch in ARCHES:
        extract_electron(args.dependencies / f'electron-v{ELECTRON}-darwin-{arch}.zip', args.work / arch, arch)

    app = args.work / 'Carb.app'
    merge_runtime(args.work / 'x64' / 'Electron.app', args.work / 'arm64' / 'Electron.app', app,
                  args.dependencies / f'electron-v{ELECTRON}-darwin-x64.zip')
    contents = app / 'Contents'
    header, data, version = update_resources(args.payload / 'resources', args.dependencies, contents)
    shutil.copy2(args.work / 'x64' / 'LICENSE', contents / 'Resources' / 'LICENSE.electron.txt')
    shutil.copy2(args.work / 'x64' / 'LICENSES.chromium.html', contents / 'Resources')

    signer = str(args.rcodesign)
    native = contents / 'Resources' / 'app.asar.unpacked'
    for relative, path in iter_tree(native):
        if path.is_file() and macho_arch(path):
            subprocess.run([signer, 'sign', str(path)], check=True)
            signed = path.read_bytes()
            asar_member(header, relative.as_posix()).update(size=len(signed), integrity=integrity(signed))
    configure_app(contents, write_asar(contents, header, data), version)

    # Sign the modified framework, helpers and final app from the inside out.
    frameworks = contents / 'Frameworks'
    for framework in sorted(frameworks.glob('*.framework')):
        subprocess.run([signer, 'sign', str(framework / 'Versions' / 'A')], check=True)
    for bundle in sorted(frameworks.glob('Carb Helper*.app')):
        subprocess.run([signer, 'sign', str(bundle)], check=True)
    for bundle in (contents / 'Library' / 'LoginItems').glob('Carb Login Helper.app'):
        subprocess.run([signer, 'sign', str(bundle)], check=True)
    subprocess.run([signer, 'sign', '--shallow', str(app)], check=True)

    native_count = 0
    executable_paths = set()
    for relative, path in iter_tree(app):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open('rb') as stream:
            magic = stream.read(4)
        if magic in (b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe'):
            verify_code_pages(path)
            executable_paths.add(relative)
            native_count += 1
        require(magic[:2] != b'MZ', f'Windows executable in macOS package: {relative}')
    executable_paths.add(Path('Contents/Resources/uninstall-carb.sh'))
    archive_app(app, args.output, executable_paths)
    print(json.dumps({'file': str(args.output), 'version': version, 'architectures': list(ARCHES),
                      'verifiedMachOFiles': native_count, 'sha256': digest(args.output).hex()}))


if __name__ == '__main__':
    main()
