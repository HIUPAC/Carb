(() => {
  'use strict';
  const menuButton = document.getElementById('menuToggle');
  const menu = document.getElementById('navLinks');
  function closeMenu() {
    menu.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', '打开导航菜单');
  }
  menuButton.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
  });
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.classList.contains('open')) {
      closeMenu();
      menuButton.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.nav') && menu.classList.contains('open')) closeMenu();
  });
  const tabs = [...document.querySelectorAll('[data-guide]')];
  function selectGuide(name, focus = false) {
    tabs.forEach(tab => {
      const selected = tab.dataset.guide === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
      if (selected && focus) tab.focus();
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectGuide(tab.dataset.guide));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        selectGuide(tabs[next].dataset.guide, true);
      }
    });
  });
  document.querySelectorAll('[data-guide-link]').forEach(link => link.addEventListener('click', () => selectGuide(link.dataset.guideLink)));
})();
