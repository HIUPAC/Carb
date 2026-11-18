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

  const downloadModal = document.getElementById('downloadModal');
  const modalTitle = document.getElementById('downloadModalTitle');
  const modalDescription = document.getElementById('downloadModalDescription');
  const modalClose = downloadModal?.querySelector('[data-modal-close]');
  let lastModalTrigger = null;
  let closingAnimation = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function closeDownloadModal() {
    if (!downloadModal || downloadModal.hidden || closingAnimation) return;
    const finish = () => {
      downloadModal.hidden = true;
      document.body.classList.remove('modal-open');
      lastModalTrigger?.focus({ preventScroll: true });
      lastModalTrigger = null;
    };
    if (reducedMotion.matches || !downloadModal.animate) return finish();
    const animation = downloadModal.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 140, easing: 'ease-in', fill: 'forwards'
    });
    closingAnimation = animation;
    animation.finished.then(() => {
      if (closingAnimation !== animation) return;
      finish();
      closingAnimation = null;
      animation.cancel();
    }, () => {});
  }

  function openDownloadModal(trigger) {
    if (!downloadModal) return;
    closingAnimation?.cancel();
    closingAnimation = null;
    lastModalTrigger = trigger;
    const isRelease = trigger.dataset.downloadModal === 'releases';
    modalTitle.textContent = isRelease ? '选择版本来源' : '选择下载入口';
    modalDescription.textContent = isRelease
      ? '选择一个站点查看 Carb 的版本、附件与校验资料。'
      : '选择更适合你的站点，打开 Carb 的下载与版本页面。';
    downloadModal.hidden = false;
    document.body.classList.add('modal-open');
    modalClose?.focus();
  }

  document.querySelectorAll('[data-download-modal]').forEach(trigger => {
    trigger.addEventListener('click', event => {
      event.preventDefault();
      openDownloadModal(trigger);
    });
  });
  modalClose?.addEventListener('click', closeDownloadModal);
  downloadModal?.addEventListener('click', event => {
    if (event.target === downloadModal) closeDownloadModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && downloadModal && !downloadModal.hidden) closeDownloadModal();
    if (event.key === 'Tab' && downloadModal && !downloadModal.hidden) {
      const controls = [...downloadModal.querySelectorAll('button, a[href]')];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  // Keep content visible without JavaScript or when motion is reduced.
  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });
    const targets = document.querySelectorAll('.section-heading, .about-grid, .about-notes > div, .service, .step, .work-entry, .mode-card, .cloud-note, .guide-layout, .learning-resources, .demo-intro, .faq-layout, .release-row, .closing, .footer-intro, .contact-heading-row');
    targets.forEach(target => {
      if (target.matches('.service, .step, .mode-card, .about-notes > div')) {
        const index = [...target.parentElement.children].indexOf(target);
        target.style.setProperty('--reveal-delay', `${Math.min(index, 3) * 55}ms`);
      }
      target.classList.add('motion-reveal');
      observer.observe(target);
    });
    document.addEventListener('focusin', event => {
      const target = event.target.closest('.motion-reveal');
      if (!target) return;
      target.classList.add('is-revealed');
      observer.unobserve(target);
    });
    reducedMotion.addEventListener('change', event => {
      if (!event.matches) return;
      observer.disconnect();
      targets.forEach(target => target.classList.add('is-revealed'));
    });
  }

  // Short taps and keyboard activation receive the same visible press response.
  const pressSelector = '.button, .guide-tabs button, .menu-toggle, .download-modal-close, .download-option, .contact-trigger, .contact-popover-link, .faq-list summary';
  let pressedControl = null;
  let pressStarted = 0;
  let releaseTimer = 0;
  function releasePress(immediate = false) {
    const control = pressedControl;
    if (!control) return;
    window.clearTimeout(releaseTimer);
    const clear = () => {
      control.classList.remove('is-pressed');
      if (pressedControl === control) pressedControl = null;
    };
    if (immediate) clear();
    else releaseTimer = window.setTimeout(clear, Math.max(0, 100 - (performance.now() - pressStarted)));
  }
  function startPress(event) {
    const control = event.target.closest(pressSelector);
    if (!control || control.matches(':disabled, [aria-disabled="true"]')) return;
    releasePress(true);
    pressedControl = control;
    pressStarted = performance.now();
    control.classList.add('is-pressed');
  }
  document.addEventListener('pointerdown', event => {
    if (event.isPrimary && event.button === 0) startPress(event);
  });
  document.addEventListener('pointerup', () => releasePress());
  document.addEventListener('pointercancel', () => releasePress(true));
  document.addEventListener('keydown', event => {
    if (event.repeat || !event.target.matches(pressSelector)) return;
    if (event.key === 'Enter' || (event.key === ' ' && event.target.matches('button, summary'))) startPress(event);
  });
  document.addEventListener('keyup', event => {
    if (event.key === 'Enter' || event.key === ' ') releasePress();
  });
  window.addEventListener('blur', () => releasePress(true));
  window.addEventListener('pagehide', () => releasePress(true));
})();
