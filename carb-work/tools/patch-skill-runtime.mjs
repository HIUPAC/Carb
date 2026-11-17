import { replaceOnce } from './prepare-brand.mjs';

export function patchSkillRuntime(source) {
  if (!source.includes('class OpenAiCompatibleSession')) return source;
  if (source.includes("from './carb-skill-runtime.js'")) return source;
  source = "import { createSkillRuntime, skillToolDefinitions, skillRuntimeInstructions } from './carb-skill-runtime.js';\nimport { globalSkillsRoot } from './carb-global-skills.js';\n" + source;
  source = replaceOnce(source, 'const TOOL_DEFINITIONS = [', 'const TOOL_DEFINITIONS = [\n  ...skillToolDefinitions,');
  source = replaceOnce(source, '    this.workspacePath = workspacePath;', '    this.workspacePath = workspacePath;\n    this.skillRuntime = createSkillRuntime(workspacePath, { globalSkillsRoot: globalSkillsRoot() });');
  source = replaceOnce(source, '    this.messages = restoreMessages(resumeState?.messages, defaultInstructions);', `    this.messages = restoreMessages(resumeState?.messages, defaultInstructions);
    const skillSystem = this.messages.find(message => message.role === 'system');
    if (skillSystem && !String(skillSystem.content).includes(skillRuntimeInstructions)) skillSystem.content += '\\n\\n' + skillRuntimeInstructions;`);
  // This anchor remains present after artifact_inspect is inserted as an earlier
  // branch, so the transform composes with artifact and approval integrations.
  const anchor = "if (call.function.name === 'request_user_input') {";
  source = replaceOnce(source, anchor, `if (call.function.name === 'skill_list') {
        result = JSON.stringify(await this.skillRuntime.list(args, signal));
      } else if (call.function.name === 'skill_read') {
        result = JSON.stringify(await this.skillRuntime.read(args, signal));
      } else ${anchor}`);
  return source;
}
