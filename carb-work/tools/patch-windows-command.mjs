import assert from 'node:assert/strict';
import { replaceOnce } from './prepare-brand.mjs';

const marker = '// Carb: pass cmd syntax verbatim inside its required outer quotes.';
const oldSpawn = "    const child = spawn(isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh', isWindows ? ['/d', '/s', '/c', command] : ['-lc', command], {";
const newSpawn = `    ${marker}
    const shellArgs = isWindows ? ['/d', '/s', '/c', '"' + command + '"'] : ['-lc', command];
    const child = spawn(isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh', shellArgs, {`;
const oldKill = "    const kill = () => { try { child.kill('SIGTERM'); } catch {} };";
const newKill = `    const kill = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const terminate = () => { try { child.kill('SIGTERM'); } catch {} };
      if (!isWindows || !child.pid) { terminate(); return; }
      // cmd.exe owns the command's process tree; cancellation must stop it too.
      const killer = spawn(path.join(process.env.SystemRoot || 'C:\\\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], {
        shell: false, windowsHide: true, stdio: 'ignore',
      });
      killer.once('error', terminate);
      killer.once('exit', code => { if (code !== 0) terminate(); });
    };`;
const oldDescription = "      description: 'Run a shell command in the active workspace.',";
const newDescription = "      description: 'Run a shell command in the active workspace. Windows uses cmd.exe: group paths and arguments with double quotes; single quotes do not group arguments. Other platforms use /bin/sh. Write complex or multiline code to a script file before running it.',";

// Node normally escapes argv for a C runtime. cmd.exe parses command text
// instead, so that escaping changes quotes into literal backslashes and splits
// font names/paths. /s strips the outer pair we add; the user's command remains
// byte-for-byte intact, including pipes, redirection and quoted executables.
export function patchWindowsCommand(source) {
  if (source.includes(marker)) {
    assert(source.includes('      windowsVerbatimArguments: isWindows,') && source.includes(newSpawn) &&
      source.includes(newKill) && source.includes(newDescription),
    'Unsupported Windows command patch: expected quoting, cancellation and tool guidance');
    return source;
  }
  source = replaceOnce(source, oldSpawn, newSpawn);
  source = replaceOnce(source, '      shell: false,\n      windowsHide: true,', '      shell: false,\n      windowsVerbatimArguments: isWindows,\n      windowsHide: true,');
  source = replaceOnce(source, oldKill, newKill);
  source = replaceOnce(source, "    signal.addEventListener('abort', kill, { once: true });", "    signal.addEventListener('abort', kill, { once: true });\n    if (signal.aborted) kill();");
  source = replaceOnce(source, oldDescription, newDescription);
  return source;
}
