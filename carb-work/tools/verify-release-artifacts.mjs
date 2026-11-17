import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const evidence = path.join(root, 'verification/artifacts');
const report = JSON.parse(await readFile(path.join(evidence, 'workflow-results.json'), 'utf8'));
const inspection = JSON.parse(await readFile(path.join(evidence, 'independent-inspection.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const contained = (base, filename) => {
  const relative = path.relative(base, filename);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
assert.equal(report.passed, true, 'Run the five-format acceptance test before packaging.');
assert.equal(inspection.ok, true, 'The independent artifact inspection must pass.');
assert(report.checks?.length > 0 && report.checks.every(item => item.status === 'passed'));
const runtime = report.checks.find(item => item.name === 'real-runtime-five-format-delivery');
assert(runtime?.receipt && runtime.toolCalls >= 8 && runtime.actualSkillsRead?.length, 'Real skill and tool execution evidence is required.');
const requiredSources = [
  'overlay/asar/node_modules/@harness/server/dist/carb-artifact-evidence.js',
  'overlay/asar/node_modules/@harness/server/dist/carb-skill-source.js',
  'overlay/asar/node_modules/@harness/server/dist/carb-skill-runtime.js',
  'overlay/asar/node_modules/@harness/server/dist/carb-global-skills.js',
  'overlay/asar/node_modules/@harness/server/dist/reply-style.js',
  'tools/patch-artifact-workflow.mjs', 'tools/patch-tool-rounds.mjs',
  'tools/patch-task-completion.mjs', 'tools/verify-artifact-workflow.mjs',
];
for (const filename of requiredSources) assert(report.sourceHashes?.[filename], 'Acceptance source fingerprint missing: ' + filename);
for (const [filename, sha256] of Object.entries(report.sourceHashes)) {
  const absolute = path.resolve(root, filename);
  assert(contained(root, absolute) && contained(root, await realpath(absolute)), 'Invalid acceptance source path.');
  assert.equal(hash(await readFile(absolute)), sha256, 'Acceptance is stale; rerun verify-artifact-workflow.mjs after changing ' + filename);
}
assert.equal(report.artifacts?.length, 5);
assert.deepEqual(report.artifacts.map(item => item.kind).sort(), ['docx', 'md', 'pptx', 'py', 'xlsx']);
for (const item of report.artifacts) {
  const filename = path.resolve(item.absolutePath);
  assert(contained(path.join(evidence, 'workspace'), filename) && contained(path.join(evidence, 'workspace'), await realpath(filename)), 'Artifact must remain inside the acceptance workspace.');
  const bytes = await readFile(filename);
  assert.equal(bytes.length, item.bytes);
  assert.equal(hash(bytes), item.sha256, 'Acceptance artifact changed: ' + filename);
  const independent = inspection.records.find(record => record.kind === item.kind);
  assert.equal(independent?.sha256, item.sha256);
  if (item.kind === 'py') assert.equal(independent.execution_exit_code, 0);
  else assert.equal(independent.content_verified, true);
}
console.log(JSON.stringify({ passed: true, sourceFingerprints: Object.keys(report.sourceHashes).length, generatedFormats: 5, acceptanceCases: report.cases, scope: report.source }));
