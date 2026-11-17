import { replaceOnce } from './prepare-brand.mjs';

// The orchestrator already supplies the shared style to provider adapters.
// Apply it to direct API sessions and resumed sessions as well.
export function patchTaskCompletion(source) {
  if (!source.includes('class OpenAiCompatibleSession')) return source;
  if (source.includes("from './reply-style.js'")) return source;
  source = "import { REPLY_STYLE_INSTRUCTIONS } from './reply-style.js';\n" + source;
  return replaceOnce(source,
    '    this.messages = restoreMessages(resumeState?.messages, defaultInstructions);',
    `    this.messages = restoreMessages(resumeState?.messages, defaultInstructions);
    const completionSystem = this.messages.find(message => message.role === 'system');
    if (completionSystem && !String(completionSystem.content).includes(REPLY_STYLE_INSTRUCTIONS)) completionSystem.content += '\\n\\n' + REPLY_STYLE_INSTRUCTIONS;`,
    'direct API task completion instructions');
}
