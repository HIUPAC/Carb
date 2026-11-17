import { replaceOnce } from './prepare-brand.mjs';

export const documentWorkflowPaths = [
  'node_modules/@harness/server/dist/document-workflow.js',
  'node_modules/@harness/server/dist/api-runtime.js',
];

export function patchDocumentWorkflow(name, source) {
  if (!documentWorkflowPaths.includes(name)) return source;
  if (source.includes("from './carb-document-evidence.js'")) return source;
  if (name.endsWith('/document-workflow.js')) {
    source = "import { documentTaskPrompt } from './carb-document-evidence.js';\n" + source;
    source = replaceOnce(source,
      "      instructions: z.string().trim().min(1).max(8000),",
      "      instructions: z.string().trim().min(1).max(8000),\n      role: z.string().trim().max(240).optional(),\n      acceptanceCriteria: z.string().trim().max(3000).optional(),");
    const start = source.indexOf('    const prompt = [');
    const end = source.indexOf("    ].join('\\n');", start);
    if (start < 0 || end < 0) throw new Error('Missing document task prompt anchor');
    return source.slice(0, start) + '    const prompt = documentTaskPrompt(request);' + source.slice(end + "    ].join('\\n');".length);
  }
  source = "import { documentDigest, verifyDocumentReadback } from './carb-document-evidence.js';\n" + source;
  source = replaceOnce(source,
    '      if (document) document.path = await resolveWorkspacePath(this.workspacePath, document.filename, { allowMissing: true });',
    '      if (document) { document.startedAt = Date.now(); document.toolCalls = 0; document.path = await resolveWorkspacePath(this.workspacePath, document.filename, { allowMissing: true }); }');
  source = replaceOnce(source,
    "  async #executeTool(turnId, call, signal, document) {",
    "  async #executeTool(turnId, call, signal, document) {\n    if (document) document.toolCalls += 1;");
  source = replaceOnce(source,
    '          document.written = true;',
    '          document.expectedDigest = documentDigest(args.content);\n          document.written = true;');
  return replaceOnce(source,
    "        if (!(await readTextFile(output, controller.signal)).trim()) throw new Error('The workflow output is empty.');",
    "        const readback = await readTextFile(output, controller.signal);\n        const receipt = verifyDocumentReadback(readback, document, /[\\u3400-\\u9fff]/u.test(userText));\n        this.#emitAssistantText(turnId, receipt);\n        this.messages.push({ role: 'assistant', content: receipt });");
}
