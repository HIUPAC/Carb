/* API connection settings overlay. Loaded before the main renderer bundle so it
   can observe the app's existing local RPC socket without opening another one. */
(() => {
  'use strict';

  const NativeWebSocket = window.WebSocket;
  const socketSet = new Set();
  const pending = new Map();
  let requestCounter = 0;

  const localRpcEndpoint = (() => {
    const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '';
    const sources = policy.match(/(?:^|;)\s*connect-src\s+([^;]+)/i)?.[1]?.split(/\s+/) ?? [];
    return sources.map(source => {
      try {
        const url = new URL(source);
        return url.protocol === 'ws:' && url.hostname === '127.0.0.1' && !url.username && !url.password &&
          url.pathname === '/' && !url.search && !url.hash ? url : null;
      } catch {
        return null;
      }
    }).find(Boolean) ?? null;
  })();

  function isRpcSocket(socket) {
    try {
      const url = new URL(socket.url);
      return Boolean(localRpcEndpoint && url.origin === localRpcEndpoint.origin && url.pathname === '/');
    } catch {
      return false;
    }
  }

  function decodeMessage(data) {
    if (typeof data !== 'string') return null;
    try { return JSON.parse(data); } catch { return null; }
  }

  function observeSocket(socket) {
    if (!isRpcSocket(socket) || socketSet.has(socket)) return;
    socketSet.add(socket);
    socket.addEventListener('message', event => {
      const frame = decodeMessage(event.data);
      if (!frame || frame.id == null) return;
      const request = pending.get(String(frame.id));
      if (!request || request.socket !== socket) return;
      pending.delete(String(frame.id));
      clearTimeout(request.timer);
      if (Object.prototype.hasOwnProperty.call(frame, 'error') && frame.error != null) {
        const detail = typeof frame.error === 'string' ? frame.error : frame.error.message;
        request.reject(new Error(detail || 'The local server rejected the request.'));
      } else {
        request.resolve(frame.result);
      }
    });
    socket.addEventListener('close', () => {
      socketSet.delete(socket);
      for (const [id, request] of pending) {
        if (request.socket !== socket) continue;
        pending.delete(id);
        clearTimeout(request.timer);
        request.reject(new Error('The app connection closed. Reopen Settings and try again.'));
      }
    });
  }

  class ObservedWebSocket extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      observeSocket(this);
    }
  }
  window.WebSocket = ObservedWebSocket;

  function connectedSocket() {
    for (const socket of socketSet) {
      if (socket.readyState === NativeWebSocket.OPEN) return socket;
    }
    return null;
  }

  async function rpc(method, params = {}) {
    const waitUntil = Date.now() + 12000;
    let socket = connectedSocket();
    while (!socket && Date.now() < waitUntil) {
      await new Promise(resolve => setTimeout(resolve, 100));
      socket = connectedSocket();
    }
    if (!socket) throw new Error('The app’s local connection is not ready. Reopen this panel and try again.');
    const id = `api-overlay-${Date.now()}-${++requestCounter}`;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('The local server did not reply in time.'));
      }, 30000);
      pending.set(id, { resolve, reject, timer, socket });
    });
    try {
      socket.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      const request = pending.get(id);
      pending.delete(id);
      clearTimeout(request?.timer);
      throw error;
    }
    return promise;
  }

  const presets = {
    openai: { name: 'OpenAI', nameZh: 'OpenAI', transport: 'openai-responses', baseUrl: 'https://api.openai.com/v1' },
    anthropic: { name: 'Anthropic', nameZh: 'Anthropic', transport: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1' },
    openrouter: { name: 'OpenRouter', nameZh: 'OpenRouter', transport: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' },
    kimi: { name: 'Kimi / Moonshot', nameZh: 'Kimi（月之暗面）', transport: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1' },
    zai: { name: 'Z.ai / Zhipu AI', nameZh: 'Z.ai / 智谱 AI', transport: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
    deepseek: { name: 'DeepSeek', nameZh: 'DeepSeek（深度求索）', transport: 'openai-compatible', baseUrl: 'https://api.deepseek.com' },
    qwen: { name: 'Qwen / DashScope', nameZh: '通义千问 / DashScope', transport: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    volcengine: { name: 'Volcengine Ark', nameZh: '火山引擎 Ark / 豆包', transport: 'openai-compatible', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
    minimax: { name: 'MiniMax', nameZh: 'MiniMax', transport: 'openai-compatible', baseUrl: 'https://api.minimax.cn/v1' },
    baidu: { name: 'Baidu Qianfan', nameZh: '百度千帆', transport: 'openai-compatible', baseUrl: 'https://qianfan.baidubce.com/v2' },
    tencent: { name: 'Tencent TokenHub', nameZh: '腾讯 TokenHub / 混元', transport: 'openai-compatible', baseUrl: 'https://tokenhub.tencentmaas.com/v1' },
    siliconflow: { name: 'SiliconFlow', nameZh: '硅基流动 SiliconFlow', transport: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn/v1' },
    custom: { name: 'Custom provider', nameZh: '自定义服务商', transport: 'openai-compatible', baseUrl: '' }
  };
  const aliases = { moonshot: 'kimi', zhipu: 'zai' };

  const messages = {
    'API connections': 'API 连接', 'Connect a provider': '连接服务商',
    'Manage providers, API keys and live model lists.': '管理服务商、API 密钥和实时模型列表。',
    'Add provider': '添加服务商', 'No API providers yet': '尚未添加 API 服务商',
    'Add a provider to load its models and start a chat.': '添加服务商以加载模型并开始对话。',
    'Display name': '显示名称', 'Provider': '服务商', 'Base URL': '基础地址',
    'API key': 'API 密钥', 'Leave blank to keep the saved key.': '留空以保留已保存的密钥。',
    'Default model': '默认模型', 'Choose a default model': '选择默认模型',
    'Refresh models': '刷新模型', 'Save connection': '保存连接', 'Save changes': '保存更改',
    'Remove provider': '删除服务商', 'Enabled': '已启用', 'Key saved': '密钥已保存',
    'No key saved': '未保存密钥', 'Models not loaded': '尚未加载模型',
    'No models returned.': '服务商未返回可用模型。', 'Save an API key to load models.': '保存 API 密钥后可加载模型。',
    'Enable this connection to load models.': '启用连接后可加载模型。',
    'API protocol': 'API 协议', 'OpenAI Chat Completions': 'OpenAI Chat Completions',
    'OpenAI Responses': 'OpenAI Responses', 'Anthropic Messages': 'Anthropic Messages',
    'Model ID': '模型 ID', 'Use this model': '保存模型',
    'Enter a model ID manually if your provider does not list it.': '如果服务商未列出模型，可手动填写模型 ID。',
    'No default model': '未设置默认模型',
    'Fetch models': '获取模型', 'Fetching models…': '正在获取模型…',
    'Available models': '可用模型', 'Choose a model (optional)': '选择默认模型（可选）',
    'Enter an API key to fetch models.': '填写 API 密钥后即可获取模型列表。',
    'The list is ready. Choose a default or select a model later in the main window.': '模型已加载。可以设为默认，也可返回主界面后再选。',
    'Advanced options': '高级选项', 'Models endpoint': '模型列表地址',
    'Optional. Use a models URL on the same server as the base URL.': '可选。模型列表地址必须与基础地址使用同一服务器。',
    'The models endpoint must use the same origin as the base URL.': '模型列表地址必须与基础地址使用同一协议、主机和端口。',
    'The provider request timed out. Try again.': '服务商请求超时，请重试。',
    'Open chat': '打开对话',
    'Changing the server address requires saving a new key.': '更换服务器地址后需要保存新的密钥。',
    'Could not reach the model provider.': '无法连接到模型服务商。',
    'The provider does not expose a model list. Enter a model ID to continue.': '此服务商未提供模型列表接口，可以手动填写模型 ID。',
    'The provider returned an invalid model list.': '服务商返回的模型列表无法读取。',
    'The provider rejected this API key. Check the key and its access.': '服务商拒绝了此 API 密钥，请检查密钥和权限。',
    'No projects available': '暂无项目',
    'Start a chat': '新建对话', 'Project': '项目', 'Choose a project': '选择项目',
    'Create chat': '创建对话', 'Back': '返回', 'Close': '关闭', 'Edit': '编辑',
    'Loading…': '正在加载…', 'Saving…': '正在保存…', 'Refreshing…': '正在刷新…',
    'Chat created. Open it from the project sidebar.': '对话已创建，请在项目侧栏中打开。',
    'Connection saved.': '连接已保存。', 'Models refreshed.': '模型列表已刷新。',
    'Delete this provider and its saved credential?': '确定删除此服务商及其已保存的密钥吗？',
    'Choose a project before creating a chat.': '请先选择项目再创建对话。',
    'Name and base URL are required.': '请填写名称和基础地址。',
    'Use HTTPS, or HTTP on 127.0.0.1.': '请使用 HTTPS，或 127.0.0.1 上的 HTTP。',
    'Credentials must not be embedded in the model connection URL.': '请勿在模型服务地址中填写用户名或密码。',
    'Base URL must not contain a query or fragment.': '基础地址不能包含查询参数或片段。',
    'Starting…': '正在创建…', 'Provider default': '服务商默认模型',
    'Ready to connect': '可连接', 'Enabled': '已启用', 'Disabled': '已停用',
    'Could not load connections.': '无法加载连接。',
    'Custom (third party)': '第三方自定义服务商',
    'Select a provider or add a new one to configure it.': '选择现有服务商，或添加新的服务商并完成配置。',
    'Refresh the provider’s live model list to choose a default.': '刷新服务商的实时模型列表并选择默认模型。'
  };

  function translate(text) {
    return currentLanguage() === 'zh-CN' ? (messages[text] || text) : text;
  }

  function currentLanguage() {
    try { return localStorage.getItem('test.uiLanguage') || document.documentElement.lang || 'zh-CN'; } catch { return 'zh-CN'; }
  }

  function providerName(preset) {
    const item = presets[aliases[preset] || preset];
    if (!item) return preset;
    return currentLanguage() === 'zh-CN' ? (item.nameZh || item.name) : item.name;
  }

  const state = {
    overlay: null,
    connections: [],
    projects: [],
    selectedId: null,
    form: null,
    preview: { request: 0, status: 'idle', models: [], error: '' },
    models: [],
    modelRequest: 0,
    modelStatus: 'idle',
    modelError: '',
    projectPath: '',
    busy: false,
    notice: '',
    error: '',
    newThreadId: null,
    previousNavItem: null
  };

  const text = (tag, value, className) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value;
    return element;
  };

  function slug(value) {
    return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'provider';
  }

  function newConnection() {
    state.selectedId = null;
    resetModels();
    resetPreview();
    state.form = {
      id: '', displayName: providerName('openai'), preset: 'openai', transport: presets.openai.transport,
      baseUrl: presets.openai.baseUrl, modelListUrl: '', defaultModel: '', enabled: true, apiKey: '', isNew: true
    };
    state.notice = '';
    state.error = '';
    render();
  }

  function editConnection(connection) {
    state.selectedId = connection.id;
    resetModels();
    resetPreview();
    state.form = {
      id: connection.id, displayName: connection.displayName, preset: connection.preset,
      transport: connection.transport, baseUrl: connection.baseUrl, modelListUrl: connection.modelListUrl || '',
      defaultModel: connection.defaultModel || '', enabled: connection.enabled,
      apiKey: '', isNew: false
    };
    state.notice = '';
    state.error = '';
    render();
  }

  function selectedConnection() {
    return state.connections.find(item => item.id === state.selectedId) || null;
  }

  function resetModels() {
    state.modelRequest++;
    state.models = [];
    state.modelStatus = 'idle';
    state.modelError = '';
  }

  function resetPreview() {
    state.preview = { request: state.preview.request + 1, status: 'idle', models: [], error: '' };
  }

  function selectConnection(connection) {
    resetModels();
    resetPreview();
    state.selectedId = connection?.id ?? null;
    state.form = null;
    state.notice = '';
    state.error = '';
    render();
    if (connection?.enabled && connection.credentialConfigured) void refreshModels(connection);
  }

  function announceCatalog() {
    window.dispatchEvent(new Event('test-api-catalog-changed'));
  }

  function updateField(name, value) {
    if (!state.form) return;
    if (state.form[name] === value) return;
    state.form[name] = value;
    if (['baseUrl', 'modelListUrl', 'apiKey', 'transport'].includes(name)) {
      resetPreview();
      const preview = state.overlay?.querySelector('.ta-api-preview');
      if (preview) renderPreview(preview);
    }
  }

  function addLabeledField(form, labelText, input, hint) {
    const wrapper = text('label', '', 'ta-api-field');
    wrapper.append(text('span', translate(labelText), 'ta-api-field__label'));
    wrapper.append(input);
    if (hint) wrapper.append(text('small', translate(hint), 'ta-api-field__hint'));
    form.append(wrapper);
  }

  function input(type, value, placeholder) {
    const element = document.createElement('input');
    element.type = type;
    element.value = value || '';
    if (placeholder) element.placeholder = translate(placeholder);
    element.autocomplete = type === 'password' ? 'new-password' : 'off';
    return element;
  }

  function select(options, value) {
    const element = document.createElement('select');
    for (const option of options) {
      const item = document.createElement('option');
      item.value = option.value;
      item.textContent = option.label;
      element.append(item);
    }
    element.value = value;
    return element;
  }

  function button(label, handler, className = 'ta-api-button', disabled = false, action) {
    const element = text('button', translate(label), className);
    element.type = 'button';
    element.disabled = disabled;
    if (action) element.dataset.apiAction = action;
    if (handler) element.addEventListener('click', handler);
    return element;
  }

  function render() {
    if (!state.overlay) return;
    const shell = state.overlay.querySelector('.ta-api-shell');
    for (const child of [...shell.children]) {
      if (!child.classList.contains('test-drawer-handle')) child.remove();
    }
    const header = document.createElement('header');
    header.className = 'ta-api-header';
    const titleGroup = document.createElement('div');
    const heading = text('h1', translate('API connections'));
    heading.id = 'ta-api-title';
    titleGroup.append(heading);
    titleGroup.append(text('p', translate('Manage providers, API keys and live model lists.')));
    const close = button('', closeOverlay, 'ta-api-icon-button', false);
    close.setAttribute('aria-label', translate('Close'));
    header.append(titleGroup, close);
    shell.append(header);

    if (state.notice || state.error) {
      const alert = text('div', translate(state.error || state.notice), `ta-api-alert${state.error ? ' is-error' : ' is-success'}`);
      alert.setAttribute('role', state.error ? 'alert' : 'status');
      if (state.newThreadId && !state.error && state.notice === 'Chat created. Open it from the project sidebar.') {
        alert.append(' ', button('Open chat', () => {
          const threadId = state.newThreadId;
          closeOverlay();
          window.dispatchEvent(new CustomEvent('test-open-workflow-thread', { detail: threadId }));
        }, 'ta-api-button ta-api-button--compact', false, 'open-chat'));
      }
      shell.append(alert);
    }

    const content = document.createElement('div');
    content.className = 'ta-api-content';
    const list = document.createElement('aside');
    list.className = 'ta-api-list';
    const listTitle = document.createElement('div');
    listTitle.className = 'ta-api-list__heading';
    listTitle.append(text('h2', translate('Connect a provider')));
    listTitle.append(button('Add provider', newConnection, 'ta-api-button ta-api-button--compact', state.busy, 'add'));
    list.append(listTitle);

    if (!state.connections.length) {
      const empty = text('div', '', 'ta-api-empty');
      empty.append(text('strong', translate('No API providers yet')));
      empty.append(text('p', translate('Add a provider to load its models and start a chat.')));
      list.append(empty);
    } else {
      const items = document.createElement('div');
      items.className = 'ta-api-list__items';
      for (const connection of state.connections) {
        const card = button('', () => selectConnection(connection), `ta-api-connection${state.selectedId === connection.id ? ' is-selected' : ''}`, state.busy);
        card.classList.add('ta-api-connection-button');
        card.dataset.connectionId = connection.id;
        card.replaceChildren(
          text('span', connection.displayName, 'ta-api-connection__name'),
          text('span', providerName(connection.preset), 'ta-api-connection__provider'),
          text('span', connection.enabled ? translate('Enabled') : translate('Disabled'), `ta-api-connection__state${connection.enabled ? '' : ' is-muted'}`),
          text('span', connection.credentialConfigured ? translate('Key saved') : translate('No key saved'), 'ta-api-connection__credential')
        );
        items.append(card);
      }
      list.append(items);
    }
    content.append(list);

    const details = document.createElement('section');
    details.className = 'ta-api-details';
    if (state.form) {
      renderForm(details);
    } else {
      const chosen = selectedConnection();
      if (chosen) renderConnectionDetails(details, chosen);
      else {
        const hint = text('div', '', 'ta-api-details__empty');
        hint.append(text('span', '✦', 'ta-api-details__spark'));
        hint.append(text('h2', translate('Connect a provider')));
        hint.append(text('p', translate('Select a provider or add a new one to configure it.')));
        details.append(hint);
      }
    }
    content.append(details);
    shell.append(content);
  }

  function renderForm(parent) {
    const form = document.createElement('form');
    form.className = 'ta-api-form';
    const heading = document.createElement('div');
    heading.className = 'ta-api-form__heading';
    heading.append(text('h2', translate(state.form.isNew ? 'Add provider' : 'Edit')));
    form.append(heading);

    const nameField = input('text', state.form.displayName, 'e.g. Team gateway');
    nameField.name = 'displayName';
    nameField.required = true;
    nameField.addEventListener('input', () => updateField('displayName', nameField.value));
    addLabeledField(form, 'Display name', nameField);

    const presetSelect = select(Object.entries(presets).map(([value, preset]) => ({
      value,
      label: value === 'custom' ? translate('Custom (third party)') : providerName(value)
    })), aliases[state.form.preset] || state.form.preset);
    presetSelect.name = 'preset';
    presetSelect.addEventListener('change', () => {
      const previous = state.form.preset;
      const preset = presets[presetSelect.value];
      state.form.preset = presetSelect.value;
      state.form.transport = preset.transport;
      state.form.defaultModel = '';
      state.form.modelListUrl = '';
      resetPreview();
      if (state.form.isNew || !state.form.baseUrl || Object.values(presets).some(item => item.baseUrl === state.form.baseUrl)) {
        state.form.baseUrl = preset.baseUrl;
      }
      if (!state.form.displayName || state.form.displayName === providerName(previous)) state.form.displayName = providerName(presetSelect.value);
      render();
    });
    addLabeledField(form, 'Provider', presetSelect);

    if (state.form.preset === 'custom') {
      const transport = select([
        { value: 'openai-compatible', label: translate('OpenAI Chat Completions') },
        { value: 'openai-responses', label: translate('OpenAI Responses') },
        { value: 'anthropic-messages', label: translate('Anthropic Messages') },
      ], state.form.transport);
      transport.name = 'transport';
      transport.addEventListener('change', () => updateField('transport', transport.value));
      addLabeledField(form, 'API protocol', transport);
    }

    const urlField = input('url', state.form.baseUrl, 'https://api.example.com/v1');
    urlField.name = 'baseUrl';
    urlField.required = true;
    urlField.spellcheck = false;
    urlField.addEventListener('input', () => updateField('baseUrl', urlField.value.trim()));
    addLabeledField(form, 'Base URL', urlField);

    const credential = input('password', state.form.apiKey, 'sk-…');
    credential.name = 'apiKey';
    credential.autocomplete = 'new-password';
    credential.addEventListener('input', () => updateField('apiKey', credential.value));
    addLabeledField(form, 'API key', credential, state.form.isNew ? '' : 'Changing the server address requires saving a new key.');

    const preview = text('section', '', 'ta-api-preview');
    renderPreview(preview);
    form.append(preview);

    const advanced = document.createElement('details');
    advanced.className = 'ta-api-advanced';
    advanced.open = Boolean(state.form.modelListUrl || state.form.defaultModel && !state.preview.models.some(model => model.id === state.form.defaultModel));
    advanced.append(text('summary', translate('Advanced options')));
    const modelsUrl = input('url', state.form.modelListUrl, 'https://api.example.com/v1/models');
    modelsUrl.name = 'modelListUrl';
    modelsUrl.spellcheck = false;
    modelsUrl.addEventListener('input', () => updateField('modelListUrl', modelsUrl.value.trim()));
    addLabeledField(advanced, 'Models endpoint', modelsUrl, 'Optional. Use a models URL on the same server as the base URL.');
    const manualModel = input('text', state.form.defaultModel, 'Model ID');
    manualModel.name = 'draftManualModel';
    manualModel.spellcheck = false;
    manualModel.addEventListener('input', () => {
      updateField('defaultModel', manualModel.value.trim());
      const list = preview.querySelector('[name="draftModel"]');
      if (list) list.value = Array.from(list.options).some(item => item.value === state.form.defaultModel) ? state.form.defaultModel : '';
    });
    addLabeledField(advanced, 'Model ID', manualModel, 'Enter a model ID manually if your provider does not list it.');
    form.append(advanced);

    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'ta-api-toggle';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = state.form.enabled;
    enabled.addEventListener('change', () => updateField('enabled', enabled.checked));
    enabledLabel.append(enabled, text('span', translate('Enabled')));
    form.append(enabledLabel);

    const actions = document.createElement('div');
    actions.className = 'ta-api-actions';
    actions.append(button(state.busy ? 'Saving…' : (state.form.isNew ? 'Save connection' : 'Save changes'), saveForm, 'ta-api-button ta-api-button--primary', state.busy, 'save'));
    actions.append(button('Back', () => selectConnection(selectedConnection()), 'ta-api-button', state.busy));
    form.append(actions);
    form.addEventListener('submit', event => { event.preventDefault(); void saveForm(); });
    parent.append(form);
  }

  function modelOption(model) {
    return {
      value: model.id,
      label: model.displayName && model.displayName !== model.id ? `${model.displayName} · ${model.id}` : model.id
    };
  }

  function renderPreview(section) {
    const { status, models, error } = state.preview;
    const fetching = status === 'loading';
    const fetchButton = button(fetching ? 'Fetching models…' : 'Fetch models', () => void previewModels(),
      'ta-api-button', fetching || state.busy, 'preview-models');
    section.replaceChildren(fetchButton);
    const message = error || (status === 'ready'
      ? models.length ? 'The list is ready. Choose a default or select a model later in the main window.' : 'No models returned.'
      : '');
    if (message) {
      const hint = text('small', translate(message), 'ta-api-field__hint');
      hint.setAttribute('role', error ? 'alert' : 'status');
      section.append(hint);
    }
    if (!models.length) return;
    const model = select([{ value: '', label: translate('Choose a model (optional)') }, ...models.map(modelOption)], state.form.defaultModel);
    model.name = 'draftModel';
    model.addEventListener('change', () => {
      updateField('defaultModel', model.value);
      const manual = state.overlay?.querySelector('[name="draftManualModel"]');
      if (manual) manual.value = model.value;
    });
    addLabeledField(section, 'Available models', model);
  }

  function draftEndpoints(form) {
    let base;
    try { base = new URL(form.baseUrl.trim()); } catch { throw new Error('Use HTTPS, or HTTP on 127.0.0.1.'); }
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === '127.0.0.1'))
      throw new Error('Use HTTPS, or HTTP on 127.0.0.1.');
    if (base.username || base.password) throw new Error('Credentials must not be embedded in the model connection URL.');
    if (base.search || base.hash) throw new Error('Base URL must not contain a query or fragment.');
    const endpoints = { baseUrl: base.href.replace(/\/$/u, '') };
    if (form.modelListUrl?.trim()) {
      let modelList;
      try { modelList = new URL(form.modelListUrl.trim()); } catch { throw new Error('The models endpoint must use the same origin as the base URL.'); }
      if (modelList.origin !== base.origin || modelList.username || modelList.password || modelList.hash)
        throw new Error('The models endpoint must use the same origin as the base URL.');
      endpoints.modelListUrl = modelList.href;
    }
    return endpoints;
  }

  function discoveryError(error) {
    const message = error.message || String(error);
    return ({
      'could not reach the model provider': 'Could not reach the model provider.',
      'model provider request timed out': 'The provider request timed out. Try again.',
      'model provider does not offer a model list': 'The provider does not expose a model list. Enter a model ID to continue.',
      'model provider returned invalid JSON': 'The provider returned an invalid model list.',
      'model provider returned an unsupported model list': 'The provider returned an invalid model list.',
      'model provider returned HTTP 401': 'The provider rejected this API key. Check the key and its access.',
      'model provider returned HTTP 403': 'The provider rejected this API key. Check the key and its access.',
      'API key is not configured for this model connection': 'Enter an API key to fetch models.',
    })[message] || message;
  }

  async function previewModels() {
    const form = state.form;
    if (!form || state.busy || state.preview.status === 'loading') return;
    const request = state.preview.request + 1;
    const current = () => state.preview.request === request && state.form === form && Boolean(state.overlay);
    const paint = () => {
      const preview = state.overlay?.querySelector('.ta-api-preview');
      if (preview) renderPreview(preview);
    };
    state.preview = { request, status: 'loading', models: [], error: '' };
    paint();
    try {
      if (form.isNew && !form.apiKey.trim()) throw new Error('Enter an API key to fetch models.');
      const result = await rpc('connections.previewModels', {
        preset: form.preset,
        transport: form.transport,
        ...draftEndpoints(form),
        ...(form.id && !form.isNew ? { connectionId: form.id } : {}),
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      });
      if (current()) state.preview = { request, status: 'ready', models: Array.isArray(result?.models) ? result.models : [], error: '' };
    } catch (error) {
      if (current()) state.preview = { request, status: 'error', models: [], error: discoveryError(error) };
    } finally {
      if (current()) paint();
    }
  }

  function renderConnectionDetails(parent, connection) {
    const head = document.createElement('div');
    head.className = 'ta-api-details__heading';
    const name = document.createElement('div');
    name.append(text('h2', connection.displayName));
    name.append(text('p', `${providerName(connection.preset)} · ${connection.baseUrl}`, 'ta-api-muted'));
    head.append(name);
    head.append(button('Edit', () => editConnection(connection), 'ta-api-button ta-api-button--compact', state.busy));
    parent.append(head);

    const modelSection = document.createElement('section');
    modelSection.className = 'ta-api-section';
    const sectionHead = document.createElement('div');
    sectionHead.className = 'ta-api-section__head';
    const modelTitle = document.createElement('div');
    modelTitle.append(text('h3', translate('Default model')));
    modelTitle.append(text('p', translate('Refresh the provider’s live model list to choose a default.')));
    sectionHead.append(modelTitle);
    sectionHead.append(button(state.modelStatus === 'loading' ? 'Refreshing…' : 'Refresh models', () => void refreshModels(connection, true), 'ta-api-button',
      state.busy || state.modelStatus === 'loading' || !connection.enabled || !connection.credentialConfigured, 'refresh'));
    modelSection.append(sectionHead);

    const savedModel = connection.defaultModel && !state.models.some(model => model.id === connection.defaultModel)
      ? [{ id: connection.defaultModel, displayName: connection.defaultModel }]
      : [];
    const options = [{ value: '', label: translate('No default model') }, ...[...savedModel, ...state.models].map(modelOption)];
    const modelSelect = select(options, connection.defaultModel || '');
    modelSelect.name = 'defaultModel';
    modelSelect.setAttribute('aria-label', translate('Default model'));
    modelSelect.disabled = state.busy || options.length === 1;
    modelSelect.addEventListener('change', () => void setDefaultModel(connection, modelSelect.value));
    modelSection.append(modelSelect);
    const modelStatus = state.modelError || (!connection.enabled ? 'Enable this connection to load models.'
      : !connection.credentialConfigured ? 'Save an API key to load models.'
      : state.modelStatus === 'loading' ? 'Refreshing…'
      : state.modelStatus === 'ready' ? (state.models.length ? '' : 'No models returned.') : 'Models not loaded');
    if (modelStatus) {
      const status = text('small', translate(modelStatus), 'ta-api-field__hint');
      status.setAttribute('role', state.modelError ? 'alert' : 'status');
      modelSection.append(status);
    }
    const manual = document.createElement('form');
    manual.className = 'ta-api-model-manual';
    const modelId = input('text', '', 'Model ID');
    modelId.name = 'manualModel';
    modelId.required = true;
    modelId.spellcheck = false;
    modelId.disabled = state.busy;
    addLabeledField(manual, 'Model ID', modelId, 'Enter a model ID manually if your provider does not list it.');
    const applyModel = button('Use this model', null, 'ta-api-button', state.busy, 'manual-model');
    applyModel.type = 'submit';
    manual.append(applyModel);
    manual.addEventListener('submit', event => {
      event.preventDefault();
      if (modelId.value.trim()) void setDefaultModel(connection, modelId.value.trim());
    });
    modelSection.append(manual);
    parent.append(modelSection);

    const chat = document.createElement('section');
    chat.className = 'ta-api-section ta-api-chat';
    chat.append(text('h3', translate('Start a chat')));
    const projectPicker = select([
      { value: '', label: translate(state.projects.length ? 'Choose a project' : state.busy ? 'Loading…' : 'No projects available') },
      ...state.projects.map(project => ({ value: project.path, label: project.name || project.path }))
    ], state.projectPath);
    projectPicker.name = 'project';
    projectPicker.setAttribute('aria-label', translate('Project'));
    const start = button(state.busy ? 'Starting…' : 'Create chat', () => void startChat(connection, projectPicker.value), 'ta-api-button ta-api-button--primary', true, 'start-chat');
    const updateStart = () => {
      start.disabled = state.busy || !connection.enabled || !connection.credentialConfigured || !connection.defaultModel || !projectPicker.value;
    };
    projectPicker.addEventListener('change', () => { state.projectPath = projectPicker.value; updateStart(); });
    updateStart();
    chat.append(projectPicker);
    chat.append(start);
    parent.append(chat);

    parent.append(button('Remove provider', () => void removeConnection(connection), 'ta-api-danger', state.busy));
  }

  async function saveForm() {
    if (state.busy || !state.form) return;
    const form = { ...state.form };
    form.displayName = form.displayName.trim();
    if (!form.displayName || !form.baseUrl.trim()) { state.error = 'Name and base URL are required.'; render(); return; }
    let saved = false;
    let endpoints;
    try {
      endpoints = draftEndpoints(form);
    } catch (error) {
      state.error = error.message;
      render();
      return;
    }
    if (!form.id) {
      form.id = `api-${slug(form.displayName)}-${Math.random().toString(36).slice(2, 8)}`;
      state.form.id = form.id;
    }
    state.busy = true;
    state.error = '';
    render();
    try {
      await rpc('connections.upsert', {
        id: form.id,
        displayName: form.displayName,
        preset: form.preset,
        transport: form.transport,
        ...endpoints,
        ...(form.defaultModel ? { defaultModel: form.defaultModel } : {}),
        enabled: Boolean(form.enabled)
      });
      if (form.apiKey.trim()) await rpc('connections.setCredential', { connectionId: form.id, apiKey: form.apiKey.trim() });
      state.selectedId = form.id;
      state.form = null;
      resetPreview();
      resetModels();
      state.notice = 'Connection saved.';
      await loadConnections();
      saved = true;
    } catch (error) {
      state.error = error.message || String(error);
    } finally {
      state.busy = false;
      render();
    }
    if (saved) {
      const connection = selectedConnection();
      if (state.overlay && connection?.enabled && connection.credentialConfigured) void refreshModels(connection, true);
      else announceCatalog();
    }
  }

  async function setDefaultModel(connection, modelId) {
    if (state.busy) return;
    state.busy = true;
    state.error = '';
    state.notice = '';
    render();
    try {
      await rpc('connections.upsert', {
        id: connection.id,
        displayName: connection.displayName,
        preset: connection.preset,
        transport: connection.transport,
        baseUrl: connection.baseUrl,
        ...(connection.modelListUrl ? { modelListUrl: connection.modelListUrl } : {}),
        ...(modelId ? { defaultModel: modelId } : {}),
        enabled: connection.enabled
      });
      await loadConnections();
      state.notice = 'Connection saved.';
      announceCatalog();
    } catch (error) {
      state.error = error.message || String(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function loadConnections() {
    const result = await rpc('connections.list');
    state.connections = Array.isArray(result?.connections) ? result.connections : [];
    if (state.selectedId && !state.connections.some(item => item.id === state.selectedId)) state.selectedId = null;
  }

  async function refreshModels(connection, updateCatalog = false) {
    const request = ++state.modelRequest;
    const current = () => request === state.modelRequest && connection.id === state.selectedId && Boolean(state.overlay);
    state.modelStatus = 'loading';
    state.modelError = '';
    render();
    try {
      const result = await rpc('connections.models', { connectionId: connection.id });
      if (!current()) return;
      state.models = Array.isArray(result?.models) ? result.models : [];
      state.modelStatus = 'ready';
    } catch (error) {
      if (!current()) return;
      state.modelStatus = 'error';
      state.modelError = discoveryError(error);
    } finally {
      if (current()) render();
      if (updateCatalog) announceCatalog();
    }
  }

  async function loadProjects() {
    try {
      const result = await rpc('projects.list');
      state.projects = Array.isArray(result?.projects) ? result.projects : [];
      if (!state.projects.some(project => project.path === state.projectPath)) state.projectPath = '';
    } catch (error) {
      state.error = state.error || error.message || String(error);
    }
  }

  async function removeConnection(connection) {
    if (state.busy || !window.confirm(translate('Delete this provider and its saved credential?'))) return;
    state.busy = true;
    state.error = '';
    state.notice = '';
    render();
    try {
      await rpc('connections.remove', { connectionId: connection.id });
      state.connections = state.connections.filter(item => item.id !== connection.id);
      resetModels();
      state.selectedId = null;
      announceCatalog();
    } catch (error) {
      state.error = error.message || String(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function startChat(connection, workspacePath) {
    if (state.busy || !connection.defaultModel || !connection.credentialConfigured || !connection.enabled) return;
    if (!workspacePath) { state.error = 'Choose a project before creating a chat.'; render(); return; }
    state.busy = true;
    state.error = '';
    state.notice = '';
    render();
    try {
      const result = await rpc('thread.start', {
        provider: 'api',
        connectionId: connection.id,
        workspacePath,
        ...(connection.defaultModel ? { model: connection.defaultModel } : {})
      });
      state.newThreadId = result?.threadId;
      state.notice = 'Chat created. Open it from the project sidebar.';
    } catch (error) {
      state.error = error.message || String(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function openOverlay() {
    if (state.overlay) return;
    state.notice = '';
    state.error = '';
    const overlay = document.createElement('div');
    overlay.className = 'ta-api-overlay';
    overlay.innerHTML = '<div class="ta-api-backdrop"></div><section class="ta-api-shell" role="dialog" aria-modal="true" aria-labelledby="ta-api-title"></section>';
    overlay.querySelector('.ta-api-backdrop').addEventListener('click', closeOverlay);
    document.body.append(overlay);
    state.overlay = overlay;
    render();
    state.busy = true;
    render();
    try {
      await Promise.all([loadConnections(), loadProjects()]);
    } catch (error) {
      state.error = error.message || translate('Could not load connections.');
    } finally {
      state.busy = false;
      if (state.overlay === overlay) {
        const connection = selectedConnection() || state.connections[0];
        if (connection && !state.error) selectConnection(connection);
        else render();
      }
    }
    overlay.querySelector('.ta-api-icon-button')?.focus();
  }

  function closeOverlay() {
    if (!state.overlay) return;
    state.overlay.remove();
    state.overlay = null;
    state.form = null;
    state.newThreadId = null;
    resetPreview();
    resetModels();
    document.querySelector('.ta-api-nav-item')?.classList.remove('is-active');
    state.previousNavItem?.classList.add('is-active');
    state.previousNavItem = null;
    if (state.opener?.isConnected) state.opener.focus();
    state.opener = null;
  }

  function installNavigation() {
    const nav = document.querySelector('.settings__nav');
    if (nav && !nav.querySelector('.ta-api-nav-item')) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'settings__nav-item ta-api-nav-item';
      item.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M9 7V4m6 3V4M8 12h8m-7 0v4a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3v-4M7 7h10a2 2 0 0 1 2 2v3H5V9a2 2 0 0 1 2-2Z"/></svg><span></span>';
      item.querySelector('span').textContent = translate('API connections');
      item.addEventListener('click', () => {
        state.opener = item;
        state.previousNavItem = nav.querySelector('.settings__nav-item.is-active');
        state.previousNavItem?.classList.remove('is-active');
        item.classList.add('is-active');
        void openOverlay();
      });
      nav.append(item);
    }
    for (const surface of document.querySelectorAll('.settings__panel .provider-roster, .settings__panel .provider-picker')) {
      if (surface.querySelector('.ta-api-provider-link')) continue;
      const link = button('API connections', () => {
        state.opener = link;
        void openOverlay();
      }, 'ta-api-button ta-api-provider-link');
      surface.append(link);
    }
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.overlay) closeOverlay();
  });
  document.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver(installNavigation);
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
    installNavigation();
    void import('./test-document-workflow.js')
      .then(({ installDocumentWorkflow }) => installDocumentWorkflow({ rpc, openConnections: openOverlay }))
      .catch(() => console.warn('Document workflow could not be loaded.'));
  }, { once: true });
})();
