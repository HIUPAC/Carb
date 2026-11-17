const key = 'carb.welcomeLetter.v1';
const groupUrl = 'https://qm.qq.com/q/3iwJUQLaP0';

// Only a real onboarding completion sets pending. Reopening the application
// before the letter is dismissed will show it again.
export function showWelcomeLetter() {
  try { if (localStorage.getItem(key) === 'done') return; localStorage.setItem(key, 'pending'); } catch {}
  setTimeout(render, 0);
}

function render() {
  if (document.getElementById('carb-welcome-letter')) return;
  const previousFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.id = 'carb-welcome-letter';
  backdrop.innerHTML = `<div class="carb-letter-dialog" role="dialog" aria-modal="true" aria-labelledby="carb-letter-title"><h1 id="carb-letter-title">致用户的一封信</h1><div class="carb-letter-body"><p>亲爱的用户：</p><p>你是否面对飞速发展的AI世界感到些许陌生？面对Agent这类新概念，不知道该如何上手尝试？</p><p>我们打造这款软件，正是为了解决这样的困惑。我们面向新手小白，尽力把复杂的AI技术简化，做到简单易懂、轻松上手，降低AI的入门门槛。如果你想要迈出探索AI的第一步，欢迎体验我们的软件。</p><p>同时我们也真诚向你说明：本软件定位为AI基础入门工具。如果你有着专业层面的开发、生产需求，或是本身就是行业专业人士，我们建议你选择Codex、DeepSeek Harness 等专业工具开展工作，它们更适配专业场景。</p><p>愿你始终怀揣一份热爱，在AI的世界里不断探索、不断成长。在使用过程中，无论遇到疑惑或是想法建议，都欢迎加入我们的交流群一起沟通。</p><p>群聊链接：<a href="${groupUrl}" target="_blank" rel="noopener noreferrer">加入群聊</a></p><p>期待与你一同前行。</p></div><div class="carb-letter-actions"><button type="button">开始使用</button></div><p class="carb-letter-error" role="alert" hidden></p></div>`;
  document.body.append(backdrop);
  const link = backdrop.querySelector('a');
  const close = backdrop.querySelector('button');
  const dismiss = () => { try { localStorage.setItem(key, 'done'); } catch {} backdrop.remove(); previousFocus?.focus?.(); };
  close.addEventListener('click', dismiss);
  backdrop.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if (event.key === 'Tab') {
      if (event.shiftKey && document.activeElement === link) { event.preventDefault(); close.focus(); }
      else if (!event.shiftKey && document.activeElement === close) { event.preventDefault(); link.focus(); }
    }
  });
  link.addEventListener('click', async event => {
    const bridge = window.carb ?? window.harness;
    if (!bridge?.openExternal) return;
    event.preventDefault();
    try { await bridge.openExternal(groupUrl); }
    catch { const error = backdrop.querySelector('.carb-letter-error'); error.hidden = false; error.textContent = '无法打开浏览器，请稍后重试。'; }
  });
  close.focus();
}

try {
  if (localStorage.getItem(key) === 'pending') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true });
    else setTimeout(render, 0);
  }
} catch {}
