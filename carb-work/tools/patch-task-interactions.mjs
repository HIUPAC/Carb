import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const clarificationInstructions = 'When a missing detail would materially change the result, use the available structured user-input tool (request_user_input, AskUserQuestion, or the equivalent) before proceeding. Ask at most three concise questions in the user\'s language, suggest two to four meaningful choices when possible, and always allow a separate custom answer. Do not invent choices if none are useful. If the tool is unavailable, ask the same concise questions in the chat and wait for the reply. Do not ask about routine implementation choices.';

function replaceOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  return source.replace(anchor, replacement);
}

const questionComponent = `function Cn(e) {
  const [answers, setAnswers] = R.useState(() => new Map());
  const [index, setIndex] = R.useState(0);
  const [submitting, setSubmitting] = R.useState(false);
  const [failure, setFailure] = R.useState();
  const previousRequest = R.useRef(e.request);
  const question = e.request.questions[index];
  const answer = question ? answers.get(question.id) : undefined;
  const last = index === e.request.questions.length - 1;
  const portal = e.inline ? null : globalThis.document?.querySelector('.composer__box') ?? null;
  R.useEffect(() => {
    if (previousRequest.current !== e.request) {
      previousRequest.current = e.request;
      if (failure === 'indeterminate') { setSubmitting(false); setFailure(undefined); }
    }
  }, [e.request, failure]);
  const text = (zh, en) => __testLocale() === 'zh-CN' ? zh : en;
  if (submitting) {
    const status = z.jsxs('div', { className: 'brief-input brief-input--status', role: 'status', children: [
      z.jsx(d, { className: 'brief-input__spinner', size: 14, 'aria-hidden': true }),
      failure === 'indeterminate' ? text('正在确认是否已收到答复…', 'Checking whether answers were received…') : text('正在提交答复…', 'Submitting answers…')
    ] });
    return portal ? xn.createPortal(status, portal) : status;
  }
  if (!question) return null;
  const options = question.options ?? [];
  const hasAnswer = Sn(answer).length > 0;
  const update = fn => setAnswers(current => {
    const next = new Map(current);
    next.set(question.id, fn(current.get(question.id) ?? { options: [], custom: false, text: '' }));
    return next;
  });
  const fail = error => {
    if (error instanceof D) { setFailure('indeterminate'); return; }
    setSubmitting(false); setFailure('definite');
  };
  const content = z.jsxs('form', {
    className: 'brief-input carb-brief-input', 'aria-label': text('补充任务信息', 'Task clarification'),
    onSubmit: event => {
      event.preventDefault();
      if (!hasAnswer) return;
      if (!last) { setIndex(value => value + 1); return; }
      const missing = e.request.questions.findIndex(item => !Sn(answers.get(item.id)).length);
      if (missing >= 0) { setIndex(missing); return; }
      setSubmitting(true); setFailure(undefined);
      try { Promise.resolve(e.onSubmit(Object.fromEntries([...answers].map(([id, value]) => [id, Sn(value)])))).catch(fail); }
      catch (error) { fail(error); }
    },
    children: [
      z.jsx('div', { className: 'brief-input__stage', 'aria-live': 'polite', children:
        z.jsxs('section', { className: 'brief-input__question', 'aria-labelledby': 'brief-question-' + question.id, children: [
          z.jsx('h2', { id: 'brief-question-' + question.id, children: question.question }),
          options.length ? z.jsx('div', {
            className: 'brief-input__options', role: question.multiSelect ? 'group' : 'radiogroup',
            'aria-labelledby': 'brief-question-' + question.id,
            children: options.map(option => z.jsxs('label', {
              className: 'brief-input__option', children: [
                z.jsx('input', {
                  type: question.multiSelect ? 'checkbox' : 'radio', name: question.id,
                  checked: answer?.options.includes(option.label) ?? false,
                  onChange: () => update(current => question.multiSelect
                    ? { ...current, options: current.options.includes(option.label) ? current.options.filter(value => value !== option.label) : [...current.options, option.label] }
                    : { options: [option.label], custom: false, text: '' })
                }),
                z.jsxs('span', { className: 'carb-brief-option__copy', children: [
                  z.jsx('span', { children: option.label }),
                  option.description && option.description !== option.label ? z.jsx('small', { children: option.description }) : null
                ] })
              ]
            }, option.label))
          }) : null,
          z.jsxs('label', { className: 'carb-brief-custom', children: [
            z.jsx('span', { children: text('自行填写', 'Your own answer') }),
            z.jsx('input', {
              key: question.id, className: 'brief-input__custom carb-brief-custom__input',
              type: question.secret ? 'password' : 'text', value: answer?.text ?? '',
              autoComplete: question.secret ? 'new-password' : 'off',
              placeholder: question.multiSelect ? text('输入其他答案或补充信息', 'Another answer or additional detail') : text('也可以直接输入你的答案', 'Or type your own answer'),
              'aria-label': text('自行填写：', 'Custom answer: ') + question.question,
              onChange: event => {
                const value = event.target.value;
                update(current => ({ options: question.multiSelect ? current.options : [], custom: Boolean(value.trim()), text: value }));
              }
            })
          ] })
        ] })
      }),
      z.jsxs('footer', { className: 'brief-input__footer', children: [
        failure === 'definite' ? z.jsx('span', { role: 'alert', children: text('提交失败，请重试。', 'Could not submit. Try again.') })
          : z.jsx('span', { children: text('问题 ' + (index + 1) + ' / ' + e.request.questions.length, 'Question ' + (index + 1) + ' of ' + e.request.questions.length) }),
        z.jsxs('div', { className: 'brief-input__actions', children: [
          index > 0 ? z.jsx('button', { className: 'brief-input__back', type: 'button', onClick: () => setIndex(value => value - 1), children: text('上一步', 'Back') }) : null,
          z.jsx('button', { className: 'brief-input__next', type: 'submit', disabled: !hasAnswer, children: last ? text('提交答复', 'Submit answers') : text('下一步', 'Next') })
        ] })
      ] })
    ]
  });
  return portal ? xn.createPortal(content, portal) : content;
}`;

export function patchTaskWebFile(relativePath, source) {
  const name = path.basename(relativePath);
  if (name === 'Thread-DfWOIudl.js') {
    if (source.includes('carb-brief-input')) return source;
    const start = source.indexOf('function Cn(e){');
    const end = source.indexOf('var wn=59;', start);
    if (start < 0 || end < 0) throw new Error('Native user-input component anchor missing');
    return source.slice(0, start) + questionComponent + source.slice(end);
  }
  if (name === 'CompletedMarkdown-BRgznyWz.js') {
    if (source.includes('data-carb-file-path')) return source;
    const start = source.indexOf('function Lc(');
    const end = source.indexOf('var Rc=', start);
    if (start < 0 || end < 0) throw new Error('Inline file reference anchor missing');
    source = source.slice(0, start) + `function Lc({children:t,node:n,...r}){let s=C.useContext(Rc),f=typeof t==='string'&&_e(t)&&!/[\\r\\n]/.test(t),v=s&&f?Fs(t,s):undefined;if(v?.kind==='safe')return $.jsxs('button',{className:'md-file-ref md-file-link--action carb-file-action',type:'button','data-carb-file-path':v.path,'data-carb-project-path':s,'aria-label':(__testLocaleMarkdown()?'文件操作：':'File actions: ')+t,title:(__testLocaleMarkdown()?'打开文件操作':'File actions'),onClick:()=>{if(!globalThis.__carbTaskActionsReady)a(v.path,s).catch(()=>{})},children:[$.jsx(e,{path:v.path}),t]});return typeof t==='string'&&ve(t)?$.jsxs('span',{className:'md-file-ref',children:[$.jsx(e,{path:t}),t]}):$.jsx('code',{...r,children:t})}function __testLocaleMarkdown(){return document.documentElement.lang.startsWith('zh')}` + source.slice(end);
    const anchor = 'className:`md-file-link md-file-link--action`,type:`button`,title:l?';
    source = replaceOnce(source, anchor, 'className:`md-file-link md-file-link--action carb-file-action`,type:`button`,"data-carb-file-path":n.path,"data-carb-project-path":s,"aria-label":(__testLocaleMarkdown()?`文件操作：`:`File actions: `)+n.path,title:l?', 'Markdown action attributes');
    source = replaceOnce(source, 'onClick:()=>{u(!1),a(n.path,s).catch(()=>u(!0))}', 'onClick:()=>{if(!globalThis.__carbTaskActionsReady){u(!1);a(n.path,s).catch(()=>u(!0))}}', 'Markdown reveal fallback');
    return source;
  }
  if (name === 'file-reference-Do6RcPXZ.js') {
    if (source.includes('pdf:`document`')) return source;
    return replaceOnce(source, 'var e={tsx:', 'var e={pdf:`document`,doc:`document`,docx:`document`,ppt:`document`,pptx:`document`,xls:`document`,xlsx:`document`,zip:`archive`,mp4:`video`,mp3:`audio`,tsx:', 'Document file types');
  }
  if (name === 'test-ux-enhancements.js') {
    if (source.includes('carb-preflight-choice')) return source;
    source = replaceOnce(source, 'const label = document.createElement("label");', 'const label = document.createElement(field.options?.length ? "div" : "label");', 'Accessible preflight choice wrapper');
    const fieldAnchor = 'label.append(caption, control);';
    source = replaceOnce(source, fieldAnchor, `if (field.options?.length) {
      caption.id = "carb-preflight-caption-" + field.id;
      control.setAttribute("aria-labelledby", caption.id);
    }
    label.append(caption);
    if (field.options?.length) {
      const choices = document.createElement('span');
      choices.className = 'carb-preflight-choices';
      choices.setAttribute('role', 'group');
      choices.setAttribute('aria-label', field.label);
      for (const option of field.options) {
        const choice = document.createElement('button');
        choice.type = 'button'; choice.className = 'carb-preflight-choice';
        choice.textContent = option; choice.setAttribute('aria-pressed', 'false');
        choice.addEventListener('click', event => {
          event.preventDefault();
          const selected = choice.getAttribute('aria-pressed') !== 'true';
          choices.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', 'false'));
          choice.setAttribute('aria-pressed', String(selected));
          control.dataset.choice = selected ? option : '';
        });
        choices.append(choice);
      }
      label.append(choices);
      control.placeholder = copy('自行填写或补充（可留空）', 'Your own answer or additional detail (optional)');
    }
    label.append(control);`, 'Preflight choices');
    source = replaceOnce(source, 'value: control.value.trim()', 'value: [control.dataset.choice, control.value.trim()].filter(Boolean).join(copy("；", "; "))', 'Preflight combined answers');
    const pairAnchor = 'return pairs.map(([id, label]) => ({ id, label, type: "input", placeholder: copy("可留空", "Optional") }));';
    source = replaceOnce(source, pairAnchor, `const choices = {
      audience: copy(['团队内部', '客户与合作伙伴', '评审 / 投资人', '大众用户'], ['Internal team', 'Customers and partners', 'Reviewers / investors', 'General audience']),
      purpose: copy(['介绍与展示', '方案汇报', '教学培训', '争取决策支持'], ['Introduce and showcase', 'Present a proposal', 'Teach and train', 'Support a decision']),
      platform: copy(['桌面网页', '移动端', '桌面应用', '多端适配'], ['Desktop web', 'Mobile', 'Desktop app', 'Responsive across devices']),
      flow: copy(['首页与核心流程', '完善已有页面', '完整产品原型'], ['Home and core flow', 'Improve existing screens', 'Complete product prototype']),
      scope: kind === 'ppt' ? copy(['5–8 页精简版', '10–15 页标准版', '20 页以上详细版'], ['5–8 concise slides', '10–15 standard slides', '20+ detailed slides']) : copy(['核心流程', '完整方案', '先给初稿'], ['Core flow', 'Complete proposal', 'First draft']),
      style: copy(['简洁现代', '专业商务', '活泼创意', '沿用现有风格'], ['Clean and modern', 'Professional', 'Playful and creative', 'Follow existing style']),
      constraints: copy(['沿用现有项目', '优先可用原型', '需要响应式适配'], ['Use existing project', 'Prioritize a usable prototype', 'Responsive layout required'])
    };
    return pairs.map(([id, label]) => ({ id, label, type: 'input', options: choices[id] ?? [], placeholder: copy('自行填写（可留空）', 'Your own answer (optional)') }));`, 'Preflight suggested values');
    source = source.replace('先提出最多 3 个简短、具体的问题；信息足够时直接开始。', '通过结构化提问工具提出最多 3 个简短问题，每题尽量给出 2–4 个可点击的有效选项，并始终保留自由输入；信息足够时直接开始。');
    source = source.replace('ask up to three concise questions first; otherwise start.', 'use the structured user-input tool to ask up to three concise questions with two to four useful choices and a separate custom answer; otherwise start.');
    source = replaceOnce(source, 'beam.querySelector(":scope > .test-optimize-button")', 'beam.closest(".composer__prompt")?.querySelector(".test-optimize-button")', 'Optimizer duplicate check');
    source = replaceOnce(source, 'prompt.querySelector(":scope > .test-optimize-button")', 'prompt.querySelector(".test-optimize-button")', 'Optimizer duplicate check');
    source = replaceOnce(source, 'prompt.append(button);', 'const tools = beam.closest(".tools");\n  if (tools) tools.insertBefore(button, beam);\n  else prompt.append(button);', 'Optimizer button placement');
    return source;
  }
  return source;
}

const taskIpc = `
// Carb task links: only an explicit renderer click reaches these handlers.
ipcMain.handle("carb:openProjectFile", async (event, value, projectRoot) => {
  requireOwnRenderer(event.sender);
  const target = await projectFilePath(value, projectRoot);
  const info = await (await import("node:fs/promises")).stat(target);
  if (!info.isFile() && !info.isDirectory()) throw new Error("This path cannot be opened");
  if (info.isFile() && /\\.(?:exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jsx|mjs|cjs|jse|wsf|wsh|scr|cpl|msi|msp|lnk|url|app|sh|command|py|pyw|rb|pl|php|lua|jar|hta|reg|scf)$/i.test(target)) throw new Error("Use your editor to open program and script files");
  const error = await shell2.openPath(target);
  if (error) throw new Error(error);
});
ipcMain.handle("carb:openProjectFolder", async (event, value, projectRoot) => {
  requireOwnRenderer(event.sender);
  const target = await projectFilePath(value, projectRoot);
  const info = await (await import("node:fs/promises")).stat(target);
  const folder = info.isDirectory() ? target : path11.dirname(target);
  const safeFolder = await projectFilePath(folder, projectRoot);
  const error = await shell2.openPath(safeFolder);
  if (error) throw new Error(error);
});
ipcMain.handle("carb:openTaskExternal", async (event, value) => {
  requireOwnRenderer(event.sender);
  if (typeof value !== "string" || value.length > 32768) throw new Error("Invalid link");
  const url = new URL(value);
  if (!["https:", "http:", "mailto:"].includes(url.protocol) || url.username || url.password) throw new Error("Unsupported link");
  await shell2.openExternal(url.href);
});
`;

const requestToolDefinition = `
  {
    type: 'function',
    function: {
      name: 'request_user_input',
      description: 'Ask up to three task clarification questions and wait for the user. Offer two to four meaningful options when useful; a separate custom answer is always available. Use only when the answer materially affects the work.',
      parameters: {
        type: 'object', properties: { questions: { type: 'array', minItems: 1, maxItems: 3, items: {
          type: 'object', properties: {
            id: { type: 'string' }, header: { type: 'string' }, question: { type: 'string' },
            multiSelect: { type: 'boolean' }, secret: { type: 'boolean' },
            options: { type: 'array', maxItems: 4, items: { type: 'object', properties: { label: { type: 'string' }, description: { type: 'string' } }, required: ['label'], additionalProperties: false } }
          }, required: ['id', 'question'], additionalProperties: false
        } } }, required: ['questions'], additionalProperties: false
      }
    }
  },`;

const requestMethods = `
  respondToUserInput(id, answers) {
    const pending = this.pendingUserInputs.get(id);
    if (!pending) throw new Error('This question is no longer awaiting an answer.');
    const normalized = Object.create(null);
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('Invalid answers.');
    for (const question of pending.questions) {
      const values = answers[question.id];
      if (!Array.isArray(values) || !values.length || values.length > 16 || values.some(value => typeof value !== 'string' || !value.trim() || value.length > 12000)) throw new Error('Please answer every question.');
      normalized[question.id] = values.map(value => value.trim());
    }
    pending.finish(normalized);
  }

  async requestUserInput(turnId, args, signal) {
    if (!Array.isArray(args.questions) || !args.questions.length || args.questions.length > 3) throw new Error('Ask between one and three questions.');
    const ids = new Set();
    const questions = args.questions.map((question, index) => {
      if (!question || typeof question.question !== 'string' || !question.question.trim() || question.question.length > 2000) throw new Error('A concise question is required.');
      const id = typeof question.id === 'string' && question.id.trim() ? question.id.trim() : 'question-' + (index + 1);
      if (id.length > 120 || ids.has(id)) throw new Error('Question IDs must be unique.');
      ids.add(id);
      const options = (Array.isArray(question.options) ? question.options : []).slice(0, 4).map(option => {
        if (!option || typeof option.label !== 'string' || !option.label.trim() || option.label.length > 400) throw new Error('Invalid question option.');
        return { label: option.label.trim(), description: typeof option.description === 'string' ? option.description.slice(0, 1000) : option.label.trim() };
      });
      if (new Set(options.map(option => option.label)).size !== options.length) throw new Error('Question choices must be distinct.');
      return { id, header: typeof question.header === 'string' && question.header.trim() ? question.header.slice(0, 120) : 'Question ' + (index + 1), question: question.question.trim(), options, allowOther: true, multiSelect: question.multiSelect === true, secret: question.secret === true };
    });
    signal.throwIfAborted();
    const id = 'input-' + randomUUID();
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        this.pendingUserInputs.delete(id);
        signal.removeEventListener('abort', abort);
        this.emit('event', { type: 'user_input.resolved', id });
        if (error) reject(error); else resolve(JSON.stringify({ answers: value }));
      };
      const abort = () => finish(undefined, signal.reason ?? new Error('Question cancelled.'));
      this.pendingUserInputs.set(id, { questions, finish });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      this.emit('event', { type: 'user_input.requested', request: { id, turnId, questions, autoResolutionMs: null, createdAt: now() } });
    });
  }
`;

export function patchTaskNativeFile(relativePath, source) {
  const rel = relativePath.replaceAll('\\', '/');
  if (rel === 'dist/main.js') {
    if (source.includes('carb:openProjectFile')) return source;
    return replaceOnce(source, 'ipcMain.handle("harness:revealProjectFile",', taskIpc + 'ipcMain.handle("harness:revealProjectFile",', 'Task file IPC');
  }
  if (rel === 'dist/preload.cjs') {
    if (source.includes('carb:openProjectFile')) return source;
    return replaceOnce(source, 'revealProjectFile:(path,projectPath)=>', 'openProjectFile:(path,projectPath)=>import_electron.ipcRenderer.invoke("carb:openProjectFile",path,projectPath),openProjectFolder:(path,projectPath)=>import_electron.ipcRenderer.invoke("carb:openProjectFolder",path,projectPath),openTaskExternal:url=>import_electron.ipcRenderer.invoke("carb:openTaskExternal",url),revealProjectFile:(path,projectPath)=>', 'Task preload API');
  }
  if (rel.endsWith('/server/dist/orchestrator.js')) {
    if (source.includes('CARB_CLARIFICATION_INSTRUCTIONS')) return source;
    return replaceOnce(source, 'const composeInstructions = (instructions) => instructions?.trim()', `const CARB_CLARIFICATION_INSTRUCTIONS = ${JSON.stringify(clarificationInstructions)};\nconst composeInstructions = (instructions) => (instructions = [CARB_CLARIFICATION_INSTRUCTIONS, instructions?.trim()].filter(Boolean).join('\\n\\n'))?.trim()`, 'Agent clarification guidance');
  }
  if (rel.endsWith('/server/dist/api-runtime.js')) {
    if (source.includes('async requestUserInput(turnId,')) return source;
    source = replaceOnce(source, 'const TOOL_DEFINITIONS = [', 'const TOOL_DEFINITIONS = [' + requestToolDefinition, 'API clarification tool definition');
    source = replaceOnce(source, 'userInput: false,', 'userInput: true,', 'API user-input capability');
    source = replaceOnce(source, 'this.pendingApprovals = new Map();', 'this.pendingApprovals = new Map();\n    this.pendingUserInputs = new Map();', 'API pending questions');
    source = replaceOnce(source, '  respondToApproval(id, decision) {', requestMethods + '\n  respondToApproval(id, decision) {', 'API question protocol');
    source = replaceOnce(source, "if (call.function.name === 'read_file') {", "if (call.function.name === 'request_user_input') {\n        result = await this.requestUserInput(turnId, args, signal);\n      } else if (call.function.name === 'read_file') {", 'API clarification execution');
    const restoreAnchor = 'this.messages = restoreMessages(resumeState?.messages, defaultInstructions);';
    source = replaceOnce(source, restoreAnchor, restoreAnchor + `\n    const clarification = ${JSON.stringify(clarificationInstructions)};\n    const system = this.messages.find(message => message.role === 'system');\n    if (system && !system.content.includes('always allow a separate custom answer')) system.content += '\\n\\n' + clarification;`, 'API clarification prompt');
    return source;
  }
  if (rel.endsWith('/adapter-codex/dist/adapter.js')) {
    return source.replace('allowOther: question.isOther,', 'allowOther: true, // Carb always offers a custom answer alongside suggested choices.');
  }
  if (rel.endsWith('/server/dist/prompt-optimizer.js')) {
    if (source.includes('每题提供 2–4')) return source;
    return source.replace("'只输出改写后的请求正文", "'需要用户补充关键信息时，要求执行代理调用结构化提问工具，每题提供 2–4 个有意义的可点选项，并始终允许单独自由输入。信息足够时直接执行。',\n    '只输出改写后的请求正文");
  }
  return source;
}

export const taskNativePaths = ['dist/main.js', 'dist/preload.cjs', 'node_modules/@harness/server/dist/orchestrator.js', 'node_modules/@harness/server/dist/api-runtime.js', 'node_modules/@harness/adapter-codex/dist/adapter.js', 'node_modules/@harness/server/dist/prompt-optimizer.js'];
export const taskWebPaths = ['assets/Thread-DfWOIudl.js', 'assets/CompletedMarkdown-BRgznyWz.js', 'assets/file-reference-Do6RcPXZ.js', 'assets/test-ux-enhancements.js'];

async function main() {
  const args = process.argv.slice(2);
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const app = option('--app'), web = option('--web');
  if (!app && !web) throw new Error('Usage: node patch-task-interactions.mjs [--app extracted-asar] [--web web-root]');
  for (const [root, paths, patch] of [[app, taskNativePaths, patchTaskNativeFile], [web, taskWebPaths, patchTaskWebFile]]) {
    if (!root) continue;
    for (const relative of paths) {
      const file = path.join(root, relative);
      let original;
      try { original = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      const next = patch(relative, original);
      if (next !== original) { await fs.writeFile(file, next); console.log(relative); }
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
