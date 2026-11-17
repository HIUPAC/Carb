// Add motion to native onboarding controls without replacing their DOM or input behavior.
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const forcedColors = matchMedia("(forced-colors: active)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
const cardSelector = ".onboarding__pick-row, .onboarding__theme";
const animations = new Map();
let hover;
let hoverFrame = 0;
let pressed;

function cardFor(target) {
  if (!(target instanceof Element)) return null;
  const card = target.closest(cardSelector);
  if (!card?.closest(".onboarding:not([hidden])")) return null;
  const input = card.querySelector("input");
  return input && !input.disabled && !card.closest("[inert], [data-phase='leaving']") ? card : null;
}

const canAnimate = () => !reducedMotion.matches && !forcedColors.matches;
const canTrace = () => canAnimate() && finePointer.matches;

function clearHover() {
  cancelAnimationFrame(hoverFrame);
  hoverFrame = 0;
  if (hover) {
    hover.card.removeAttribute("data-test-onboarding-hover");
    for (const name of ["--test-onboarding-pointer-x", "--test-onboarding-pointer-y", "--test-onboarding-pointer-opacity"]) {
      hover.card.style.removeProperty(name);
    }
  }
  hover = undefined;
}

function renderHover(now) {
  hoverFrame = 0;
  if (!hover || !hover.card.isConnected || !canTrace() || hover.card.closest("[hidden], [data-phase='leaving']")) {
    clearHover();
    return;
  }
  const state = hover;
  const rect = state.card.getBoundingClientRect();
  const elapsed = Math.min(48, Math.max(1, now - state.time));
  state.time = now;
  const follow = 1 - Math.exp(-elapsed / 45);
  const fade = 1 - Math.exp(-elapsed / 65);
  const width = state.card.offsetWidth;
  const height = state.card.offsetHeight;
  // Convert viewport coordinates back into the card before its press scale.
  const targetX = state.inside && rect.width > 0 ? (state.clientX - rect.left) * width / rect.width : width / 2;
  const targetY = state.inside && rect.height > 0 ? (state.clientY - rect.top) * height / rect.height : height / 2;
  state.x += (targetX - state.x) * follow;
  state.y += (targetY - state.y) * follow;
  state.opacity += ((state.inside ? 1 : 0) - state.opacity) * fade;
  state.card.style.setProperty("--test-onboarding-pointer-x", `${state.x.toFixed(2)}px`);
  state.card.style.setProperty("--test-onboarding-pointer-y", `${state.y.toFixed(2)}px`);
  state.card.style.setProperty("--test-onboarding-pointer-opacity", state.opacity.toFixed(3));
  if (!state.inside && state.opacity < 0.005) clearHover();
  else if (Math.abs(targetX - state.x) > 0.1 || Math.abs(targetY - state.y) > 0.1
    || Math.abs((state.inside ? 1 : 0) - state.opacity) > 0.005) {
    hoverFrame = requestAnimationFrame(renderHover);
  }
}

function trace(event) {
  if (event.pointerType === "touch" || !canTrace()) return;
  const card = cardFor(event.target);
  if (!card) {
    if (hover) hover.inside = false;
  } else if (hover?.card !== card) {
    clearHover();
    const rect = card.getBoundingClientRect();
    hover = {
      card, clientX: event.clientX, clientY: event.clientY,
      x: (event.clientX - rect.left) * card.offsetWidth / (rect.width || 1),
      y: (event.clientY - rect.top) * card.offsetHeight / (rect.height || 1),
      opacity: 0, inside: true, time: performance.now(),
    };
    card.setAttribute("data-test-onboarding-hover", "");
  } else {
    hover.clientX = event.clientX;
    hover.clientY = event.clientY;
    hover.inside = true;
  }
  if (hover && !hoverFrame) hoverFrame = requestAnimationFrame(renderHover);
}

function scaleFor(card) {
  const value = Number.parseFloat(getComputedStyle(card).scale);
  return Number.isFinite(value) ? value : 1;
}

function cancelAnimation(card) {
  const animation = animations.get(card);
  if (!animation) return;
  animations.delete(card);
  animation.cancel();
}

function animateScale(card, release) {
  // A click can release before the first animation frame; retain visible feedback.
  const current = scaleFor(card);
  const from = release ? Math.min(current, .985) : current;
  cancelAnimation(card);
  if (!canAnimate() || !card.isConnected || typeof card.animate !== "function") return;
  // Individual scale composes with the native entrance transform and theme lift.
  const frames = release
    ? Array.from({ length: 33 }, (_, index) => {
      const offset = index / 32;
      const seconds = offset * 0.58;
      // Underdamped spring: stiffness 500, damping 19, mass 1.
      const frequency = Math.sqrt(500 - 9.5 ** 2);
      const displacement = (from - 1) * Math.exp(-9.5 * seconds)
        * (Math.cos(frequency * seconds) + 9.5 / frequency * Math.sin(frequency * seconds));
      return { offset, scale: index === 32 ? "1" : String(1 + displacement) };
    })
    : [{ scale: String(from) }, { scale: ".972" }];
  const animation = card.animate(frames, {
    duration: release ? 580 : 105,
    easing: release ? "linear" : "cubic-bezier(.2,.7,.2,1)",
    fill: "forwards",
  });
  animations.set(card, animation);
  animation.finished.then(() => {
    if (release && animations.get(card) === animation) cancelAnimation(card);
  }, () => {});
}

function endPress(animate = true) {
  if (!pressed) return;
  const { card } = pressed;
  pressed = undefined;
  card.removeAttribute("data-test-onboarding-pressed");
  if (animate) animateScale(card, true);
  else cancelAnimation(card);
}

function beginPress(card, source) {
  if (!canAnimate()) return;
  if (pressed) endPress();
  pressed = { card, ...source };
  card.setAttribute("data-test-onboarding-pressed", "");
  animateScale(card, false);
}

function reset() {
  clearHover();
  endPress(false);
  for (const card of animations.keys()) cancelAnimation(card);
}

document.addEventListener("pointerover", trace, { passive: true });
document.addEventListener("pointermove", event => {
  // Recover a release outside the window even if the window kept keyboard focus.
  if (pressed?.pointerId === event.pointerId && !(event.buttons & 1)) endPress();
  trace(event);
}, { passive: true });
document.addEventListener("pointerout", event => {
  if (event.relatedTarget === null && pressed?.pointerId === event.pointerId) endPress();
  if (!hover || (event.relatedTarget instanceof Node && hover.card.contains(event.relatedTarget))) return;
  hover.inside = false;
  if (!hoverFrame) hoverFrame = requestAnimationFrame(renderHover);
}, { passive: true });

document.addEventListener("pointerdown", event => {
  if (event.button !== 0 || !event.isPrimary) return;
  const card = cardFor(event.target);
  if (card) beginPress(card, { pointerId: event.pointerId });
}, { passive: true });
document.addEventListener("pointerup", event => {
  if (pressed?.pointerId === event.pointerId) endPress();
}, { passive: true });
document.addEventListener("pointercancel", event => {
  if (pressed?.pointerId === event.pointerId) endPress();
}, { passive: true });

const isPressKey = key => key === " " || key === "Enter" || key === "Spacebar";
document.addEventListener("keydown", event => {
  if (!isPressKey(event.key) || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  const card = cardFor(event.target);
  if (card) beginPress(card, { key: event.key });
}, { capture: true });
document.addEventListener("keyup", event => {
  if (pressed?.key === event.key) endPress();
}, { capture: true });
document.addEventListener("focusout", event => {
  if (pressed?.key && !(event.relatedTarget instanceof Node && pressed.card.contains(event.relatedTarget))) endPress();
});

for (const preference of [reducedMotion, forcedColors, finePointer]) preference.addEventListener("change", reset);
window.addEventListener("blur", reset);
window.addEventListener("pagehide", reset);
window.addEventListener("resize", clearHover, { passive: true });
document.addEventListener("scroll", clearHover, { capture: true, passive: true });
document.addEventListener("visibilitychange", () => { if (document.hidden) reset(); });
new MutationObserver(() => {
  if (hover && (!hover.card.isConnected || hover.card.closest("[hidden], [data-phase='leaving']"))) clearHover();
  if (pressed && (!pressed.card.isConnected || pressed.card.closest("[hidden], [data-phase='leaving']"))) endPress(false);
  for (const card of animations.keys()) if (!card.isConnected || card.closest("[hidden], [data-phase='leaving']")) cancelAnimation(card);
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "data-phase"] });
