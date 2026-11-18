import { getProvider, inferProvider } from './provider-presets.js?v=20261118-provider';

const protocols = {
  chat: { baseUrl: 'https://api.openai.com/v1', route: '/chat/completions' },
  responses: { baseUrl: 'https://api.openai.com/v1', route: '/responses' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', route: '/messages' },
};

export function validateSettings(settings = {}) {
  const preset = getProvider(settings.providerId);
  if (settings.providerId && settings.providerId !== 'custom' && !preset) throw new Error('请选择可用的 AI 厂商，或使用自定义服务。');
  const protocol = settings.protocol || preset?.protocol || 'chat';
  const config = Object.hasOwn(protocols, protocol) ? protocols[protocol] : null;
  if (!config) throw new Error('请选择受支持的 API 协议。');

  const model = (settings.model || preset?.model || '').trim();
  const key = (settings.key || '').trim();
  if (!model) throw new Error('请输入服务商提供的模型名称。');

  let endpoint;
  try {
    endpoint = new URL((settings.baseUrl || '').trim() || preset?.baseUrl || config.baseUrl);
  } catch {
    throw new Error('请输入完整的 API 地址，例如 https://api.openai.com/v1。');
  }

  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && isLoopback)) {
    throw new Error('API 地址须使用 HTTPS。本机服务可使用 HTTP。');
  }
  if (endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('请将 API 密钥填写在密钥输入框中，API 地址无需账号、密码或片段。');
  }
  if ([...endpoint.searchParams].some(([name, value]) => name !== 'api-version' || !/^\d{4}-\d{2}-\d{2}(?:-preview)?$/.test(value))) {
    throw new Error('API 地址只接受日期格式的 api-version 参数。请在密钥输入框中填写访问凭据。');
  }

  const path = endpoint.pathname.replace(/\/+$/, '');
  const otherRoute = Object.values(protocols).some(({ route }) => path.endsWith(route));
  if (otherRoute && !path.endsWith(config.route)) {
    throw new Error('API 地址中的接口路径与所选协议不一致。');
  }

  const baseUrl = endpoint.href;
  const recognized = inferProvider({ providerId: settings.providerId, protocol, baseUrl });
  if (preset?.available === false) throw new Error(preset.note || '当前厂商暂不能从网页直连。');
  if (preset && recognized?.id !== preset.id) {
    throw new Error('接口地址或协议已改变，请选择自定义服务并重新填写对应密钥。');
  }
  if (!key && (preset || recognized || ['api.openai.com', 'api.anthropic.com'].includes(endpoint.hostname))) {
    throw new Error('请输入模型服务的 API 密钥。');
  }

  const defaultPath = new URL(config.baseUrl).hostname === endpoint.hostname ? '/v1' : '';
  endpoint.pathname = path.endsWith(config.route) ? path : `${path || defaultPath}${config.route}`;
  const providerId = settings.providerId || recognized?.id || 'custom';
  return { providerId, protocol, baseUrl, key, model, endpoint: endpoint.href };
}

function chatRequest(config, messages, tools) {
  return {
    model: config.model,
    messages: messages.map(message => {
      if (message.role === 'tool') {
        return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
      }
      if (message.role === 'assistant' && message.toolCalls?.length) {
        const previousItems = matchingProviderItems(message, config);
        const previousAssistant = previousItems?.[0]?.tool_calls ? previousItems[0] : null;
        const previousCalls = previousAssistant?.tool_calls || previousItems;
        return {
          role: 'assistant',
          content: message.content || null,
          ...(typeof previousAssistant?.reasoning_content === 'string' ? { reasoning_content: previousAssistant.reasoning_content } : {}),
          tool_calls: message.toolCalls.map(call => {
            const original = previousCalls?.find(item => item.id === call.id && item.function?.name === call.name &&
              item.function?.arguments === call.arguments);
            return original || {
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: call.arguments },
            };
          }),
        };
      }
      return { role: message.role, content: message.content };
    }),
    ...(tools.length ? { tools: tools.map(tool => ({ type: 'function', function: tool })) } : {}),
    ...chatOptions(config),
  };
}

function chatOptions(config) {
  const preset = inferProvider(config);
  if (preset?.id === 'deepseek' || preset?.id === 'zhipu') return { thinking: { type: 'disabled' } };
  if (preset?.id === 'qwen' || preset?.id === 'siliconflow') return { enable_thinking: false };
  if (preset?.id === 'kimi') return { reasoning_effort: 'low' };
  return {};
}

function matchingProviderItems(message, config) {
  const state = message.providerState;
  if (state?.protocol === config.protocol && state.endpoint === config.endpoint && state.model === config.model) {
    return state.items;
  }
}

function responsesRequest(config, messages, tools) {
  const input = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
      continue;
    }
    const previousItems = matchingProviderItems(message, config);
    if (message.role === 'assistant' && previousItems?.length) {
      input.push(...previousItems);
      continue;
    }
    if (message.content) input.push({ role: message.role, content: message.content });
    for (const call of message.toolCalls || []) {
      input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments });
    }
  }

  return {
    model: config.model,
    input,
    store: false,
    include: ['reasoning.encrypted_content'],
    ...(tools.length ? { tools: tools.map(tool => ({ type: 'function', ...tool, strict: false })) } : {}),
  };
}

function toolInput(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Other providers can return malformed arguments. Rebuild a valid tool block when changing protocols.
  }
  return {};
}

function anthropicRequest(config, messages, tools) {
  const history = [];
  const system = [];
  for (const message of messages) {
    if (message.role === 'system') {
      system.push(message.content);
    } else if (message.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content };
      const previous = history.at(-1);
      if (previous?.role === 'user' && previous.content.every(item => item.type === 'tool_result')) {
        previous.content.push(block);
      } else {
        history.push({ role: 'user', content: [block] });
      }
    } else {
      const previousItems = matchingProviderItems(message, config);
      const content = previousItems || [
        ...(message.content ? [{ type: 'text', text: message.content }] : []),
        ...(message.toolCalls || []).map(call => ({
          type: 'tool_use', id: call.id, name: call.name, input: toolInput(call.arguments),
        })),
      ];
      if (content.length) history.push({ role: message.role, content });
    }
  }

  return {
    model: config.model,
    max_tokens: 8192,
    messages: history,
    ...(system.length ? { system: system.join('\n\n') } : {}),
    ...(tools.length ? { tools: tools.map(({ name, description, parameters }) => ({
      name, description, input_schema: parameters,
    })) } : {}),
  };
}

function toolCall(id, name, args) {
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name) {
    throw new Error('模型返回了无法识别的工具调用。');
  }
  return { id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) };
}

function chatResult(data) {
  const message = data.choices?.[0]?.message;
  return {
    content: message?.content || message?.refusal || '',
    toolCalls: (message?.tool_calls || []).map(call => toolCall(call.id, call.function?.name, call.function?.arguments)),
    items: message?.tool_calls?.length ? [{
      tool_calls: message.tool_calls,
      ...(typeof message.reasoning_content === 'string' ? { reasoning_content: message.reasoning_content } : {}),
    }] : undefined,
  };
}

function responsesResult(data) {
  const items = [];
  const parts = [];
  const toolCalls = [];
  for (const item of data.output || []) {
    if (item.type === 'function_call' && item.status !== 'incomplete') {
      toolCalls.push(toolCall(item.call_id, item.name, item.arguments));
      items.push(item);
    } else if (item.type === 'message') {
      for (const block of item.content || []) {
        if (block.type === 'output_text') parts.push(block.text);
        if (block.type === 'refusal') parts.push(block.refusal);
      }
      items.push(item);
    } else if (item.type === 'reasoning' && item.encrypted_content) {
      items.push(item);
    }
  }
  return { content: parts.join('\n') || data.output_text || '', toolCalls, items };
}

function anthropicResult(data) {
  const blocks = data.content || [];
  const toolCalls = data.stop_reason === 'max_tokens'
    ? []
    : blocks.filter(block => block.type === 'tool_use').map(block => toolCall(block.id, block.name, block.input));
  return {
    content: blocks.filter(block => block.type === 'text').map(block => block.text).join('\n'),
    toolCalls,
    items: data.stop_reason === 'max_tokens' ? undefined : blocks,
  };
}

const adapters = {
  chat: { request: chatRequest, result: chatResult },
  responses: { request: responsesRequest, result: responsesResult },
  anthropic: { request: anthropicRequest, result: anthropicResult },
};

export async function requestModel(settings, messages, tools = [], signal) {
  const config = validateSettings(settings);
  const adapter = adapters[config.protocol];
  const body = adapter.request(config, messages, tools);
  const headers = { 'Content-Type': 'application/json' };
  if (config.protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (new URL(config.endpoint).hostname === 'api.anthropic.com') {
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
    if (config.key) headers['x-api-key'] = config.key;
  } else if (config.key) {
    headers.Authorization = `Bearer ${config.key}`;
  }

  let response;
  try {
    response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal,
    });
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error;
    throw new Error('无法从网页连接模型服务。请检查 API 地址和网络，并确认服务允许当前网页跨域访问（CORS）。');
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error;
  }
  if (!response.ok || data?.error) {
    const description = typeof data?.error === 'string' ? data.error : data?.error?.message;
    const safeDescription = typeof description === 'string'
      ? (config.key ? description.replaceAll(config.key, '•••') : description).slice(0, 320)
      : '';
    throw new Error(`模型服务返回 HTTP ${response.status}${safeDescription ? `：${safeDescription}` : '。'}`);
  }
  if (!data || typeof data !== 'object') throw new Error('模型服务返回了无法识别的内容。请检查 API 地址和协议。');

  const { content, toolCalls, items } = adapter.result(data);
  if (typeof content !== 'string' || (!content && !toolCalls.length)) {
    throw new Error('模型没有返回可显示的内容。请确认模型与所选协议及工具调用兼容。');
  }

  return {
    content,
    toolCalls,
    ...(items?.length ? { providerState: {
      protocol: config.protocol, endpoint: config.endpoint, model: config.model, items,
    } } : {}),
  };
}
