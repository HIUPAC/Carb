import assert from 'node:assert/strict';

function replace(source, before, after) {
  if (source.includes(after)) return source;
  assert(source.includes(before), 'Missing model effort patch anchor: ' + before.slice(0, 90));
  return source.replace(before, after);
}

export function patchModelConnections(source) {
  return replace(source, '      reasoningEfforts: [],', "      reasoningEfforts: ['auto', 'low', 'medium', 'high'],\n      defaultReasoningEffort: 'auto',");
}

export function patchApiEffort(source) {
  source = replace(source, 'function requestFor(connection, apiKey, model, messages, document) {', 'function requestFor(connection, apiKey, model, messages, document, effort) {');
  source = replace(source, 'body: { model, messages, tools, stream: true },', "body: { model, messages, tools, stream: true, ...(effort && effort !== 'auto' ? { reasoning_effort: effort } : {}) },");
  source = replace(source, '        input: input.input,\n        tools: responseTools(tools),', "        input: input.input,\n        ...(effort && effort !== 'auto' ? { reasoning: { effort } } : {}),\n        tools: responseTools(tools),");
  source = replace(source, '        max_tokens: 4096,\n        ...(input.system', "        max_tokens: 4096,\n        ...(effort && effort !== 'auto' ? { output_config: { effort } } : {}),\n        ...(input.system");
  source = replace(source, '    this.model = options.model || resumeState?.model || connection.defaultModel;', "    this.model = options.model || resumeState?.model || connection.defaultModel;\n    this.effort = options.effort ?? resumeState?.effort ?? 'auto';");
  source = replace(source, '      model: this.model,\n      createdAt: this.thread.createdAt,', '      model: this.model,\n      effort: this.effort,\n      createdAt: this.thread.createdAt,');
  source = replace(source, "    const turnId = `turn-${++this.turnSequence}-${randomUUID()}`;", "    if (turnOptions.effort !== undefined) {\n      if (!['auto', 'low', 'medium', 'high'].includes(turnOptions.effort)) throw new Error('Unsupported reasoning effort. Choose auto, low, medium or high.');\n      this.effort = turnOptions.effort;\n    }\n    const turnId = `turn-${++this.turnSequence}-${randomUUID()}`;");
  source = replace(source, 'requestFor(this.connection, this.apiKey, this.model, this.messages, document)', 'requestFor(this.connection, this.apiKey, this.model, this.messages, document, this.effort)');
  return source;
}

export function patchModelEffortRenderer(source) {
  return replace(source, 'defaultModel?[{id:connection.defaultModel,displayName:connection.defaultModel,isDefault:!0,reasoningEfforts:[],serviceTiers:[]}]', 'defaultModel?[{id:connection.defaultModel,displayName:connection.defaultModel,isDefault:!0,reasoningEfforts:[`auto`,`low`,`medium`,`high`],defaultReasoningEffort:`auto`,serviceTiers:[]}]');
}
