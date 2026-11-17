import assert from 'node:assert/strict';
import { replaceOnce } from './prepare-brand.mjs';
import { patchWindowsCommand } from './patch-windows-command.mjs';

const loopMarker = 'for (;;) { // Carb: continue until completion or cancellation';
const completedEvent = "      this.emit('event', { type: 'turn.completed', turnId, status: finalStatus, completedAt: now() });";
const completedEventWithStats = "      this.emit('event', { type: 'turn.completed', turnId, status: finalStatus, completedAt: now(), toolStats: { failedToolCalls } });";
const failureCounter = '              if (execution.failed) failedToolCalls += 1;';
const legacyFailureLimit = `              if (execution.failed && ++failedToolCalls > 10) {
                toolError = new Error('Task stopped because more than 10 tool calls failed.');
              }`;

// Each turn runs until the model finishes, the user interrupts it, or a real
// error occurs. There is no artificial limit on tool calls or model rounds.
export function patchToolRounds(source) {
  source = patchWindowsCommand(source);
  if (source.includes(loopMarker)) {
    // Releases 0.5.14–0.5.16 already removed round limits, but still stopped on
    // the eleventh failed tool. Upgrade those files without baseline anchors.
    if (source.includes(legacyFailureLimit)) source = replaceOnce(source, legacyFailureLimit, failureCounter);
    assert(source.includes('    let failedToolCalls = 0;\n') && source.includes(failureCounter),
      'Unsupported tool-loop patch: expected per-turn failure statistics');
    assert(!source.includes('MAX_TOOL_ROUNDS') && !source.includes('MAX_TOOL_CALLS') &&
      !source.includes('Task stopped because more than 10 tool calls failed.'),
      'Unsupported tool-loop patch: a legacy hard stop remains');
    return source.includes(completedEventWithStats) ? source : replaceOnce(source, completedEvent, completedEventWithStats);
  }
  source = replaceOnce(source, 'const MAX_TOOL_ROUNDS = 8;\n', '');
  source = replaceOnce(source, 'const MAX_TOOL_CALLS = 24;\n', '');
  source = replaceOnce(source, '    let toolCount = 0;\n', '    let failedToolCalls = 0;\n');
  source = replaceOnce(source, 'for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {', loopMarker);
  source = replaceOnce(source, "              if (++toolCount > MAX_TOOL_CALLS) throw new Error('The model exceeded the tool-call limit for one response.');\n", '');
  source = replaceOnce(source, '              result = await this.#executeTool(turnId, call, controller.signal, document);', `              const execution = await this.#executeTool(turnId, call, controller.signal, document);
              result = execution.result;
              if (execution.failed) failedToolCalls += 1;`);
  source = replaceOnce(source, '        if (round === MAX_TOOL_ROUNDS - 1) throw new Error(\'The model exceeded the tool-call round limit.\');\n', '');
  source = replaceOnce(source, '        result = await this.#runCommand(turnId, args.command, signal);', `        const commandResult = await this.#runCommand(turnId, args.command, signal);
        result = commandResult.result;
        failed = commandResult.failed;`);
  source = replaceOnce(source, '    return result.slice(0, MAX_TOOL_OUTPUT);', '    return { result: result.slice(0, MAX_TOOL_OUTPUT), failed };');
  source = replaceOnce(source, completedEvent, completedEventWithStats);
  return replaceOnce(source, '    return `Exit code: ${exitCode}\\n${output}`;', '    return { result: `Exit code: ${exitCode}\\n${output}`, failed: exitCode !== 0 };');
}
