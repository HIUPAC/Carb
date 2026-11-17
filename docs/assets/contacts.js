(() => {
  const contacts = Array.from(document.querySelectorAll('details[data-contact-qr]'));
  const hoverPointer = window.matchMedia('(min-width: 761px) and (hover: hover) and (pointer: fine)');
  const closeOthers = current => contacts.forEach(item => { if (item !== current) item.open = false; });

  contacts.forEach(item => {
    const summary = item.querySelector('summary');
    summary.addEventListener('click', () => { if (!item.open) closeOthers(item); });
    item.addEventListener('pointerenter', () => {
      if (hoverPointer.matches) { closeOthers(item); item.open = true; }
    });
    item.addEventListener('pointerleave', () => {
      if (hoverPointer.matches && !item.contains(document.activeElement)) item.open = false;
    });
    item.addEventListener('focusout', event => {
      // Inline mobile panels must stay stable between pointerdown and click.
      if (hoverPointer.matches && !item.contains(event.relatedTarget) && !item.matches(':hover')) item.open = false;
    });
    item.addEventListener('keydown', event => {
      if (event.key === 'Escape' && item.open) {
        item.open = false;
        summary.focus();
        event.preventDefault();
        event.stopPropagation();
      }
    });
  });

  document.addEventListener('click', event => {
    contacts.forEach(item => { if (item.open && !item.contains(event.target)) item.open = false; });
  });
  hoverPointer.addEventListener('change', () => { contacts.forEach(item => { item.open = false; }); });
})();
