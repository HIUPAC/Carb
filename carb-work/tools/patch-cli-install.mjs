import assert from 'node:assert/strict';

const terminalPath = 'node_modules/@harness/server/dist/terminal.js';
const codexPath = 'node_modules/@harness/adapter-codex/dist/updates.js';
export const cliInstallNativePaths = [terminalPath, codexPath];

function once(source, before, after) {
  assert.equal(source.split(before).length, 2, `Expected one CLI installation anchor: ${before.slice(0, 120)}`);
  return source.replace(before, () => after);
}

// A hidden install pane used to fit xterm to 2 columns and 1 row, then send
// that size to ConPTY. PowerShell wraps its error records at the console width,
// so the result remains unreadable even after the pane becomes visible.
export function terminalDimensions(columns, rows, command = false) {
  const size = (value, minimum, fallback, maximum) => Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value)))
    : fallback;
  return {
    columns: size(columns, command ? 40 : 2, 100, 500),
    rows: size(rows, command ? 10 : 1, 30, 200),
  };
}

function patchTerminal(source) {
  const marker = '// Carb: command terminals retain readable dimensions while their pane is hidden.';
  if (source.includes(marker)) {
    assert(source.includes('terminalDimensions(columns, rows, entry.command)') &&
      source.includes('command: args.length > 0') && source.includes('cols: dimensions.columns'),
    'Incomplete CLI terminal dimensions patch');
    return source;
  }
  source = once(source, 'export class TerminalManager {', `${marker}\n${terminalDimensions.toString().replace('function terminalDimensions', 'export function terminalDimensions')}\nexport class TerminalManager {`);
  source = once(source, '        const terminalId = randomUUID();\n        this.#pruneStatuses();',
    '        const dimensions = terminalDimensions(columns, rows, args.length > 0);\n        const terminalId = randomUUID();\n        this.#pruneStatuses();');
  source = once(source, '            cols: columns,\n            rows,', '            cols: dimensions.columns,\n            rows: dimensions.rows,');
  source = once(source, 'const entry = { key, threadId, process, output, outputBuffer, exited };',
    'const entry = { key, threadId, process, output, outputBuffer, exited, command: args.length > 0 };');
  source = once(source, '        this.#get(terminalId).process.resize(columns, rows);',
    '        const entry = this.#get(terminalId);\n        const dimensions = terminalDimensions(columns, rows, entry.command);\n        entry.process.resize(dimensions.columns, dimensions.rows);');
  return source;
}

function patchCodexInstaller(source) {
  const before = "const script = `$ErrorActionPreference = 'Stop'; $env:CODEX_NON_INTERACTIVE = '1'; Invoke-RestMethod 'https://chatgpt.com/codex/install.ps1' | Invoke-Expression`;";
  const after = `// Carb: download the complete official CLI installer before executing it.
        const script = [
            "$ErrorActionPreference = 'Stop'",
            "$env:CODEX_NON_INTERACTIVE = '1'",
            "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
            "try {",
            "Write-Host 'Installing Codex CLI...'",
            "$installer = Invoke-RestMethod -Uri 'https://chatgpt.com/codex/install.ps1' -TimeoutSec 120",
            "if ($installer -isnot [string] -or [string]::IsNullOrWhiteSpace($installer)) { throw 'The official installer download was empty or invalid.' }",
            "& ([ScriptBlock]::Create($installer))",
            "Write-Host 'Codex CLI installer finished. Checking installation status...'",
            "exit 0",
            "} catch {",
            "Write-Host ('Codex CLI installation failed: ' + $_.Exception.Message) -ForegroundColor Red",
            "exit 1",
            "}",
        ].join('; ');`;
  if (source.includes('// Carb: download the complete official CLI installer before executing it.')) {
    assert(source.includes(after), 'Incomplete Codex installer patch');
    return source;
  }
  return once(source, before, after);
}

export function patchCliInstall(name, source) {
  if (name === terminalPath) return patchTerminal(source);
  if (name === codexPath) return patchCodexInstaller(source);
  return source;
}

export function patchInstallTerminal(source) {
  const before = 'x=()=>{_.fit();let t=n(e.installKey);';
  const after = 'x=()=>{if(a.clientWidth<160||a.clientHeight<40)return;_.fit();h.resize(Math.max(40,h.cols),Math.max(10,h.rows));let t=n(e.installKey);';
  if (source.includes(after)) return source;
  return once(source, before, after);
}
