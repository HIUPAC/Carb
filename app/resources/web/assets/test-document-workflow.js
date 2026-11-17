function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function option(value, label) {
  const node = element('option', label);
  node.value = value;
  return node;
}

function selectValue(select, entries, placeholder, value) {
  select.replaceChildren(option('', placeholder), ...entries.map(({ id, label }) => option(id, label)));
  select.value = value ?? '';
}

const isZh = () => document.documentElement.lang.toLowerCase().startsWith('zh');
const t = (en, zh) => isZh() ? zh : en;

function localError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('already exists')) return t('That file already exists. Choose a new filename.', '该文件已存在，请换一个文件名。');
  if (/credential|key is not configured/i.test(message)) return t('Check the provider’s API key in Settings.', '请到设置检查该服务商的 API 密钥。');
  return message;
}

export function installDocumentWorkflow({ rpc, openConnections }) {
  let active;
  let lastConnection;
  const preferredModels = new Map();
  let draft = {};

  window.addEventListener('test-document-workflow', event => {
    if (active?.open) return;
    const requestedProject = typeof event.detail?.projectPath === 'string' ? event.detail.projectPath : draft.projectPath || '';
    const dialog = element('dialog', '', 'test-document-workflow');
    active = dialog;
    const title = element('h2', t('Document task', '文档任务'));
    title.id = 'test-document-workflow-title';
    dialog.setAttribute('aria-labelledby', title.id);
    const form = element('form', '', 'test-document-workflow__form');
    const project = element('select');
    project.name = 'workflowProject';
    project.required = true;
    const connection = element('select');
    connection.name = 'workflowConnection';
    connection.required = true;
    const model = element('select');
    model.name = 'workflowModel';
    model.required = true;
    const task = element('textarea');
    task.name = 'workflowInstructions';
    task.placeholder = t('Summarize notes.md into a report with action items.', '例如：读取 notes.md，整理成报告并列出待办事项。');
    task.required = true;
    task.maxLength = 8000;
    task.rows = 4;
    task.value = draft.instructions || '';
    const role = element('input');
    role.name = 'workflowRole';
    role.maxLength = 240;
    role.value = draft.role || '';
    role.placeholder = t('Optional: project manager, researcher…', '选填，例如：项目负责人、研究人员…');
    const criteria = element('textarea');
    criteria.name = 'workflowAcceptance';
    criteria.maxLength = 3000;
    criteria.rows = 3;
    criteria.value = draft.acceptanceCriteria || '';
    criteria.placeholder = t('Optional: list the checks that make this task successful.', '选填，例如：覆盖全部会议结论；每项待办包含负责人和截止时间；注明缺失信息。');
    const output = element('input');
    output.name = 'workflowOutput';
    output.value = draft.outputName || 'report.md';
    output.maxLength = 140;
    output.required = true;
    const status = element('p', '', 'test-document-workflow__status');
    status.setAttribute('role', 'status');
    const refresh = element('button', t('Refresh models', '刷新模型'), 'ta-api-button');
    refresh.type = 'button';
    refresh.dataset.workflowAction = 'refresh';
    const setup = element('button', t('API connections', 'API 连接'), 'ta-api-button');
    setup.type = 'button';
    const cancel = element('button', t('Cancel', '取消'), 'ta-api-button');
    cancel.type = 'button';
    const run = element('button', t('Run task', '运行任务'), 'ta-api-button ta-api-button--primary');
    run.type = 'submit';
    run.dataset.workflowAction = 'run';

    const field = (label, control) => {
      const node = element('label', '', 'test-document-workflow__field');
      node.append(element('span', label), control);
      return node;
    };
    const selection = element('div', '', 'test-document-workflow__selection');
    selection.append(field(t('Project', '项目'), project), field(t('Provider', '服务商'), connection), field(t('Model', '模型'), model), refresh);
    const actions = element('div', '', 'test-document-workflow__actions');
    actions.append(setup, cancel, run);
    const steps = element('ol', '', 'test-document-workflow__steps');
    for (const label of [t('Define goal', '明确任务'), t('Plan and read sources', '规划与读取资料'), t('Create document', '生成文档'), t('Read back and deliver', '读回校验与交付')]) steps.append(element('li', label));
    const details = element('details', '', 'test-document-workflow__details');
    details.open = Boolean(role.value || criteria.value);
    details.append(element('summary', t('Role and acceptance criteria (optional)', '使用角色与验收标准（选填）')), field(t('Intended user / role', '使用角色'), role), field(t('Acceptance criteria', '验收标准'), criteria));
    form.append(steps, selection, field(t('Task instructions', '任务要求'), task), details, field(t('Output filename', '输出文件名'), output),
      element('p', t('Uses the selected provider’s API quota. Reads project text and only creates the named Markdown file; no shell commands or overwriting. Progress, errors and the saved-file verification appear in the task chat. If it fails, review the error and retry with a new filename if an output already exists.', '消耗所选服务商的 API 额度。读取项目文本资料，仅新建指定 Markdown 文件，不执行命令或覆盖已有文件。任务会话显示执行过程、失败原因和文件校验结果。失败后可保留要求重试；已生成文件时请换一个输出文件名。'), 'test-document-workflow__hint'), status, actions);
    dialog.append(title, form);
    document.body.append(dialog);
    dialog.showModal();

    let connections = [];
    let selectionRequest = 0;
    let submitting = false;
    let loadingModels = false;
    const update = () => {
      for (const control of [project, connection, task, role, criteria, output, setup, cancel]) control.disabled = submitting;
      refresh.disabled = submitting || loadingModels || !connection.value;
      model.disabled = submitting || loadingModels || model.options.length <= 1;
      run.disabled = submitting || loadingModels || !project.value || !model.value;
    };
    const show = (message, error = false) => {
      status.textContent = message;
      status.classList.toggle('is-error', error);
    };
    const loadModels = async () => {
      const selected = connections.find(item => item.id === connection.value);
      const request = ++selectionRequest;
      const preferred = preferredModels.get(selected?.id) ?? selected?.defaultModel;
      selectValue(model, [], t('Choose a model', '选择模型'));
      if (!selected) { loadingModels = false; update(); return; }
      lastConnection = selected.id;
      loadingModels = true;
      update();
      show(t('Loading models…', '正在获取模型…'));
      let entries = [];
      let error;
      try {
        const result = await rpc('connections.models', { connectionId: selected.id });
        entries = result.models.map(item => ({ id: item.id, label: item.displayName === item.id ? item.id : `${item.displayName} · ${item.id}` }));
      } catch (failure) { error = failure; }
      if (!dialog.open || request !== selectionRequest) return;
      const manual = selected.defaultModel;
      if (manual && !entries.some(entry => entry.id === manual)) entries.unshift({ id: manual, label: manual });
      const current = entries.some(entry => entry.id === preferred) ? preferred : entries.length === 1 ? entries[0].id : undefined;
      selectValue(model, entries, t('Choose a model', '选择模型'), current);
      show(error ? t('The live list is unavailable. Check the connection in Settings.', '暂时无法获取实时列表，请到 API 连接检查配置。')
        : entries.length ? '' : t('No models returned. Set a model ID in API connections.', '服务商未返回模型，可到 API 连接填写模型 ID。'), Boolean(error));
      loadingModels = false;
      update();
    };

    connection.addEventListener('change', () => void loadModels());
    model.addEventListener('change', () => { if (model.value) preferredModels.set(connection.value, model.value); update(); });
    project.addEventListener('change', update);
    refresh.addEventListener('click', () => void loadModels());
    cancel.addEventListener('click', () => dialog.close());
    setup.addEventListener('click', () => { dialog.close(); void openConnections(); });
    dialog.addEventListener('cancel', event => { if (submitting) event.preventDefault(); });
    const saveDraft = () => { draft = { projectPath: project.value, instructions: task.value, role: role.value, acceptanceCriteria: criteria.value, outputName: output.value }; };
    form.addEventListener('input', saveDraft);
    dialog.addEventListener('close', () => { saveDraft(); dialog.remove(); if (active === dialog) active = undefined; }, { once: true });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitting || !project.value || !connection.value || !model.value) return;
      const instructions = task.value.trim();
      const outputName = output.value.trim();
      if (!instructions || !outputName) return;
      if (!/^[^<>:"/\\|?*\x00-\x1f]+\.md$/iu.test(outputName) || outputName.startsWith('.') ||
          /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(outputName)) {
        show(t('Enter a filename ending in .md, such as report.md.', '请输入以 .md 结尾的有效文件名，例如 report.md。'), true);
        output.focus();
        return;
      }
      submitting = true;
      update();
      show(t('Starting task…', '正在启动任务…'));
      try {
        const { threadId } = await rpc('workflows.startDocument', { projectPath: project.value, connectionId: connection.value, model: model.value, instructions, outputName, role: role.value.trim(), acceptanceCriteria: criteria.value.trim() });
        dialog.close();
        window.dispatchEvent(new CustomEvent('test-open-workflow-thread', { detail: threadId }));
      } catch (error) {
        show(localError(error), true);
      } finally {
        submitting = false;
        update();
      }
    });

    selectValue(project, [], t('Loading projects…', '正在读取项目…'));
    selectValue(connection, [], t('Loading providers…', '正在读取服务商…'));
    selectValue(model, [], t('Choose a model', '选择模型'));
    update();
    void Promise.all([rpc('projects.list'), rpc('connections.list')]).then(async ([projects, providers]) => {
      if (!dialog.open) return;
      const entries = projects.projects.map(item => ({ id: item.path, label: item.name || item.path }));
      const selected = entries.find(item => item.id === requestedProject)?.id ?? (entries.length === 1 ? entries[0].id : undefined);
      selectValue(project, entries, t('Choose a project', '选择项目'), selected);
      connections = providers.connections.filter(item => item.enabled && item.credentialConfigured);
      selectValue(connection, connections.map(item => ({ id: item.id, label: item.displayName })), t('Choose a provider', '选择服务商'),
        connections.find(item => item.id === lastConnection)?.id ?? (connections.length === 1 ? connections[0].id : undefined));
      if (connection.value) await loadModels();
      if (!entries.length) show(t('Add a project to choose where the document will be saved.', '请先添加项目，指定文档的保存位置。'));
      else if (!connections.length) show(t('Add an API connection to choose a model.', '请先添加 API 连接，再选择模型。'));
      update();
    }).catch(error => { if (dialog.open) show(localError(error), true); });
  });
}
