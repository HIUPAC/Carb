import { chooseAnchor, drawerAnchors, releaseVelocity, rubberBand, springPosition } from "./test-drawer-physics.js";

const kinds = [
  { root: ".sheet", panel: ".sheet__panel", header: ".sheet__head, .feedback__head", scrim: ".sheet__scrim" },
  { root: ".pr-dialog-backdrop", panel: ".pr-dialog:not(.is-compact)", header: "header" },
  { root: ".ta-api-overlay", panel: ".ta-api-shell", header: ".ta-api-header", scrim: ".ta-api-backdrop" },
];
const overlaySelector = kinds.map(kind => kind.root).join(", ");
const interactive = "button, a, input, textarea, select, [role=button], [contenteditable]:not([contenteditable=false])";
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const drawers = new Map();
let drawerId = 0;

function paint(state, offset) {
  state.offset = offset;
  state.panel.style.setProperty("--test-drawer-y", `${offset.toFixed(2)}px`);
  const middle = state.anchors.find(anchor => anchor.name === "partial")?.y ?? state.height * 0.4;
  const closed = state.anchors.at(-1).y;
  const opacity = offset <= middle
    ? 1 - 0.24 * Math.max(0, offset) / Math.max(1, middle)
    : 0.76 * Math.max(0, closed - offset) / Math.max(1, closed - middle);
  state.root.style.setProperty("--test-drawer-scrim-alpha", opacity.toFixed(3));
}

function label(state) {
  const zh = document.documentElement.lang.toLowerCase().startsWith("zh");
  const labels = zh
    ? { expanded: "已展开", partial: "部分展开", closed: "正在关闭" }
    : { expanded: "expanded", partial: "partially expanded", closed: "closing" };
  const hint = state.anchors.length > 2
    ? (zh ? "按 Enter 切换高度，按方向键调节，按 End 关闭。" : "Press Enter to toggle height, arrow keys to adjust, or End to close.")
    : (zh ? "按 Enter 或方向下键关闭。" : "Press Enter or Down Arrow to close.");
  state.handle.setAttribute("aria-label", zh ? `底部抽屉，${labels[state.anchor]}。${hint}` : `Bottom drawer, ${labels[state.anchor]}. ${hint}`);
}

function closeDrawer(state) {
  const scrim = state.kind.scrim && state.root.querySelector(state.kind.scrim);
  if (scrim) scrim.click();
  else if (state.kind.root === ".pr-dialog-backdrop") {
    // This dialog closes on a mouse down on its existing backdrop.
    state.root.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  }
}

function stopSpring(state) {
  if (state.frame) cancelAnimationFrame(state.frame);
  state.frame = 0;
}

function snap(state, anchor, velocity = 0) {
  stopSpring(state);
  state.anchor = anchor.name;
  state.target = anchor.y;
  state.root.dataset.drawerAnchor = anchor.name;
  label(state);
  const from = state.offset;
  const finish = () => {
    state.frame = 0;
    paint(state, anchor.y);
    if (anchor.name === "closed" && state.root.isConnected) closeDrawer(state);
  };
  if (reducedMotion.matches || Math.abs(from - anchor.y) < 0.75) return finish();
  const started = performance.now();
  const tick = now => {
    if (!state.root.isConnected) { state.frame = 0; return; }
    const elapsed = now - started;
    if (elapsed >= 400) return finish();
    paint(state, springPosition(from, anchor.y, velocity, Math.max(0, elapsed)));
    state.frame = requestAnimationFrame(tick);
  };
  state.frame = requestAnimationFrame(tick);
}

function track(gesture, y, t) {
  const samples = gesture.samples;
  if (samples.at(-1)?.t === t) samples[samples.length - 1] = { y, t };
  else samples.push({ y, t });
  while (samples.length > 1 && t - samples[0].t > 105) samples.shift();
}

function stopTracking(state) {
  const gesture = state.gesture;
  if (!gesture) return;
  state.gesture = null;
  gesture.listeners.abort();
  delete state.root.dataset.drawerDragging;
  try {
    if (gesture.region.hasPointerCapture(gesture.id)) gesture.region.releasePointerCapture(gesture.id);
  } catch { /* Pointer may have already been released by the browser. */ }
}

function finishGesture(state, event, cancelled) {
  const gesture = state.gesture;
  if (!gesture || event?.pointerId !== gesture.id) return;
  stopTracking(state);
  if (!gesture.active) return;
  state.suppressClick = performance.now() + 350;
  const original = state.anchors.find(anchor => anchor.name === gesture.anchor) ?? state.anchors[0];
  if (cancelled) return snap(state, original);
  track(gesture, event.clientY, event.timeStamp);
  const offset = rubberBand(gesture.offset + event.clientY - gesture.y, state.anchors, state.height);
  paint(state, offset);
  const velocity = releaseVelocity(gesture.samples);
  snap(state, chooseAnchor(state.anchors, offset, velocity), velocity);
}

function moveGesture(state, event) {
  const gesture = state.gesture;
  if (!gesture || event.pointerId !== gesture.id) return;
  track(gesture, event.clientY, event.timeStamp);
  const delta = event.clientY - gesture.y;
  if (!gesture.active) {
    if (Math.abs(event.clientX - gesture.x) > Math.max(8, Math.abs(delta))) {
      stopTracking(state);
      return;
    }
    if (Math.abs(delta) < 5) return;
    gesture.active = true;
    gesture.offset = state.offset;
    gesture.anchor = chooseAnchor(state.anchors, state.offset, 0).name;
    stopSpring(state);
    state.root.dataset.drawerDragging = "";
    try { gesture.region.setPointerCapture(event.pointerId); } catch { /* Window listeners still track release. */ }
  }
  if (event.cancelable) event.preventDefault();
  paint(state, rubberBand(gesture.offset + delta, state.anchors, state.height));
}

function beginGesture(state, event) {
  if (!event.isPrimary || event.button !== 0 || state.gesture || !(event.target instanceof Element)) return;
  state.suppressClick = 0;
  const region = event.target.closest(`.test-drawer-handle, ${state.kind.header}`);
  if (!region || !state.panel.contains(region)) return;
  if (region !== state.handle && event.target.closest(interactive)) return;
  const listeners = new AbortController();
  const gesture = {
    id: event.pointerId, x: event.clientX, y: event.clientY, region, listeners,
    active: false, samples: [{ y: event.clientY, t: event.timeStamp }],
  };
  state.gesture = gesture;
  const capture = { signal: listeners.signal, capture: true };
  window.addEventListener("pointermove", move => moveGesture(state, move), { ...capture, passive: false });
  window.addEventListener("pointerup", up => finishGesture(state, up, false), capture);
  window.addEventListener("pointercancel", cancel => finishGesture(state, cancel, true), capture);
  region.addEventListener("lostpointercapture", lost => finishGesture(state, lost, true), { signal: listeners.signal });
  window.addEventListener("blur", () => {
    stopTracking(state);
    if (gesture.active) snap(state, state.anchors.find(anchor => anchor.name === gesture.anchor) ?? state.anchors[0]);
  }, { signal: listeners.signal });
}

function handleKey(state, event) {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  stopTracking(state);
  const anchors = state.anchors;
  const index = Math.max(0, anchors.findIndex(anchor => anchor.name === state.anchor));
  if (event.key === "ArrowUp") snap(state, anchors[Math.max(0, index - 1)]);
  if (event.key === "ArrowDown") snap(state, anchors[Math.min(anchors.length - 1, index + 1)]);
  if (event.key === "Home") snap(state, anchors[0]);
  if (event.key === "End") snap(state, anchors.at(-1));
}

function ensureHandle(state) {
  if (state.handle.parentElement !== state.panel) state.panel.prepend(state.handle);
}

function destroy(state) {
  stopTracking(state);
  stopSpring(state);
  state.resize.disconnect();
  state.listeners.abort();
  state.handle.remove();
  state.panel.classList.remove("test-drawer-panel");
  state.panel.style.removeProperty("--test-drawer-y");
  if (state.addedId && state.panel.id === state.addedId) state.panel.removeAttribute("id");
  state.root.classList.remove("is-damping-drawer");
  state.root.style.removeProperty("--test-drawer-scrim-alpha");
  delete state.root.dataset.drawerAnchor;
  drawers.delete(state.root);
}

function enhance(root) {
  const kind = kinds.find(entry => root.matches(entry.root));
  if (!kind) return;
  const panel = [...root.children].find(child => child.matches(kind.panel));
  const previous = drawers.get(root);
  if (previous && previous.panel === panel) { ensureHandle(previous); return; }
  if (previous) destroy(previous);
  if (!panel || root.matches('[role="alertdialog"]') || panel.matches('[role="alertdialog"]')) return;

  const handle = document.createElement("button");
  const addedId = panel.id ? "" : `test-drawer-panel-${++drawerId}`;
  if (addedId) panel.id = addedId;
  handle.type = "button";
  handle.className = "test-drawer-handle";
  handle.setAttribute("aria-controls", panel.id);
  handle.setAttribute("aria-keyshortcuts", "Enter Space ArrowUp ArrowDown Home End");
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  const state = { root, panel, kind, handle, addedId, listeners, gesture: null, frame: 0, suppressClick: 0, anchor: "expanded" };
  root.classList.add("is-damping-drawer");
  panel.classList.add("test-drawer-panel");
  drawers.set(root, state);
  ensureHandle(state);
  state.height = panel.offsetHeight;
  state.anchors = drawerAnchors(state.height);

  root.addEventListener("pointerdown", event => beginGesture(state, event), options);
  root.addEventListener("click", event => {
    if (event.detail && performance.now() < state.suppressClick) {
      state.suppressClick = 0;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { ...options, capture: true });
  handle.addEventListener("click", () => {
    const middle = state.anchors.find(anchor => anchor.name === "partial");
    snap(state, middle ? (state.anchor === "expanded" ? middle : state.anchors[0]) : state.anchors.at(-1));
  }, options);
  handle.addEventListener("keydown", event => handleKey(state, event), options);
  panel.addEventListener("focusin", event => {
    if (state.anchor !== "partial" || event.target === handle) return;
    if (event.target.getBoundingClientRect().bottom > root.getBoundingClientRect().bottom - 6) snap(state, state.anchors[0]);
  }, options);

  state.resize = new ResizeObserver(() => {
    const height = panel.offsetHeight;
    if (!height || height === state.height) return;
    state.height = height;
    state.anchors = drawerAnchors(height);
    if (state.gesture?.active) return;
    const target = state.anchors.find(anchor => anchor.name === state.anchor) ?? state.anchors[0];
    label(state);
    if (target.y !== state.target) snap(state, target);
  });
  state.resize.observe(panel);
  paint(state, Math.min(44, state.height * 0.14));
  snap(state, state.anchors[0]);
}

function collectOverlays(node, output) {
  if (!(node instanceof Element)) return;
  if (node.matches(overlaySelector)) output.add(node);
  node.querySelectorAll(overlaySelector).forEach(root => output.add(root));
}

new MutationObserver(records => {
  const candidates = new Set();
  for (const record of records) {
    if (record.type === "attributes") { drawers.forEach(label); continue; }
    const target = record.target;
    if (target instanceof Element) {
      if (target.matches(overlaySelector)) candidates.add(target);
      else if (target.classList.contains("test-drawer-panel") && target.parentElement) candidates.add(target.parentElement);
    }
    record.addedNodes.forEach(node => collectOverlays(node, candidates));
    record.removedNodes.forEach(node => collectOverlays(node, candidates));
  }
  candidates.forEach(root => {
    if (root.isConnected) enhance(root);
    else if (drawers.has(root)) destroy(drawers.get(root));
  });
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["lang"] });

reducedMotion.addEventListener("change", () => {
  if (!reducedMotion.matches) return;
  drawers.forEach(state => {
    if (!state.frame) return;
    const target = state.anchors.find(anchor => anchor.name === state.anchor) ?? state.anchors[0];
    snap(state, target);
  });
});
document.querySelectorAll(overlaySelector).forEach(enhance);
