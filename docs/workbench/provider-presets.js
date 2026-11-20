import { hostedDeepSeekBaseUrl } from './hosted-deepseek.js?v=20261120-hosted';

export const HOSTED_DEEPSEEK_ID = 'deepseek-hosted';
const hostedDeepSeek = {
  id: HOSTED_DEEPSEEK_ID,
  name: 'DeepSeek（内置）',
  protocol: 'chat',
  baseUrl: hostedDeepSeekBaseUrl,
  model: 'deepseek-flash',
  hosted: true,
};

export const PROVIDERS = [
  ...(hostedDeepSeekBaseUrl && globalThis.location?.origin === 'https://houpac.top' ? [hostedDeepSeek] : []),
  {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'responses',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-6.2-sol',
    keyUrl: 'https://platform.openai.com/api-keys',
    source: 'https://developers.openai.com/api/docs/models'
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5-5',
    keyUrl: 'https://platform.claude.com/settings/keys',
    source: 'https://platform.claude.com/docs/en/models/overview'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'chat',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    source: 'https://api-docs.deepseek.com/api/create-chat-completion/'
  },
  {
    id: 'qwen',
    name: '通义千问（阿里云百炼）',
    protocol: 'chat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    keyUrl: 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key',
    source: 'https://help.aliyun.com/en/model-studio/compatibility-of-openai-with-dashscope',
    note: '此预设使用北京地域接口，请填写对应地域的 API 密钥。'
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    protocol: 'chat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.7',
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    source: 'https://docs.bigmodel.cn/cn/guide/models/text/glm-4.7',
    available: false,
    note: '当前官方接口未允许此网页跨域访问。需要服务方开放 CORS，或在高级设置中填写你自己的兼容服务地址。'
  },
  {
    id: 'google',
    name: 'Google Gemini',
    protocol: 'chat',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-4-hydrogen',
    keyUrl: 'https://aistudio.google.com/apikey',
    source: 'https://aistudio.google.com/docs/openai'
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    protocol: 'chat',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V4-Flash',
    keyUrl: 'https://cloud.siliconflow.cn',
    source: 'https://docs.siliconflow.cn/docs/api/chat-completions-post'
  },
  {
    id: 'kimi',
    name: 'Kimi / 月之暗面（国际）',
    protocol: 'chat',
    baseUrl: 'https://api.moonshot.ai/v1',
    model: 'kimi-k3.1-pro',
    keyUrl: 'https://platform.kimi.ai/console/api-keys',
    source: 'https://platform.kimi.ai/docs/get-your-api-key',
    note: '此预设使用国际平台接口，请填写对应平台的 API 密钥。'
  }
];

const routes = { chat: '/chat/completions', responses: '/responses', anthropic: '/messages' };

export function getProvider(id) {
  return PROVIDERS.find(provider => provider.id === id) || null;
}

function normalizedEndpoint(baseUrl, protocol) {
  try {
    const url = new URL(baseUrl);
    if (url.username || url.password || url.hash) return null;
    const path = url.pathname.replace(/\/+$/, '');
    const route = routes[protocol];
    if (!route) return null;
    url.pathname = path.endsWith(route) ? path.slice(0, -route.length) || '/' : path || '/';
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function inferProvider(settings = {}) {
  if (settings.providerId === 'custom') return null;
  const protocol = settings.protocol;
  const endpoint = normalizedEndpoint(settings.baseUrl, protocol);
  if (!endpoint) return null;
  const candidates = settings.providerId ? [getProvider(settings.providerId)].filter(Boolean) : PROVIDERS;
  return candidates.find(provider => provider.available !== false && provider.protocol === protocol &&
    normalizedEndpoint(provider.baseUrl, protocol) === endpoint) || null;
}
