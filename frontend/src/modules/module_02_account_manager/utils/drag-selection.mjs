const INTERACTIVE = "button, input, select, textarea, a, [role='button'], [contenteditable]:not([contenteditable='false']), [data-no-row-selection]";
const ROW_SELECTOR = "[data-account-uid]";

export function selectRowRange(uids, anchor, end, previous = []) {
  return [...new Set([...previous, ...uids.slice(Math.min(anchor, end), Math.max(anchor, end) + 1)])];
}

/** Mouse selection uses the visible row order and one selection snapshot per gesture. */
export function attachDragSelection(container, {
  visibleUids, availableUids, getVisibleUids = () => visibleUids, getAvailableUids = () => availableUids, getSelectedUids, onSelectionChange, disabled = false,
}) {
  const view = container.ownerDocument.defaultView;
  const available = new Set(getAvailableUids());
  const selected = getSelectedUids();
  const retained = selected.filter((uid) => available.has(uid));
  if (retained.length !== selected.length) onSelectionChange(retained);

  let gesture = null;
  let frame = null;
  let suppressClick = false;

  function stop() {
    const pointerId = gesture?.pointerId;
    gesture = null;
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
    view.removeEventListener("pointermove", move, true);
    view.removeEventListener("pointerup", finish, true);
    view.removeEventListener("pointercancel", finish, true);
    view.removeEventListener("blur", stop);
    if (pointerId !== undefined && container.hasPointerCapture?.(pointerId)) {
      container.releasePointerCapture(pointerId);
    }
  }

  function viewport() {
    const bounds = container.getBoundingClientRect();
    const header = container.querySelector("thead")?.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, top: Math.max(bounds.top, header?.bottom ?? bounds.top), bottom: bounds.bottom };
  }

  function updateRange() {
    if (!gesture?.started) return;
    const bounds = viewport();
    if (gesture.x < bounds.left || gesture.x > bounds.right || bounds.top >= bounds.bottom) return;
    const y = Math.max(bounds.top + 1, Math.min(bounds.bottom - 1, gesture.y));
    let uid;
    for (const row of container.querySelectorAll(ROW_SELECTOR)) {
      const rect = row.getBoundingClientRect();
      if (uid === undefined || rect.top <= y) uid = row.dataset.accountUid;
      if (rect.bottom >= y) break;
    }
    const end = getVisibleUids().indexOf(uid);
    if (end < 0 || end === gesture.end) return;
    gesture.end = end;
    onSelectionChange(selectRowRange(getVisibleUids(), gesture.anchor, end, gesture.previous));
  }

  function tick(timestamp) {
    if (!gesture?.started) return;
    const bounds = viewport();
    const edge = Math.min(32, (bounds.bottom - bounds.top) / 3);
    let speed = 0;
    if (edge > 0 && gesture.x >= bounds.left && gesture.x <= bounds.right) {
      if (gesture.y < bounds.top + edge) speed = -480 * Math.min(1, (bounds.top + edge - gesture.y) / edge);
      else if (gesture.y > bounds.bottom - edge) speed = 480 * Math.min(1, (gesture.y - bounds.bottom + edge) / edge);
    }
    const elapsed = gesture.lastFrame === undefined ? 16 : Math.min(32, timestamp - gesture.lastFrame);
    gesture.lastFrame = timestamp;
    if (speed !== 0) {
      const previousScrollTop = container.scrollTop;
      container.scrollTop += speed * elapsed / 1000;
      if (container.scrollTop !== previousScrollTop) updateRange();
    }
    frame = view.requestAnimationFrame(tick);
  }

  function move(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!(event.buttons & 1)) { stop(); return; }
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    if (!gesture.started) {
      if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 4) return;
      gesture.started = true;
      suppressClick = true;
      container.setPointerCapture?.(event.pointerId);
      frame = view.requestAnimationFrame(tick);
    }
    event.preventDefault();
    updateRange();
  }

  function finish(event) {
    if (event.pointerId !== gesture?.pointerId) return;
    if (event.type === "pointerup" && gesture.started) {
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      updateRange();
    }
    stop();
  }

  function down(event) {
    suppressClick = false;
    if (disabled || event.pointerType !== "mouse" || event.button !== 0 || event.target.closest(INTERACTIVE)) return;
    const row = event.target.closest(ROW_SELECTOR);
    if (!row || !container.contains(row)) return;
    const anchor = getVisibleUids().indexOf(row.dataset.accountUid);
    if (anchor < 0) return;
    stop();
    gesture = {
      pointerId: event.pointerId, anchor, end: null, started: false,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      previous: event.ctrlKey || event.metaKey ? getSelectedUids().filter((uid) => getAvailableUids().includes(uid)) : [],
    };
    view.addEventListener("pointermove", move, { capture: true, passive: false });
    view.addEventListener("pointerup", finish, true);
    view.addEventListener("pointercancel", finish, true);
    view.addEventListener("blur", stop);
  }

  function click(event) {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function nativeDrag(event) {
    if (gesture) event.preventDefault();
  }

  container.addEventListener("pointerdown", down);
  container.addEventListener("lostpointercapture", stop);
  container.addEventListener("click", click, true);
  container.addEventListener("dragstart", nativeDrag);
  return () => {
    stop();
    container.removeEventListener("pointerdown", down);
    container.removeEventListener("lostpointercapture", stop);
    container.removeEventListener("click", click, true);
    container.removeEventListener("dragstart", nativeDrag);
  };
}
