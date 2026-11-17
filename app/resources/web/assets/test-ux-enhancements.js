const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const completedPreflights = new Set();
const rpcSockets = new Set();
const rpcPending = new Map();
const NativeWebSocket = window.WebSocket;
let activeModal;
let bypassNextClick = false;
let modalSequence = 0;
let rpcCounter = 0;

const isZh = () => document.documentElement.lang.toLowerCase().startsWith("zh");
const copy = (zh, en) => isZh() ? zh : en;
const isElement = value => value instanceof Element;

function observeRpcSocket(socket) {
  const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? "";
  const sources = policy.match(/(?:^|;)\s*connect-src\s+([^;]+)/i)?.[1]?.split(/\s+/) ?? [];
  let endpoint;
  try { endpoint = new URL(socket.url); } catch { return; }
  const allowed = sources.some(source => {
    try {
      const candidate = new URL(source);
      return candidate.protocol === "ws:" && candidate.hostname === "127.0.0.1" && candidate.origin === endpoint.origin && endpoint.pathname === "/";
    } catch { return false; }
  });
  if (!allowed || socket.__testUxObserved) return;
  socket.__testUxObserved = true;
  rpcSockets.add(socket);
  const failSocket = () => {
    rpcSockets.delete(socket);
    for (const [id, pending] of rpcPending) {
      if (pending.socket !== socket) continue;
      clearTimeout(pending.timer);
      rpcPending.delete(id);
      pending.reject(new Error(copy("应用连接已断开。", "The app connection closed.")));
    }
  };
  socket.addEventListener("open", () => rpcSockets.add(socket));
  socket.addEventListener("close", failSocket);
  socket.addEventListener("error", failSocket);
  socket.addEventListener("message", event => {
    if (typeof event.data !== "string") return;
    let frame;
    try { frame = JSON.parse(event.data); } catch { return; }
    if (frame?.id == null) return;
    const pending = rpcPending.get(String(frame.id));
    if (!pending || pending.socket !== socket) return;
    rpcPending.delete(String(frame.id));
    clearTimeout(pending.timer);
    if (frame.error != null) pending.reject(new Error(frame.error.message || String(frame.error)));
    else pending.resolve(frame.result);
  });
  if (socket.readyState === NativeWebSocket.OPEN) rpcSockets.add(socket);
}

class UxObservedWebSocket extends NativeWebSocket {
  constructor(...args) {
    super(...args);
    observeRpcSocket(this);
  }
}
window.WebSocket = UxObservedWebSocket;

async function rpc(method, params) {
  const deadline = Date.now() + 12000;
  let socket;
  while (Date.now() < deadline) {
    socket = [...rpcSockets].find(candidate => candidate.readyState === NativeWebSocket.OPEN);
    if (!socket && ![...rpcSockets].some(candidate => candidate.readyState === NativeWebSocket.CONNECTING)) {
      const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? "";
      const source = policy.match(/(?:^|;)\s*connect-src\s+([^;]+)/i)?.[1]?.split(/\s+/).find(value => /^ws:\/\/127\.0\.0\.1(?::\d+)?\/?$/i.test(value));
      if (source) {
        try { new UxObservedWebSocket(source); } catch { /* Retry until the main socket is ready. */ }
      }
    }
    if (socket) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!socket) throw new Error(copy("应用本地连接尚未就绪，请稍后重试。", "The app connection is not ready. Try again shortly."));
  const id = `test-ux-${Date.now()}-${++rpcCounter}`;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      rpcPending.delete(id);
      reject(new Error(copy("模型响应超时，请检查连接后重试。", "The model request timed out. Check the connection and retry.")));
    }, 60000);
    rpcPending.set(id, { resolve, reject, timer, socket });
  });
  try { socket.send(JSON.stringify({ id, method, params })); }
  catch (error) {
    const pending = rpcPending.get(id);
    rpcPending.delete(id);
    clearTimeout(pending?.timer);
    throw error;
  }
  return result;
}

function classify(text) {
  const ppt = /\b(pptx?|powerpoint|slides?|slide deck)\b|演示文稿|幻灯片|PPT制作|PPT设计|制作PPT/i.test(text);
  const ui = /\b(ui|ux|user interface|web design|interface design)\b|程序UI|UI设计|界面设计|软件界面|页面设计|交互设计|前端页面/i.test(text);
  if (ppt && ui) return "both";
  if (ppt) return "ppt";
  if (ui) return "ui";
  return "";
}

function expertRole(text) {
  const kind = classify(text);
  if (kind === "ppt") return copy("演示文稿策划与视觉设计专家", "presentation strategist and visual designer");
  if (kind === "ui") return copy("产品体验与界面设计专家", "product UX and interface design expert");
  if (kind === "both") return copy("产品设计与演示表达顾问", "product design and presentation consultant");
  if (/代码|程序|开发|bug|实现|code|software|debug|implement/i.test(text)) return copy("资深软件工程师", "senior software engineer");
  if (/分析|研究|调研|报告|analysis|research|report/i.test(text)) return copy("资深研究与分析顾问", "senior research and analysis consultant");
  return copy("专业任务顾问", "professional task specialist");
}

function optimizedPrompt(text) {
  const trimmed = text.trim();
  const role = expertRole(trimmed);
  return copy(
    `请你作为${role}，在保留原始目标、事实和约束的前提下完成以下任务。\n\n【我的原始请求】\n${trimmed}\n\n【执行方式】\n1. 先识别目标用户、使用场景、输入材料与预期交付物。\n2. 如果缺少会明显影响结果的信息，通过结构化提问工具提出最多 3 个简短问题，每题尽量给出 2–4 个可点击的有效选项，并始终保留自由输入；信息足够时直接开始。\n3. 提供结构清晰、可直接使用的成果，并说明关键假设与需要我补充的内容。\n4. 不编造事实；遵守项目现有技术、格式和风格约束。`,
    `Act as a ${role} and complete the task while preserving my original goals, facts, and constraints.\n\n[Original request]\n${trimmed}\n\n[How to proceed]\n1. Identify the audience, use case, available inputs, and expected deliverables.\n2. If missing information would materially change the result, use the structured user-input tool to ask up to three concise questions with two to four useful choices and a separate custom answer; otherwise start.\n3. Provide a clear, usable result and state key assumptions or anything I need to supply.\n4. Do not invent facts. Follow the project's existing technical, format, and style constraints.`
  );
}

function closeModal() {
  if (!activeModal) return;
  const { backdrop, restoreFocus } = activeModal;
  activeModal = undefined;
  backdrop.remove();
  restoreFocus?.focus?.({ preventScroll: true });
}

function showModal({ title, hint, fields, value, onConfirm, confirmLabel, onSkip, skipLabel, focusTarget }) {
  closeModal();
  const sequence = ++modalSequence;
  const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const backdrop = document.createElement("div");
  backdrop.className = "test-ux-modal-backdrop";
  backdrop.dataset.testUxModal = String(sequence);
  const dialog = document.createElement("section");
  dialog.className = "test-ux-modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const titleId = `test-ux-title-${sequence}`;
  dialog.setAttribute("aria-labelledby", titleId);

  const head = document.createElement("header");
  head.className = "test-ux-modal__head";
  const titleWrap = document.createElement("div");
  const titleNode = document.createElement("h2");
  titleNode.className = "test-ux-modal__title";
  titleNode.id = titleId;
  titleNode.textContent = title;
  const hintNode = document.createElement("p");
  hintNode.className = "test-ux-modal__hint";
  hintNode.textContent = hint;
  titleWrap.append(titleNode, hintNode);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "test-ux-modal__close";
  close.setAttribute("aria-label", copy("关闭", "Close"));
  close.textContent = "×";
  close.addEventListener("click", closeModal);
  head.append(titleWrap, close);

  const body = document.createElement("div");
  body.className = "test-ux-modal__body";
  const controls = [];
  for (const field of fields) {
    const label = document.createElement(field.options?.length ? "div" : "label");
    label.className = "test-ux-modal__label";
    const caption = document.createElement("span");
    caption.textContent = field.label;
    let control;
    if (field.type === "textarea") {
      control = document.createElement("textarea");
      control.value = value ?? "";
      control.spellcheck = true;
    } else {
      control = document.createElement("input");
      control.type = "text";
      control.autocomplete = "off";
      control.placeholder = field.placeholder ?? "";
    }
    control.dataset.field = field.id;
    if (field.required) control.required = true;
    if (field.options?.length) {
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
    label.append(control);
    body.append(label);
    controls.push(control);
  }
  const error = document.createElement("p");
  error.className = "test-ux-modal__error";
  error.hidden = true;
  error.setAttribute("role", "status");
  body.append(error);

  const footer = document.createElement("footer");
  footer.className = "test-ux-modal__footer";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "test-ux-modal__button";
  cancel.textContent = copy("取消", "Cancel");
  cancel.addEventListener("click", closeModal);
  footer.append(cancel);
  if (onSkip) {
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "test-ux-modal__button";
    skip.textContent = skipLabel;
    skip.addEventListener("click", () => { closeModal(); onSkip(); });
    footer.append(skip);
  }
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "test-ux-modal__button test-ux-modal__button--primary";
  confirm.textContent = confirmLabel;
  confirm.addEventListener("click", () => {
    const result = onConfirm(controls.map(control => ({ id: control.dataset.field, value: [control.dataset.choice, control.value.trim()].filter(Boolean).join(copy("；", "; ")) })));
    if (result === false) {
      error.textContent = copy("请至少补充一项信息后继续。", "Please answer at least one question to continue.");
      error.hidden = false;
    }
  });
  footer.append(confirm);

  dialog.append(head, body, footer);
  backdrop.append(dialog);
  backdrop.addEventListener("mousedown", event => { if (event.target === backdrop) closeModal(); });
  backdrop.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); closeModal(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll("button, input, textarea, select, [tabindex]:not([tabindex='-1'])")]
      .filter(element => !element.disabled && !element.hidden);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.body.append(backdrop);
  activeModal = { backdrop, restoreFocus, controls, error, confirm };
  (focusTarget?.(controls) ?? controls[0] ?? close).focus({ preventScroll: true });
  return activeModal;
}

function applyTextarea(textarea, nextValue) {
  const prototype = Object.getPrototypeOf(textarea);
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(textarea, nextValue);
  else textarea.value = nextValue;
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
}

function send(composer) {
  const button = composer?.querySelector(".composer__send-beam .orb:not(.orb--stop)");
  if (!button || button.disabled) return;
  bypassNextClick = true;
  requestAnimationFrame(() => {
    if (button.isConnected && !button.disabled) button.click();
    else bypassNextClick = false;
  });
}

function preflightFields(kind) {
  const pptFields = [
    ["audience", copy("主要受众是谁？", "Who is the primary audience?")],
    ["purpose", copy("演示的目标或希望受众采取的行动是什么？", "What is the presentation goal or desired audience action?")],
    ["scope", copy("预计页数/时长，以及必须覆盖的内容有哪些？", "What length or slide count do you need, and what must be covered?")],
    ["style", copy("偏好的视觉风格、参考资料和交付格式是什么？", "What visual style, references, and output format do you prefer?")],
  ];
  const uiFields = [
    ["platform", copy("目标平台、设备和主要用户是谁？", "What platform, device, and primary users should this target?")],
    ["flow", copy("需要设计哪些页面、核心功能或用户流程？", "Which screens, core features, or user flows are in scope?")],
    ["style", copy("偏好的视觉风格、参考产品或图片是什么？", "What visual style, product references, or images should guide it?")],
    ["constraints", copy("已有技术栈、尺寸/适配要求或项目限制有哪些？", "What stack, sizing/responsive needs, or project constraints apply?")],
  ];
  const bothFields = [
    ["audience", copy("产品和演示各自面向哪些用户/受众？", "Who are the product users and presentation audience?")],
    ["scope", copy("需要的核心页面/流程、功能和演示重点是什么？", "Which core screens/flows, features, and presentation points are needed?")],
    ["style", copy("偏好的 UI 与 PPT 风格、参考资料是什么？", "What UI and slide styles or references do you prefer?")],
    ["constraints", copy("技术栈、交付格式、页数或其他限制有哪些？", "What stack, output formats, slide count, or other constraints apply?")],
  ];
  const pairs = kind === "ppt" ? pptFields : kind === "ui" ? uiFields : bothFields;
  const choices = {
      audience: copy(['团队内部', '客户与合作伙伴', '评审 / 投资人', '大众用户'], ['Internal team', 'Customers and partners', 'Reviewers / investors', 'General audience']),
      purpose: copy(['介绍与展示', '方案汇报', '教学培训', '争取决策支持'], ['Introduce and showcase', 'Present a proposal', 'Teach and train', 'Support a decision']),
      platform: copy(['桌面网页', '移动端', '桌面应用', '多端适配'], ['Desktop web', 'Mobile', 'Desktop app', 'Responsive across devices']),
      flow: copy(['首页与核心流程', '完善已有页面', '完整产品原型'], ['Home and core flow', 'Improve existing screens', 'Complete product prototype']),
      scope: kind === 'ppt' ? copy(['5–8 页精简版', '10–15 页标准版', '20 页以上详细版'], ['5–8 concise slides', '10–15 standard slides', '20+ detailed slides']) : copy(['核心流程', '完整方案', '先给初稿'], ['Core flow', 'Complete proposal', 'First draft']),
      style: copy(['简洁现代', '专业商务', '活泼创意', '沿用现有风格'], ['Clean and modern', 'Professional', 'Playful and creative', 'Follow existing style']),
      constraints: copy(['沿用现有项目', '优先可用原型', '需要响应式适配'], ['Use existing project', 'Prioritize a usable prototype', 'Responsive layout required'])
    };
    return pairs.map(([id, label]) => ({ id, label, type: 'input', options: choices[id] ?? [], placeholder: copy('自行填写（可留空）', 'Your own answer (optional)') }));
}

function startPreflight(composer, textarea, kind, original) {
  const title = kind === "ppt" ? copy("开始制作前，先补充演示信息", "A few details before creating the presentation")
    : kind === "ui" ? copy("开始设计前，先补充产品信息", "A few details before designing the interface")
      : copy("开始前，先补充设计与演示信息", "A few details before design and presentation work");
  const labels = preflightFields(kind);
  const names = new Map(labels.map(field => [field.id, field.label]));
  showModal({
    title,
    hint: copy("补充后会附在本次请求中再发送；没有把握的项目可以留空。", "Your answers will be attached to this request before it is sent. Leave uncertain items blank."),
    fields: labels,
    confirmLabel: copy("加入请求并发送", "Add answers and send"),
    skipLabel: copy("本次跳过", "Skip once"),
    onSkip: () => { completedPreflights.add(original); send(composer); },
    onConfirm: answers => {
      const supplied = answers.filter(answer => answer.value);
      if (!supplied.length) return false;
      const details = supplied.map(answer => `- ${names.get(answer.id)} ${answer.value}`).join("\n");
      const nextValue = `${textarea.value.trimEnd()}\n\n${copy("【补充信息】", "[Additional details]")}\n${details}`;
      completedPreflights.add(original);
      completedPreflights.add(nextValue.trim());
      closeModal();
      applyTextarea(textarea, nextValue);
      send(composer);
      return true;
    },
  });
}

function openOptimizer(textarea) {
  const original = textarea.value.trim();
  if (!original) return;
  const modal = showModal({
    title: copy("优化需求", "Refine request"),
    hint: copy("正在调用当前配置的模型优化需求；结果可继续修改，应用后由你决定是否发送。", "The active configured model is refining your request. Edit the result freely, then choose whether to send it."),
    fields: [{ id: "draft", label: copy("优化后的请求（可编辑）", "Refined request (editable)"), type: "textarea" }],
    value: copy("正在生成优化稿…", "Generating a refined draft…"),
    confirmLabel: copy("应用到输入框", "Apply to composer"),
    onConfirm: answers => {
      const result = answers[0]?.value;
      if (!result) return false;
      closeModal();
      applyTextarea(textarea, result);
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(result.length, result.length);
      return true;
    },
  });
  const editor = modal.controls[0];
  editor.disabled = true;
  modal.confirm.disabled = true;
  const kind = classify(original);
  const context = kind === "ppt" ? "ppt" : kind === "ui" ? "ui" : "general";
  void rpc("prompts.optimize", { prompt: original, context }).then(result => {
    if (!modal.backdrop.isConnected) return;
    if (typeof result?.optimizedPrompt !== "string" || !result.optimizedPrompt.trim())
      throw new Error(copy("模型返回了空结果。", "The model returned an empty result."));
    editor.value = result.optimizedPrompt.trim();
    editor.disabled = false;
    modal.confirm.disabled = false;
    editor.focus({ preventScroll: true });
  }).catch(error => {
    if (!modal.backdrop.isConnected) return;
    editor.value = optimizedPrompt(original);
    editor.disabled = false;
    modal.confirm.disabled = false;
    modal.error.textContent = copy(
      `AI 优化暂不可用：${error instanceof Error ? error.message : String(error)}。已生成本地结构化草稿，可编辑后应用。`,
      `AI refinement is unavailable: ${error instanceof Error ? error.message : String(error)}. A local structured draft is ready to edit and apply.`
    );
    modal.error.hidden = false;
    editor.focus({ preventScroll: true });
  });
}

function attachOptimizer(beam) {
  if (!(beam instanceof Element) || beam.closest(".composer__prompt")?.querySelector(".test-optimize-button")) return;
  const composer = beam.closest(".composer");
  const prompt = beam.closest(".composer__prompt");
  const textarea = composer?.querySelector("textarea");
  if (!composer || !prompt || !textarea || prompt.querySelector(".test-optimize-button")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "test-optimize-button";
  button.textContent = copy("优化", "Refine");
  button.setAttribute("aria-label", copy("优化当前需求", "Refine current request"));
  button.title = copy("生成可编辑的专业版请求", "Create an editable, structured version of this request");
  button.disabled = !textarea.value.trim();
  button.addEventListener("click", () => openOptimizer(textarea));
  textarea.addEventListener("input", () => { button.disabled = !textarea.value.trim(); });
  const tools = beam.closest(".tools");
  if (tools) tools.insertBefore(button, beam);
  else prompt.append(button);
}

function discover(root = document) {
  if (root instanceof Element && root.matches(".composer__send-beam")) attachOptimizer(root);
  root.querySelectorAll?.(".composer__send-beam").forEach(attachOptimizer);
}

discover();
new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) if (node instanceof Element) discover(node);
  }
}).observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("click", event => {
  if (bypassNextClick) { bypassNextClick = false; return; }
  if (event.defaultPrevented || !isElement(event.target)) return;
  const button = event.target.closest(".composer__send-beam .orb:not(.orb--stop)");
  if (!button) return;
  const composer = button.closest(".composer");
  const textarea = composer?.querySelector("textarea");
  const value = textarea?.value.trim();
  if (!textarea || !value) return;
  const kind = classify(value);
  if (!kind || completedPreflights.has(value)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  startPreflight(composer, textarea, kind, value);
}, true);

document.addEventListener("keydown", event => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || !(event.target instanceof HTMLTextAreaElement)) return;
  if (!event.target.closest(".composer")) return;
  const value = event.target.value.trim();
  const kind = classify(value);
  if (!kind || completedPreflights.has(value)) return;
  const composer = event.target.closest(".composer");
  event.preventDefault();
  event.stopImmediatePropagation();
  startPreflight(composer, event.target, kind, value);
}, true);

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && activeModal) { event.preventDefault(); closeModal(); }
}, true);

if (reduceMotion.matches) document.documentElement.dataset.testUxReducedMotion = "";
reduceMotion.addEventListener("change", () => {
  if (reduceMotion.matches) document.documentElement.dataset.testUxReducedMotion = "";
  else delete document.documentElement.dataset.testUxReducedMotion;
});




