import assert from 'node:assert/strict';
import { replaceOnce } from './prepare-brand.mjs';

const marker = '// Carb: resolve standalone Codex consistently for detection and execution.';
export function patchCliDetection(source) {
  if (source.includes(marker)) return source;
  source = marker + "\nimport { isCodexLookup, isCodexCliCandidate } from './carb-cli-candidates.js';\n" + source;
  source = replaceOnce(source,
    "        if (/\\.(?:exe|com)$/i.test(command))",
    "        if (/\\.(?:exe|com)$/i.test(command) && !isCodexLookup(command))");
  source = replaceOnce(source,
    '        const executable = resolved ?? command;',
    "        if (!resolved && isCodexLookup(command)) throw new Error('Codex CLI is not installed. Install the standalone CLI; the desktop app is detected separately.');\n        const executable = resolved ?? command;");
  source = replaceOnce(source,
    '    return spawnOwned(command, args, spawnOptions);\n}',
    "    const executable = isCodexLookup(command) ? resolveExecutable(command, spawnOptions.env) : command;\n    if (!executable) throw new Error('Codex CLI is not installed. Install the standalone CLI; the desktop app is detected separately.');\n    return spawnOwned(executable, args, spawnOptions);\n}");
  source = source.replaceAll('cached.path === undefined || isFile(cached.path)',
    'cached.path === undefined || (isFile(cached.path) && (!isCodexLookup(command) || isCodexCliCandidate(cached.path)))');
  source = replaceOnce(source,
    'cached.path === undefined || (await isFileAsync(cached.path))',
    'cached.path === undefined || ((await isFileAsync(cached.path)) && (!isCodexLookup(command) || isCodexCliCandidate(cached.path)))');
  source = replaceOnce(source,
    '        if (isFile(candidate))\n            return rememberLookup(lookup.key, candidate);',
    '        if (isFile(candidate) && (!isCodexLookup(command) || isCodexCliCandidate(candidate)))\n            return rememberLookup(lookup.key, candidate);');
  source = replaceOnce(source,
    '        if (await isFileAsync(candidate))\n            return rememberLookup(lookup.key, candidate);',
    '        if ((await isFileAsync(candidate)) && (!isCodexLookup(command) || isCodexCliCandidate(candidate)))\n            return rememberLookup(lookup.key, candidate);');
  source = replaceOnce(source,
    '            if (statSync(candidate).isFile())\n                return candidate;',
    '            if (statSync(candidate).isFile() && (!isCodexLookup(command) || isCodexCliCandidate(candidate)))\n                return candidate;');
  assert(source.includes('isCodexCliCandidate(candidate)'));
  return source;
}

export function patchProviderCliDetection(source) {
  const marker = '// Carb: report CLI availability and desktop presence independently.';
  if (source.includes(marker)) return source;
  source = marker + "\nimport { locateCommand } from '@harness/proc/cli';\nimport { cliShellCommand } from '../../proc/dist/carb-cli-candidates.js';\nimport { detectAgentDesktops } from '../../adapter-acp/dist/carb-desktop-detection.js';\n" + source;
  source = replaceOnce(source,
    '    isInstalled: (command) => cliProbe.installed(command),',
    '    isInstalled: (command) => cliProbe.installed(command),\n    locate: (command) => locateCommand(command),\n    desktops: () => detectAgentDesktops(),');
  source = replaceOnce(source,
    '    const installed = await system.isInstalled(entry.command);',
    "    const installed = await system.isInstalled(entry.command);\n    const desktop = entry.id === 'codex' && system.desktops ? { desktopInstalled: Boolean((await system.desktops()).codex) } : {};\n    const cli = entry.id === 'codex' && installed && system.locate ? { cliPath: await system.locate(entry.command) } : {};");
  source = replaceOnce(source,
    '            problem: `${entry.command} is not on PATH`,',
    "            ...desktop,\n            problem: entry.id === 'codex' ? (desktop.desktopInstalled ? 'Codex desktop is installed. Install the standalone Codex CLI to use it here.' : 'Codex CLI was not found. Install the standalone CLI.') : `${entry.command} is not on PATH`,");
  source = replaceOnce(source,
    '        installed: true,\n        auth,',
    '        installed: true,\n        ...desktop,\n        ...cli,\n        auth,');
  source = replaceOnce(source,
    '    return target.setup.installCommand;',
    "    if (provider === 'codex') {\n        const executable = await locateCommand('codex');\n        if (executable) return 'echo Codex CLI is already installed. Skipping installation.';\n    }\n    return target.setup.installCommand;");
  source = replaceOnce(source,
    '    return entry.loginCommand;',
    "    if (provider === 'codex') {\n        const executable = await locateCommand('codex');\n        if (!executable) throw new Error('Install the standalone Codex CLI before signing in.');\n        return cliShellCommand(executable, ['login']);\n    }\n    return entry.loginCommand;");
  return source;
}

export function patchProviderStatusContract(source) {
  const anchor = 'export const ProviderStatusSchema = z.object({';
  if (source.includes('    cliPath: z.string().optional(),')) return source;
  return replaceOnce(source, anchor, anchor + '\n    desktopInstalled: z.boolean().optional(),\n    cliPath: z.string().optional(),');
}

export function patchCodexUpdateCommand(source) {
  if (source.includes('cliShellCommand')) return source;
  source = "import { locateCommand } from '@harness/proc/cli';\nimport { cliShellCommand } from '../../proc/dist/carb-cli-candidates.js';\n" + source;
  source = replaceOnce(source, "        const help = await runCli('codex', ['update', '--help']);",
    "        const help = await runCli('codex', ['update', '--help']);\n        const updateExecutable = await locateCommand('codex');");
  source = replaceOnce(source, "command: help.code === 0 && /codex update/.test(help.stdout) ? 'codex update' : undefined,",
    "command: updateExecutable && help.code === 0 && /codex update/.test(help.stdout) ? cliShellCommand(updateExecutable, ['update']) : undefined,");
  return source;
}

export function patchCliUpdatePath(source) {
  const marker = '// Carb: update the same CLI that detection and execution resolve.';
  if (source.includes(marker)) return source;
  source = replaceOnce(source,
    "import path from 'node:path';\nimport { desktopPath } from './desktop-path.js';",
    "import { locateCommand } from './cli.js';");
  const start = source.indexOf('export async function cliPath(command) {');
  const end = source.indexOf('\n}\n', start);
  assert(start >= 0 && end > start, 'CLI update path resolver anchor missing');
  return source.slice(0, start) + marker + `
export async function cliPath(command) {
    const executable = await locateCommand(command);
    if (!executable)
        return undefined;
    try {
        return await realpath(executable);
    }
    catch {
        // The executable can disappear after lookup, for example during an update.
        return undefined;
    }
}` + source.slice(end + 2);
}
