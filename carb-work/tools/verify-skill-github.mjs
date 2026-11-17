import assert from 'node:assert/strict';
// Compatibility command for earlier release checks: remote installation was
// removed, so this test must never contact GitHub.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveSkillSource } from '../overlay/asar/node_modules/@harness/server/dist/carb-skill-source.js';

const realFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('Remote skill installation must not contact the network.'); };
try {
  const inputs = [
    'https://github.com/vercel-labs/skills/tree/b716f9dc2ba36b6aa8f0080615e5a3a6caeac63b/skills/find-skills',
    'https://github.com/user/repo',
    'http://github.com/user/repo/tree/main/skill',
    'https://codeload.github.com/user/repo/zip/main',
    'https://example.com/skill.zip',
    'https://skills.volces.com/v1/skills/download/find-skills',
    'find-skills',
    'user/skill',
  ];
  for (const input of inputs) await assert.rejects(() => resolveSkillSource(input), /本地/);
  const implementation = await readFile(path.resolve(import.meta.dirname, '../overlay/asar/node_modules/@harness/server/dist/carb-skill-source.js'), 'utf8');
  assert(!/\b(?:fetch|resolveGithub|resolveCatalogueSkill|parseSkillSource)\s*\(/u.test(implementation));
  assert.equal(networkCalls, 0);
  const result = { passed: true, remoteInstallation: 'removed', assertions: inputs.length + 2, rejectedInputs: inputs, networkCalls, checked: 'GitHub repository, branch and immutable-commit URLs, direct archive URLs and catalogue names are rejected before resolution. No network request was attempted.', checkedAt: new Date().toISOString() };
  await writeFile(path.resolve(import.meta.dirname, '../verification/skill-install-remote-disabled.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { globalThis.fetch = realFetch; }
