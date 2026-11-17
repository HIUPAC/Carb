import { replaceOnce } from './prepare-brand.mjs';

// The upstream agent registry drives the setup cards and the ACP runtime.
// Keep this integration unverified until a real local handshake is exercised.
export function patchDeepSeekAgent(source) {
  return replaceOnce(source, "    {\n        id: 'workbuddy',", `    {
        id: 'deepseek-harness',
        name: 'DeepSeek Harness',
        maker: 'DeepSeek',
        command: 'dsh',
        args: ['--profile', 'acp'],
        verified: false,
        sessionModels: true,
        problem: 'DeepSeek Harness requires Node.js 24.9 or later and a configured DeepSeek API key.',
        setup: cliSetup('https://github.com/deepseek-ai/deepseek-harness', 'npm install -g @deepseek-ai/dsh'),
    },
    {
        id: 'workbuddy',`);
}
