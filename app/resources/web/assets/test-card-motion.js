const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const forcedColors = matchMedia("(forced-colors: active)");
const glowCards = [
  ".inbox-card", ".sessrow", ".pr-list-item", ".pr-thread-card", ".pr-activity-card",
  ".pr-review-event-body", ".pr-inline-thread", ".ta-api-connection",
  ".account-card", ".signin-card", ".onboarding__theme", "[data-motion-card]",
].join(",");
const visibleAttr = "data-test-card-visible";
const isElement = node => node instanceof Element;
const duration = 460;
const ease = "cubic-bezier(.22,.68,.24,1)";
let active;

// Continuous gradients are only painted for cards in or near a visible pane.
if (typeof IntersectionObserver === "function") {
  const observer = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      target.toggleAttribute(visibleAttr, isIntersecting);
    }
  });
  const observe = root => {
    if (isElement(root) && root.matches(glowCards)) observer.observe(root);
    root.querySelectorAll(glowCards).forEach(card => observer.observe(card));
  };
  const unobserve = root => {
    if (root.matches(glowCards)) observer.unobserve(root);
    root.querySelectorAll(glowCards).forEach(card => observer.unobserve(card));
  };
  observe(document);
  new MutationObserver(records => {
    for (const { addedNodes, removedNodes } of records) {
      for (const node of removedNodes) if (isElement(node) && !node.isConnected) unobserve(node);
      for (const node of addedNodes) if (isElement(node) && node.isConnected) observe(node);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

function visibleBox(element) {
  if (!element?.isConnected || element.closest("[hidden], [inert]")) return null;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility !== "visible") return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1 ? rect : null;
}

function conversation() {
  const panes = document.querySelectorAll(".stage__body:not([hidden]) .stage__conversation:not(.is-new-session)");
  return [...panes].find(pane => pane.closest(".split__pane.is-focused") && visibleBox(pane))
    ?? [...panes].find(pane => !pane.closest(".split__pane.is-dormant") && visibleBox(pane));
}

function transitionFor(trigger) {
  const pr = trigger.closest(".pr-workspace .pr-list-item");
  if (pr && !pr.matches(".is-selected, :disabled")) {
    const workspace = pr.closest(".pr-workspace");
    return {
      card: pr,
      title: pr.querySelector(".pr-list-item-head strong"),
      ready: () => pr.matches(".is-selected") && workspace.querySelector(".pr-detail-pane"),
      background: () => workspace.querySelector(".pr-list-pane"),
      viewport: workspace,
    };
  }
  const sessionButton = trigger.closest(".inbox-card__main, .rail button.sess");
  if (sessionButton && !sessionButton.disabled) {
    const card = sessionButton.closest(".inbox-card, .sessrow");
    if (!card || card.matches(".is-selected, .is-active, .is-renaming, .is-row-dragging")) return null;
    return {
      card,
      title: card.querySelector(".inbox-card__title, .sess__title"),
      ready: () => card.matches(".is-selected, .is-active") && conversation(),
      background: () => document.querySelector(".app-bg") || card.closest(".rail"),
    };
  }
  const connection = trigger.closest(".ta-api-connection:not(:disabled)");
  if (connection) {
    const overlay = connection.closest(".ta-api-overlay");
    const previous = overlay?.querySelector(".ta-api-details");
    if (!previous || (connection.matches(".is-selected") && !previous.querySelector(".ta-api-form"))) return null;
    return {
      card: connection,
      title: connection.querySelector(".ta-api-connection__name"),
      ready: () => {
        const details = overlay.querySelector(".ta-api-details");
        return details !== previous && details;
      },
      background: () => overlay.querySelector(".ta-api-backdrop, .ta-api-list"),
    };
  }
  return null;
}

function transparent(color) {
  return !color || color === "transparent" || color === "rgba(0, 0, 0, 0)";
}

function surfaceColor(element, style) {
  return transparent(style.backgroundColor)
    ? style.getPropertyValue("--surface").trim() || style.getPropertyValue("--bg").trim()
      || getComputedStyle(element.ownerDocument.body).backgroundColor
    : style.backgroundColor;
}

function geometry(rect) {
  return {
    left: `${rect.left}px`, top: `${rect.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`,
  };
}

function createFrame(card, title, rect) {
  const style = getComputedStyle(card);
  const outlineStyle = getComputedStyle(card, "::before");
  const titleStyle = title && getComputedStyle(title);
  const titleBox = title?.getBoundingClientRect();
  const frame = document.createElement("div");
  frame.className = "test-card-morph";
  frame.setAttribute("aria-hidden", "true");
  frame.inert = true;
  Object.assign(frame.style, geometry(rect), {
    borderRadius: style.borderRadius,
    borderColor: transparent(style.borderTopColor)
      ? "color-mix(in srgb, currentColor 16%, transparent)" : style.borderTopColor,
    backgroundColor: surfaceColor(card, style),
    color: titleStyle?.color ?? style.color,
    boxShadow: style.boxShadow,
  });
  frame.style.setProperty("--test-morph-outline", outlineStyle.backgroundImage);
  frame.style.setProperty("--test-morph-outline-opacity", outlineStyle.opacity);
  if (title?.textContent && titleBox?.width > 0) {
    const label = document.createElement("span");
    label.className = "test-card-morph__title";
    label.textContent = title.textContent;
    Object.assign(label.style, {
      left: `${titleBox.left - rect.left - 1}px`, top: `${titleBox.top - rect.top - 1}px`,
      width: `${titleBox.width}px`, fontFamily: titleStyle.fontFamily,
      fontSize: titleStyle.fontSize, fontWeight: titleStyle.fontWeight,
      lineHeight: titleStyle.lineHeight,
    });
    frame.append(label);
  }
  return frame;
}

function revealDetails(scroller, target, rect) {
  // On narrow PR layouts the details pane lives to the right of a horizontal scroller.
  if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return rect;
  const bounds = scroller.getBoundingClientRect();
  const available = Math.min(bounds.right, rect.right) - Math.max(bounds.left, rect.left);
  if (available >= Math.min(rect.width, bounds.width) * 0.65) return rect;
  scroller.scrollTo({ left: scroller.scrollLeft + rect.left - bounds.left, behavior: "instant" });
  return target.getBoundingClientRect();
}

function startMorph(transition, sourceBox) {
  const frame = createFrame(transition.card, transition.title, sourceBox);
  const animations = [];
  let cancelled = false;
  let nextFrame = 0;
  function stop() {
    if (cancelled) return;
    cancelled = true;
    cancelAnimationFrame(nextFrame);
    frame.remove();
    for (const animation of animations) animation.cancel();
    if (active === stop) active = undefined;
  }
  active = stop;
  const deadline = performance.now() + 240;

  function render(now) {
    if (cancelled) return;
    const target = transition.ready();
    const targetBox = visibleBox(target);
    if (!targetBox) {
      if (now < deadline) nextFrame = requestAnimationFrame(render);
      else stop();
      return;
    }
    const detailBox = revealDetails(transition.viewport, target, targetBox);
    const finalStyle = getComputedStyle(target);
    document.body.append(frame);
    try {
      const shell = frame.animate([
        {
          ...geometry(sourceBox), opacity: 1, borderRadius: frame.style.borderRadius,
          borderColor: frame.style.borderColor, backgroundColor: frame.style.backgroundColor,
          boxShadow: frame.style.boxShadow,
        },
        { opacity: 1, offset: 0.62 },
        {
          ...geometry(detailBox), opacity: 0, borderRadius: finalStyle.borderRadius,
          borderColor: finalStyle.borderTopColor, backgroundColor: surfaceColor(target, finalStyle),
          boxShadow: finalStyle.boxShadow,
        },
      ], { duration, easing: ease, fill: "both" });
      animations.push(shell);
      if (frame.firstElementChild) {
        animations.push(frame.firstElementChild.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: 168, easing: "ease-out", fill: "forwards" },
        ));
      }
      // The real pane is present throughout, crossfading into the card surface as
      // it reaches the final geometry. No extra entry step or visibility change.
      animations.push(target.animate([
        { opacity: 0, scale: ".988" },
        { opacity: 0, offset: 0.45 },
        { opacity: finalStyle.opacity, scale: finalStyle.scale },
      ], { duration, easing: ease, fill: "both" }));
      const background = transition.background();
      if (visibleBox(background)) {
        const initialScale = getComputedStyle(background).scale;
        const rest = initialScale === "none" ? [1, 1] : initialScale.split(/\s+/).map(Number);
        if (rest.length <= 2 && rest.every(Number.isFinite)) {
          const zoom = background.matches(".app-bg, .ta-api-backdrop") ? 1.034 : 0.985;
          animations.push(background.animate([
            { scale: initialScale, easing: "ease-out" },
            { scale: `${rest[0] * zoom} ${(rest[1] ?? rest[0]) * zoom}`, offset: 0.48, easing: "ease-in-out" },
            { scale: initialScale },
          ], { duration }));
        }
      }
      Promise.allSettled(animations.map(animation => animation.finished)).then(stop);
    } catch {
      stop();
    }
  }

  nextFrame = requestAnimationFrame(render);
}

document.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0 || event.detail > 1
    || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || !isElement(event.target)) return;
  const transition = transitionFor(event.target);
  if (!transition) return;
  if (reduceMotion.matches || forcedColors.matches || typeof Element.prototype.animate !== "function") {
    if (transition.viewport) requestAnimationFrame(() => {
      const target = transition.ready();
      const rect = visibleBox(target);
      if (rect) revealDetails(transition.viewport, target, rect);
    });
    return;
  }
  const box = visibleBox(transition.card);
  if (!box || box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) return;
  active?.();
  startMorph(transition, box);
}, true);

reduceMotion.addEventListener("change", () => { if (reduceMotion.matches) active?.(); });
forcedColors.addEventListener("change", () => { if (forcedColors.matches) active?.(); });
window.addEventListener("resize", () => active?.(), { passive: true });
document.addEventListener("pointerdown", () => active?.(), { capture: true, passive: true });
document.addEventListener("keydown", event => { if (event.key === "Escape") active?.(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) active?.(); });
