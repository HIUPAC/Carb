const isZh = () => document.documentElement.lang.toLowerCase().startsWith('zh');
const text = (zh, en) => isZh() ? zh : en;
let activeMenu;
let sequence = 0;

function closeMenu(restoreFocus = true) {
  if (!activeMenu) return;
  const { element, trigger } = activeMenu;
  activeMenu = undefined;
  element.remove();
  trigger?.removeAttribute('aria-expanded');
  if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
}

function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT|not exist|cannot find/i.test(message)) return text('文件已移动或尚未生成，请确认路径后重试。', 'The file has moved or has not been created yet. Check the path and retry.');
  if (/program and script/i.test(message)) return text('请在编辑器中打开程序或脚本文件，或打开所在文件夹。', 'Open program and script files in your editor, or open the containing folder.');
  if (/outside.*project|Network file|Invalid project/i.test(message)) return text('该路径不在当前项目内。', 'This path is outside the current project.');
  return text('操作未完成：', 'Could not complete the action: ') + message;
}

async function copyValue(value) {
  if (window.harness?.writeClipboardText) await window.harness.writeClipboardText(value);
  else await navigator.clipboard.writeText(value);
}

// Keep renderer paths useful for copying; the main process still validates every open.
function absoluteProjectFile(value, projectPath) {
  if (typeof value !== 'string' || typeof projectPath !== 'string' || /[\0\r\n]/.test(value + projectPath)) return;
  const normalize = input => {
    const path = input.replaceAll('\\', '/');
    const drive = /^[a-z]:\//i.test(path) ? path.slice(0, 2).toUpperCase() : '';
    if ((!drive && !path.startsWith('/')) || path.startsWith('//')) return;
    const parts = [];
    for (const part of path.slice(drive ? 3 : 1).split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) return; parts.pop(); }
      else parts.push(part);
    }
    return (drive ? drive + '/' : '/') + parts.join('/');
  };
  const root = normalize(projectPath);
  if (!root) return;
  const input = value.replaceAll('\\', '/');
  if (input.startsWith('//') || (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^[a-z]:\//i.test(input))) return;
  const resolved = normalize(/^(?:[a-z]:\/|\/)/i.test(input) ? input : root.replace(/\/$/, '') + '/' + input);
  if (!resolved) return;
  const compare = path => /^[a-z]:\//i.test(root) ? path.toLowerCase() : path;
  const boundary = root.endsWith('/') ? root : root + '/';
  if (compare(resolved) !== compare(root) && !compare(resolved).startsWith(compare(boundary))) return;
  return resolved;
}

const scriptFile = value => /\.(?:exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jsx|mjs|cjs|jse|wsf|wsh|scr|cpl|msi|msp|lnk|url|app|sh|command|py|pyw|rb|pl|php|lua|jar|hta|reg|scf)$/i.test(value);

function showMenu(trigger, kind, value, projectPath, pointer) {
  closeMenu(false);
  const bridge = window.harness;
  const resolved = kind === 'file' ? absoluteProjectFile(value, projectPath) : value;
  if (resolved) value = resolved;
  const menu = document.createElement('section');
  menu.className = 'carb-link-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', kind === 'file' ? text('文件操作', 'File actions') : text('链接操作', 'Link actions'));
  menu.id = `carb-link-menu-${++sequence}`;
  const caption = document.createElement('p');
  caption.className = 'carb-link-menu__path';
  caption.textContent = value;
  caption.title = value;
  menu.append(caption);
  const error = document.createElement('p');
  error.className = 'carb-link-menu__error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const items = [];
  const add = (label, run, enabled = true) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'carb-link-menu__action';
    button.setAttribute('role', 'menuitem');
    button.textContent = label;
    button.disabled = !enabled;
    button.addEventListener('click', async () => {
      if (menu.dataset.busy) return;
      menu.dataset.busy = 'true';
      menu.setAttribute('aria-busy', 'true');
      error.hidden = true;
      try {
        await run();
        if (activeMenu?.element === menu) closeMenu();
      } catch (reason) {
        error.textContent = errorMessage(reason);
        error.hidden = false;
        delete menu.dataset.busy;
        menu.removeAttribute('aria-busy');
      }
    });
    menu.append(button);
    items.push(button);
  };
  if (kind === 'file') {
    add(text('打开文件', 'Open file'), () => bridge.openProjectFile(value, projectPath), Boolean(resolved && !scriptFile(value) && bridge?.openProjectFile));
    add(text('打开所在文件夹', 'Open containing folder'), () => bridge.openProjectFolder(value, projectPath), Boolean(resolved && bridge?.openProjectFolder));
    add(text('在文件夹中显示', 'Show in folder'), () => bridge.revealProjectFile(value, projectPath), Boolean(resolved && bridge?.revealProjectFile));
    add(text('复制绝对路径', 'Copy absolute path'), () => copyValue(value), Boolean(resolved));
    if (!resolved || scriptFile(value)) {
      error.textContent = !resolved ? text('该路径不在当前项目内。', 'This path is outside the current project.')
        : text('请定位到文件夹，在编辑器中查看程序或脚本。', 'Locate the file and view programs or scripts in your editor.');
      error.hidden = false;
    }
  } else {
    add(text('打开链接', 'Open link'), () => bridge?.openTaskExternal ? bridge.openTaskExternal(value)
      : bridge?.openExternal ? bridge.openExternal(value) : window.open(value, '_blank', 'noopener,noreferrer'));
    add(text('复制链接', 'Copy link'), () => copyValue(value));
  }
  menu.append(error);
  menu.addEventListener('keydown', event => {
    const enabled = items.filter(item => !item.disabled);
    const index = enabled.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = enabled[(index + 1) % enabled.length];
    else if (event.key === 'ArrowUp') next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled.at(-1);
    else if (event.key === 'Tab') { closeMenu(); return; }
    if (next) { event.preventDefault(); next.focus(); }
  });
  document.body.append(menu);
  activeMenu = { element: menu, trigger };
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'true');
  const rect = trigger.getBoundingClientRect();
  const x = pointer?.clientX ?? rect.left;
  const y = pointer?.clientY ?? rect.bottom + 6;
  const padding = 10;
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(padding, Math.min(x, window.innerWidth - bounds.width - padding))}px`;
  menu.style.top = `${Math.max(padding, Math.min(y, window.innerHeight - bounds.height - padding))}px`;
  items.find(item => !item.disabled)?.focus({ preventScroll: true });
}

function linkTarget(target) {
  const file = target.closest('.carb-file-action[data-carb-file-path][data-carb-project-path]');
  if (file) return { trigger: file, kind: 'file', value: file.dataset.carbFilePath, projectPath: file.dataset.carbProjectPath };
  const anchor = target.closest('.md a[href]');
  if (!anchor) return;
  const raw = anchor.getAttribute('href');
  try {
    const url = new URL(raw);
    if (['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password)
      return { trigger: anchor, kind: 'url', value: url.href };
  } catch { /* Incomplete streamed destinations become interactive when complete. */ }
}

document.addEventListener('click', event => {
  if (!(event.target instanceof Element) || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const target = linkTarget(event.target);
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showMenu(target.trigger, target.kind, target.value, target.projectPath);
}, true);
document.addEventListener('contextmenu', event => {
  if (!(event.target instanceof Element)) return;
  const target = linkTarget(event.target);
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showMenu(target.trigger, target.kind, target.value, target.projectPath, event);
}, true);
document.addEventListener('pointerdown', event => {
  if (activeMenu && !activeMenu.element.contains(event.target) && !activeMenu.trigger.contains(event.target)) closeMenu(false);
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && activeMenu) { event.preventDefault(); event.stopPropagation(); closeMenu(); }
}, true);
document.addEventListener('scroll', event => {
  if (activeMenu && !activeMenu.element.contains(event.target)) closeMenu(false);
}, true);
window.addEventListener('resize', () => closeMenu(false));

const deliverySignatures = new WeakMap();
function fileDetails(value) {
  const name = value.split('/').at(-1) || value;
  const extension = name.includes('.') ? name.split('.').at(-1).toLowerCase() : '';
  const types = { pdf: 'PDF', doc: 'WORD', docx: 'WORD', ppt: 'PPT', pptx: 'PPT', xls: 'EXCEL', xlsx: 'EXCEL', csv: 'CSV', md: 'MD', html: 'HTML', htm: 'HTML', zip: 'ZIP', png: 'PNG', jpg: 'JPG', jpeg: 'JPG', svg: 'SVG', mp4: 'MP4' };
  const hint = scriptFile(value) ? text('在文件夹中定位后，使用编辑器查看。', 'Locate this file and view it in your editor.')
    : ['md', 'txt', 'json', 'yaml', 'yml'].includes(extension) ? text('使用系统默认应用打开，也可在文件夹中选择编辑器。', 'Open with your default app, or choose an editor from the containing folder.')
      : text('使用系统默认应用打开；无法打开时，可先定位到文件夹。', 'Open with your default app. You can also locate it in the containing folder.');
  return { name, type: types[extension] ?? text('文件', 'FILE'), hint };
}

function updateDelivery(reply) {
  if (!reply.isConnected) return;
  const existing = reply.querySelector(':scope > .carb-delivery');
  if (reply.classList.contains('is-streaming')) { existing?.remove(); deliverySignatures.delete(reply); return; }
  const files = new Map();
  for (const link of reply.querySelectorAll('.md .carb-file-action[data-carb-file-path][data-carb-project-path]')) {
    if (link.closest('.md-ahead, .carb-delivery')) continue;
    const projectPath = link.dataset.carbProjectPath;
    const value = absoluteProjectFile(link.dataset.carbFilePath, projectPath);
    if (!value) continue;
    const key = /^[a-z]:\//i.test(value) ? value.toLowerCase() : value;
    if (files.has(key)) continue;
    const details = fileDetails(value);
    const label = link.textContent.trim().replace(/\s+/g, ' ');
    const description = label && label !== details.name && label !== value && label !== link.dataset.carbFilePath ? label.slice(0, 180) : '';
    files.set(key, { value, projectPath, ...details, description });
  }
  const signature = JSON.stringify([isZh(), [...files.values()]]);
  if (existing && deliverySignatures.get(reply) === signature) return;
  deliverySignatures.set(reply, signature);
  existing?.remove();
  if (!files.size) return;
  const panel = document.createElement('section');
  panel.className = 'carb-delivery';
  panel.setAttribute('aria-label', text('文件与打开方式', 'Files and opening options'));
  const heading = document.createElement('h3');
  heading.className = 'carb-delivery__heading';
  heading.textContent = text('文件与打开方式', 'Files and opening options');
  const count = document.createElement('span');
  count.textContent = String(files.size);
  heading.append(count);
  panel.append(heading);
  const list = document.createElement('ul');
  list.className = 'carb-delivery__list';
  for (const file of files.values()) {
    const row = document.createElement('li');
    row.className = 'carb-delivery__file';
    const badge = document.createElement('span');
    badge.className = 'carb-delivery__type';
    badge.textContent = file.type;
    badge.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div');
    body.className = 'carb-delivery__body';
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'carb-file-action carb-delivery__name';
    name.dataset.carbFilePath = file.value;
    name.dataset.carbProjectPath = file.projectPath;
    name.textContent = file.name;
    name.setAttribute('aria-label', text('文件操作：', 'File actions: ') + file.name);
    body.append(name);
    if (file.description) {
      const description = document.createElement('p');
      description.className = 'carb-delivery__description';
      description.textContent = file.description;
      body.append(description);
    }
    const path = document.createElement('p');
    path.className = 'carb-delivery__path';
    path.textContent = file.value;
    path.title = file.value;
    const hint = document.createElement('p');
    hint.className = 'carb-delivery__hint';
    hint.textContent = file.hint;
    const actions = document.createElement('div');
    actions.className = 'carb-delivery__actions';
    actions.setAttribute('aria-label', file.name);
    const status = document.createElement('p');
    status.className = 'carb-delivery__status';
    status.setAttribute('role', 'status');
    status.hidden = true;
    const bridge = window.harness;
    const add = (label, run, enabled = true) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.disabled = !enabled;
      button.addEventListener('click', async () => {
        if (actions.dataset.busy) return;
        actions.dataset.busy = 'true';
        actions.setAttribute('aria-busy', 'true');
        status.hidden = true;
        try {
          await run();
          status.textContent = label === text('复制路径', 'Copy path') ? text('已复制绝对路径', 'Absolute path copied') : text('已发送打开请求', 'Open request sent');
          status.removeAttribute('data-error');
        } catch (error) {
          status.textContent = errorMessage(error);
          status.dataset.error = 'true';
        } finally {
          status.hidden = false;
          delete actions.dataset.busy;
          actions.removeAttribute('aria-busy');
        }
      });
      actions.append(button);
    };
    add(text('打开文件', 'Open file'), () => bridge.openProjectFile(file.value, file.projectPath), Boolean(!scriptFile(file.value) && bridge?.openProjectFile));
    add(text('定位文件', 'Show in folder'), () => bridge.revealProjectFile(file.value, file.projectPath), Boolean(bridge?.revealProjectFile));
    add(text('复制路径', 'Copy path'), () => copyValue(file.value));
    body.append(path, hint, actions, status);
    row.append(badge, body);
    list.append(row);
  }
  panel.append(list);
  reply.append(panel);
}

const pendingReplies = new Set();
let deliveryFrame;
function queueDelivery(node) {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element || element.closest('.carb-delivery')) return;
  const reply = element.closest('.reply');
  if (reply) pendingReplies.add(reply);
  for (const child of element.querySelectorAll('.reply')) pendingReplies.add(child);
  if (!pendingReplies.size || deliveryFrame) return;
  deliveryFrame = requestAnimationFrame(() => {
    deliveryFrame = undefined;
    for (const item of pendingReplies) updateDelivery(item);
    pendingReplies.clear();
  });
}
new MutationObserver(mutations => {
  for (const mutation of mutations) {
    if (mutation.type === 'attributes' && mutation.target === document.documentElement) queueDelivery(document.body);
    else {
      queueDelivery(mutation.target);
      for (const node of mutation.addedNodes) if (node instanceof Element && !node.matches('.carb-delivery')) queueDelivery(node);
    }
  }
}).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-carb-file-path', 'data-carb-project-path', 'lang'] });
queueDelivery(document.body);

globalThis.__carbTaskActionsReady = true;
