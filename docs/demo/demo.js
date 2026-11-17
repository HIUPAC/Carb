'use strict';

// A self-contained product walkthrough. It never calls a model or reads user files.
const scenarios = {
  website: {
    project: '我的产品网站', title: '让首页更好用', caption: '从目标到可检查的改动',
    description: '从阅读文件开始，到检查每一处改动。',
    prompt: '请优化这个产品网站的手机布局，让小屏幕上的功能卡片按一列显示。',
    files: {
      'index.html': '<main>\n  <h1>让好想法，成为作品。</h1>\n  <section class="features">\n    <article>介绍你的产品</article>\n    <article>分享你的作品</article>\n  </section>\n</main>',
      'styles.css': '.features {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: 24px;\n}',
    },
    steps: [
      ['阅读项目文件', '定位 index.html 与 styles.css 中的布局'],
      ['补充小屏幕样式', '为功能卡片添加响应式断点'],
      ['整理改动与检查结果', '把修改放入 Review，方便逐行复核'],
    ],
    outputFile: 'styles.css',
    output: '.features {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: 24px;\n}\n\n@media (max-width: 760px) {\n  .features {\n    grid-template-columns: 1fr;\n    gap: 16px;\n  }\n}',
    result: '示例已添加小屏幕布局。打开 Review，可以看到新增的样式和具体行数。',
    terminal: '$ 项目检查（示例）\n\n✓ 读取页面与样式文件\n✓ 已生成响应式样式改动\n→ 下一步：复核 diff，检查真实设备布局',
  },
  notes: {
    project: '用户访谈资料', title: '把资料整理成结论', caption: '让文件成为可用的成果',
    description: '把零散记录，变成能继续使用的资料。',
    prompt: '请阅读访谈记录，按用户需求整理一份摘要，保留后续需要确认的问题。',
    files: {
      '访谈记录.md': '# 用户访谈\n\n- 小林：希望第一次使用时有步骤引导。\n- 阿楠：常常找不到生成后的文件。\n- 小林：修改完成后想看看具体改了什么。\n- 待确认：大家最常用的文件类型？',
      'README.md': '# 项目说明\n\n目标：将访谈记录归纳为主题和待办。\n输出：Markdown 格式的需求摘要。\n要求：保留仍需确认的信息。',
    },
    steps: [
      ['阅读访谈与整理要求', '先了解上下文，不遗漏原始问题'],
      ['提取需求主题', '归纳上手引导、文件定位、变更检查'],
      ['生成摘要文件', '保留待确认项，并说明输出位置'],
    ],
    outputFile: '需求摘要.md',
    output: '# 需求摘要\n\n## 主要主题\n1. 上手引导：首次使用需要清楚的步骤。\n2. 文件定位：输出结果需要容易找到。\n3. 变更检查：希望能查看具体的修改。\n\n## 待确认\n- 用户最常处理哪些文件类型？\n\n来源：访谈记录.md',
    result: '示例已生成「需求摘要.md」，包含三个主题和一项待确认问题。可以在文件面板中打开阅读。',
    terminal: '$ 文件任务（示例）\n\n✓ 已读取 2 个项目文件\n✓ 已整理主题与待确认信息\n✓ 输出：需求摘要.md\n→ 下一步：核对原始记录与摘要',
  },
  skill: {
    project: '每周项目周报', title: '给任务加一套方法', caption: '用 Skill 复用工作流程',
    description: '技能提供流程指引，项目文件提供上下文。',
    prompt: '使用已安装的周报整理技能，根据本周记录生成周报，列出进展、问题和下周计划。',
    files: {
      '本周记录.md': '# 本周记录\n\n完成：更新首页文案；修复手机布局。\n进行中：整理首次使用指引。\n问题：有两处帮助链接还需确认。\n下周：补齐指引并检查所有链接。',
      'SKILL.md': '---\nname: weekly-summary\ndescription: 按固定结构整理项目周报\n---\n\n1. 阅读本周记录，保留事实与待办。\n2. 按进展、问题、计划组织内容。\n3. 将周报保存为 Markdown。',
    },
    steps: [
      ['读取已安装的技能', '使用 weekly-summary 的整理步骤'],
      ['结合项目记录执行', '区分已完成、进行中和待确认事项'],
      ['输出结构化周报', '把流程落实为项目中的 Markdown 文件'],
    ],
    outputFile: '本周周报.md',
    output: '# 本周周报\n\n## 项目进展\n- 已完成：首页文案、手机布局。\n- 进行中：首次使用指引。\n\n## 当前问题\n- 两处帮助链接需要确认。\n\n## 下周计划\n- 完成使用指引。\n- 检查全部帮助链接。',
    result: '示例已按 Skill 中的步骤生成周报。Skill 负责给出方法，任务结果仍然可以逐项检查。',
    terminal: '$ 技能任务（示例）\n\n✓ 已读取 weekly-summary / SKILL.md\n✓ 已读取项目记录\n✓ 输出：本周周报.md\n→ 技能是流程指引，可通过 ZIP 或文件夹安装',
  },
};

const $ = id => document.getElementById(id);
let current = 'website';
let files = {};
let selectedFile = '';
let completed = false;
let busy = false;
let timer = null;
let generation = 0;

function announce(message) { $('announcer').textContent = message; }

function showPanel(panel) {
  ['files', 'review', 'terminal'].forEach(name => {
    $(name + 'Panel').hidden = name !== panel;
    $(name + 'Tab').setAttribute('aria-selected', String(name === panel));
    $(name + 'Tab').tabIndex = name === panel ? 0 : -1;
  });
}

function showFile(name) {
  selectedFile = name;
  $('fileName').textContent = name;
  $('fileContent').textContent = files[name];
  document.querySelectorAll('[data-file]').forEach(button => {
    const active = button.dataset.file === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function renderFiles() {
  const list = $('fileList');
  list.replaceChildren();
  Object.keys(files).forEach(name => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.file = name;
    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.textContent = name.endsWith('.css') ? '#' : '▤';
    const label = document.createElement('span');
    label.textContent = name;
    button.append(icon, label);
    if (completed && name === scenarios[current].outputFile) {
      const status = document.createElement('span');
      status.className = 'file-status';
      status.textContent = Object.hasOwn(scenarios[current].files, name) ? 'M' : 'A';
      button.append(status);
    }
    button.addEventListener('click', () => showFile(name));
    list.append(button);
  });
  $('fileCount').textContent = Object.keys(files).length;
  showFile(selectedFile || Object.keys(files)[0]);
}

function renderDiff() {
  const config = scenarios[current];
  const original = config.files[config.outputFile];
  const originalLines = original ? original.split('\n') : [];
  const outputLines = config.output.split('\n');
  const diffLines = outputLines.map((text, index) => [index < originalLines.length ? 'context' : 'add', text]);
  $('diffStats').textContent = '+' + (outputLines.length - originalLines.length) + ' 行 · 1 个' + (original ? '文件' : '新文件');
  $('reviewNote').textContent = '以下为预设示例差异。实际任务中，建议结合文件与验证结果复核。';
  const diff = $('diff');
  diff.replaceChildren();
  const title = document.createElement('div');
  title.className = 'diff-file';
  title.textContent = config.outputFile;
  diff.append(title);
  diffLines.forEach(([kind, text], index) => {
    const row = document.createElement('div');
    row.className = 'diff-line ' + kind;
    const number = document.createElement('span');
    number.textContent = index + 1;
    const line = document.createElement('span');
    line.textContent = (kind === 'add' ? '+ ' : '  ') + text;
    row.append(number, line);
    diff.append(row);
  });
}

function selectScenario(key) {
  generation++;
  clearTimeout(timer);
  current = key;
  const config = scenarios[key];
  completed = false;
  busy = false;
  files = { ...config.files };
  selectedFile = Object.keys(files)[0];
  $('projectName').textContent = config.project;
  $('projectPath').textContent = config.project + ' /';
  $('threadName').textContent = config.title;
  $('threadCaption').textContent = config.caption;
  $('taskTitle').textContent = config.title;
  $('scenarioDescription').textContent = config.description;
  $('prompt').value = config.prompt;
  $('prompt').disabled = false;
  $('requestPreview').textContent = config.prompt;
  $('execution').hidden = true;
  $('result').hidden = true;
  $('waitingHint').hidden = false;
  $('steps').replaceChildren();
  $('diff').replaceChildren();
  $('diffStats').textContent = '等待任务执行';
  $('reviewNote').textContent = '任务完成后，在这里逐行检查示例改动。';
  $('reviewCount').textContent = '0';
  $('terminalOutput').textContent = '$ 项目终端\n\n等待演示任务开始…\n\n本面板展示预设过程，不执行本机命令。';
  $('taskState').textContent = '准备就绪';
  $('taskState').className = 'task-state';
  $('run').disabled = false;
  $('run').replaceChildren(document.createTextNode('开始演示 '));
  const arrow = document.createElement('span');
  arrow.textContent = '↑';
  $('run').append(arrow);
  document.querySelectorAll('[data-scenario]').forEach(button => {
    const active = button.dataset.scenario === key;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderFiles();
  showPanel('files');
  $('conversationScroll').scrollTop = 0;
}

function finishRun(config) {
  completed = true;
  busy = false;
  files[config.outputFile] = config.output;
  selectedFile = config.outputFile;
  renderFiles();
  renderDiff();
  $('reviewCount').textContent = '1';
  $('terminalOutput').textContent = config.terminal;
  $('taskState').textContent = '演示完成';
  $('taskState').className = 'task-state done';
  const result = $('result');
  result.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = '✓ 结果已准备好，请检查。';
  const text = document.createElement('p');
  text.textContent = config.result;
  const review = document.createElement('button');
  review.type = 'button';
  review.textContent = '查看文件变更 →';
  review.addEventListener('click', () => {
    showPanel('review');
    $('reviewTab').focus({ preventScroll: true });
  });
  result.append(title, text, review);
  result.hidden = false;
  $('run').disabled = false;
  $('run').textContent = '再演示一次 ↻';
  $('prompt').disabled = false;
  $('conversationScroll').scrollTo({ top: $('conversationScroll').scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  announce('演示已完成，已生成示例文件，可切换到 Review 查看改动。');
}

function run() {
  if (busy) return;
  const prompt = $('prompt').value.trim();
  if (!prompt) { $('prompt').focus(); return; }
  const config = scenarios[current];
  if (completed) {
    const saved = prompt;
    selectScenario(current);
    $('prompt').value = saved;
  }
  const token = ++generation;
  busy = true;
  $('requestPreview').textContent = prompt;
  $('waitingHint').hidden = true;
  $('execution').hidden = false;
  $('result').hidden = true;
  $('prompt').disabled = true;
  $('run').disabled = true;
  $('run').textContent = '演示进行中…';
  $('taskState').textContent = '正在演示';
  $('taskState').className = 'task-state running';
  $('stepCount').textContent = '0 / 3';
  $('steps').replaceChildren();
  config.steps.forEach(([title, description]) => {
    const item = document.createElement('li');
    const icon = document.createElement('span');
    icon.className = 'step-icon';
    icon.textContent = '·';
    const copy = document.createElement('div');
    copy.className = 'step-copy';
    const heading = document.createElement('b');
    heading.textContent = title;
    const caption = document.createElement('small');
    caption.textContent = description;
    copy.append(heading, caption);
    item.append(icon, copy);
    $('steps').append(item);
  });
  const items = [...$('steps').children];
  let index = 0;
  function advance() {
    if (token !== generation) return;
    if (index > 0) {
      items[index - 1].className = 'done';
      items[index - 1].querySelector('.step-icon').textContent = '✓';
    }
    $('stepCount').textContent = index + ' / 3';
    if (index === items.length) { finishRun(config); return; }
    items[index].className = 'running';
    items[index].querySelector('.step-icon').textContent = '';
    $('terminalOutput').textContent = '$ 演示任务\n\n' + config.steps.slice(0, index + 1).map(([title], i) => (i === index ? '… ' : '✓ ') + title).join('\n') + '\n\n预设示例正在展示中。';
    index++;
    timer = setTimeout(advance, 850);
  }
  advance();
  announce('演示已开始。任务说明保留在对话中，以下展示当前场景的预设流程。');
}

document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => {
  selectScenario(button.dataset.scenario);
  announce('已切换到' + scenarios[current].title + '演示。');
}));
document.querySelectorAll('[data-panel]').forEach(button => button.addEventListener('click', () => showPanel(button.dataset.panel)));
$('reset').addEventListener('click', () => { selectScenario(current); announce('当前演示已重置。'); });
$('taskForm').addEventListener('submit', event => { event.preventDefault(); run(); });
$('prompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); run(); }
});
document.querySelector('.inspector-tabs').addEventListener('keydown', event => {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('[data-panel]')];
  const index = tabs.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  showPanel(tabs[next].dataset.panel);
});
selectScenario('website');
