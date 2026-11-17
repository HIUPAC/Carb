import assert from 'node:assert/strict';

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, `Expected one Codex account patch anchor: ${before}`);
  return source.replace(before, () => after);
}

/**
 * Keep Carb's account indicator aligned with the public CLI login status when
 * a custom model provider makes app-server account/read return null.
 */
export function patchCodexAccountStatus(source) {
  let patched = replaceOnce(
    source,
    "import { JsonRpcError, spawnCli, StdioJsonRpc, } from '@harness/proc';",
    "import { JsonRpcError, spawnCli, StdioJsonRpc, } from '@harness/proc';\nimport { runCli } from '@harness/proc/cli';\nimport { codexLoginStatus } from './auth.js';",
  );
  patched = replaceOnce(
    patched,
    `        const { account } = await this.#callParsed('account/read', {}, AccountResponseSchema);\n        if (!account)\n            return { signedIn: false };`,
    `        const { account } = await this.#callParsed('account/read', {}, AccountResponseSchema);\n        if (!account) {\n            const status = await codexLoginStatus((command, args, _timeoutMs, options) => runCli(command, args, 15_000, options), { accountHome: this.#home });\n            if (status === 'authenticated')\n                return { signedIn: true };\n            if (status === 'unauthenticated')\n                return { signedIn: false };\n            throw new Error('Unable to confirm Codex login status. Try again.');\n        }`,
  );
  return patched;
}
