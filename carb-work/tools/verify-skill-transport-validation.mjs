import assert from 'node:assert/strict';
import { patchSkillTransportValidation } from './patch-skill-web.mjs';

const parser = 'function f(e,t){let n=a(e,t);return n===void 0?i[e].result.parse(t):n}';
const fixture = `const a=()=>void 0;const i={legacy:{result:{parse:value=>value}}};${parser}export{f as parseMethodResult};`;
const patched = patchSkillTransportValidation(fixture);
assert.equal(patchSkillTransportValidation(patched), patched, 'Transport parser patch is idempotent');
assert.match(patched, /skills\.previewInstall/);
assert.match(patched, /skills\.commitInstall/);
assert.match(patched, /skills\.discardInstall/);
const { parseMethodResult } = await import(`data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`);
const preview = {
  previewId: 'b7a99087-a443-4ca0-891d-6e81f4ae8e4e',
  sourceType: 'zip', sourceLabel: 'test.zip', destination: 'C:/skills', expiresAt: Date.now() + 1000,
  warnings: [], skills: [{ id: '2d4124d4-49e0-4fc5-9c5a-49ef3e35b38b', name: 'sample-skill', description: 'A test skill', relativePath: 'skills/sample-skill', files: 2, bytes: 123, alreadyExists: false, extra: { preserved: true } }],
  extra: { preserved: true },
};
assert.deepEqual(parseMethodResult('skills.previewInstall', preview), preview, 'Preview fields are preserved');
const receipt = { installed: [{ id: 'C:/skills/sample-skill', name: 'sample-skill', description: 'A test skill', source: { type: 'folder', path: 'C:/skills/sample-skill' }, dependencyErrors: [], extra: 'preserved' }], warnings: [], extra: 'preserved' };
assert.deepEqual(parseMethodResult('skills.commitInstall', receipt), receipt, 'Install receipt fields are preserved');
assert.deepEqual(parseMethodResult('skills.discardInstall', { extra: true }), { extra: true }, 'Discard response is preserved');
assert.deepEqual(parseMethodResult('legacy', { ok: true }), { ok: true }, 'Existing response parsing remains intact');
assert.throws(() => parseMethodResult('skills.previewInstall', { ...preview, skills: [{ ...preview.skills[0], files: -1 }] }), /Invalid skills\.previewInstall/);
assert.throws(() => parseMethodResult('skills.commitInstall', { installed: 'bad', warnings: [] }), /Invalid skills\.commitInstall/);
console.log('Skill transport validation passed (10 assertions).');
