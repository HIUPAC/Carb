import { replaceOnce } from './prepare-brand.mjs';

const evidenceImport = "import { artifactOutputReceipt, artifactTaskInstructions, verifyArtifactSet } from './carb-artifact-evidence.js';\n";
const inspectTool = `
  {
    type: 'function',
    function: {
      name: 'artifact_inspect',
      description: 'Verify exactly one PPTX, DOCX, XLSX, Python and Markdown output in the active workspace. Returns byte counts, SHA-256 and required Office package entries.',
      parameters: { type: 'object', properties: { paths: { type: 'array', minItems: 5, maxItems: 5, items: { type: 'string' } } }, required: ['paths'], additionalProperties: false },
    },
  },`;

/** Adds a deterministic five-format output contract to API-backed tasks. */
export function patchArtifactWorkflow(source) {
  if (!source.includes('class OpenAiCompatibleSession')) return source;
  if (!source.includes("from './carb-artifact-evidence.js'")) source = evidenceImport + source;
  if (!source.includes('name: \'artifact_inspect\'')) source = replaceOnce(source, 'const TOOL_DEFINITIONS = [', `const TOOL_DEFINITIONS = [${inspectTool}`, 'artifact inspection tool definition');

  if (!source.includes('this.artifactOutputs =')) {
    source = replaceOnce(source,
      '    this.documentOutput = options.documentOutput === undefined ? undefined : documentFilename(options.documentOutput);',
      `    this.documentOutput = options.documentOutput === undefined ? undefined : documentFilename(options.documentOutput);
    this.artifactOutputs = Array.isArray(options.artifactOutputs) ? [...options.artifactOutputs] : undefined;`,
      'artifact output option');
    const instructionLine = source.match(/^    const defaultInstructions = (.+);$/mu);
    if (!instructionLine) throw new Error('Artifact default instructions anchor missing.');
    source = replaceOnce(source, instructionLine[0],
      '    const defaultInstructions = (' + instructionLine[1] + ') + (this.artifactOutputs ? `\\n\\n${artifactTaskInstructions(true)}` : \x27\x27);',
      'artifact task instructions');
    source = replaceOnce(source,
      '    const document = this.documentOutput === undefined ? undefined : { filename: this.documentOutput, written: false };',
      `    const document = this.documentOutput === undefined ? undefined : { filename: this.documentOutput, written: false };
    const artifact = this.artifactOutputs ? { paths: [...this.artifactOutputs], report: undefined } : undefined;`,
      'artifact turn state');
    source = replaceOnce(source, 'this.documentOutput = undefined;\n    queueMicrotask(() => void this.#runTurn(turnId, controller, document)', 'this.documentOutput = undefined;\n    this.artifactOutputs = undefined;\n    queueMicrotask(() => void this.#runTurn(turnId, controller, document, artifact)', 'artifact turn start');
    source = replaceOnce(source, '  async #runTurn(turnId, controller, document) {', '  async #runTurn(turnId, controller, document, artifact) {', 'artifact run signature');
  }

  if (!source.includes('artifact_inspect')) throw new Error('Artifact inspection tool was not inserted.');
  source = source.replaceAll('this.#executeTool(turnId, call, controller.signal, document);', 'this.#executeTool(turnId, call, controller.signal, document, artifact);');
  source = source.replace('  async #executeTool(turnId, call, signal, document) {', '  async #executeTool(turnId, call, signal, document, artifact) {');
  if (!source.includes("if (call.function.name === 'artifact_inspect')")) {
    source = replaceOnce(source,
      "      if (call.function.name === 'request_user_input') {",
      `      if (call.function.name === 'artifact_inspect') {
        if (!artifact) throw new Error('This task does not have a five-format output contract.');
        if (!Array.isArray(args.paths)) throw new Error('artifact_inspect requires five output paths.');
        const contractPaths = paths => paths.map(value => typeof value === 'string' ? value.replaceAll('\\\\', '/') : '').sort();
        if (JSON.stringify(contractPaths(args.paths)) !== JSON.stringify(contractPaths(artifact.paths))) throw new Error('artifact_inspect paths must match the output contract for this task.');
        artifact.report = await verifyArtifactSet(this.workspacePath, args.paths);
        result = JSON.stringify({ ok: true, count: artifact.report.count, records: artifact.report.records.map(item => ({ path: item.path, kind: item.kind, bytes: item.bytes, sha256: item.sha256 })) });
      } else if (call.function.name === 'request_user_input') {`,
      'artifact inspection execution');
  }
  if (!source.includes('artifactOutputReceipt(report')) {
    const runStart = source.indexOf('  async #runTurn(');
    const catchMatch = /^    \} catch \(error\) \{/gmu;
    catchMatch.lastIndex = runStart;
    const catchIndex = catchMatch.exec(source)?.index ?? -1;
    if (runStart < 0 || catchIndex < 0) throw new Error('Artifact run-turn catch anchor missing.');
    const receipt = `      if (artifact) {
        controller.signal.throwIfAborted();
        const report = await verifyArtifactSet(this.workspacePath, artifact.paths);
        controller.signal.throwIfAborted();
        const receipt = artifactOutputReceipt(report, this.workspacePath, /[\\u3400-\\u9fff]/u.test(userText));
        this.#emitAssistantText(turnId, receipt);
        this.messages.push({ role: 'assistant', content: receipt });
      }
`;
    source = source.slice(0, catchIndex) + receipt + source.slice(catchIndex);
  }
  return source;
}
