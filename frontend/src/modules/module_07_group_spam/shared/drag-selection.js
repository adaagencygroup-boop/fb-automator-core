/**
 * ============================================================================
 * MODULE 07 - DRAG TO SELECT (Kéo chuột chọn nhiều tài khoản)
 * Cung cấp cơ chế kéo chuột (drag selection) mượt mà cho bảng tài khoản:
 * 1. Nhấn giữ chuột và kéo lên/xuống qua các dòng để chọn nhanh dải tài khoản.
 * 2. Tự động cuộn (auto-scroll) mượt khi chuột chạm mép trên/dưới của bảng.
 * 3. Hỗ trợ phím Ctrl / Shift / Cmd để chọn thêm (additive selection).
 * 4. Chặn bôi đen chữ (select-none) trong lúc kéo để thao tác chuẩn xác.
 * ============================================================================
 */

const INTERACTIVE = "button, input, select, textarea, a, [role='button'], [contenteditable]:not([contenteditable='false']), [data-no-row-selection]";
export const ROW_SELECTOR = "[data-account-key], [data-group-key], [data-row-key]";

export function getRowKey(row) {
  return row?.dataset?.accountKey || row?.dataset?.groupKey || row?.dataset?.rowKey || "";
}

export function selectRowRange(keys, anchor, end, previous = []) {
  const startIdx = Math.min(anchor, end);
  const endIdx = Math.max(anchor, end);
  const range = keys.slice(startIdx, endIdx + 1);
  return [...new Set([...previous, ...range])];
}

export function attachDragSelection(container, {
  getVisibleKeys,
  getSelectedKeys,
  onSelectionChange,
  disabled = false,
}) {
  if (!container) return () => {};
  const view = container.ownerDocument?.defaultView || window;

  let gesture = null;
  let frame = null;
  let suppressClick = false;

  function stop() {
    const pointerId = gesture?.pointerId;
    gesture = null;
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
    container.classList.remove("select-none");
    document.body.classList.remove("select-none");
    view.removeEventListener("pointermove", move, true);
    view.removeEventListener("pointerup", finish, true);
    view.removeEventListener("pointercancel", finish, true);
    view.removeEventListener("blur", stop);
    if (pointerId !== undefined && container.hasPointerCapture?.(pointerId)) {
      try {
        container.releasePointerCapture(pointerId);
      } catch (_) {}
    }
  }

  function viewport() {
    const bounds = container.getBoundingClientRect();
    const header = container.querySelector("thead")?.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      top: Math.max(bounds.top, header?.bottom ?? bounds.top),
      bottom: bounds.bottom,
    };
  }

  function updateRange() {
    if (!gesture?.started) return;
    const bounds = viewport();
    if (gesture.x < bounds.left - 80 || gesture.x > bounds.right + 80 || bounds.top >= bounds.bottom) return;
    const y = Math.max(bounds.top + 1, Math.min(bounds.bottom - 1, gesture.y));

    let key;
    const rows = container.querySelectorAll(ROW_SELECTOR);
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (key === undefined || rect.top <= y) {
        key = getRowKey(row);
      }
      if (rect.bottom >= y) break;
    }

    const visibleKeys = getVisibleKeys();
    const end = visibleKeys.indexOf(key);
    if (end < 0 || end === gesture.end) return;

    gesture.end = end;
    const newSelected = selectRowRange(visibleKeys, gesture.anchor, end, gesture.previous);
    onSelectionChange(newSelected);
  }

  function tick(timestamp) {
    if (!gesture?.started) return;
    const bounds = viewport();
    const edge = Math.min(36, (bounds.bottom - bounds.top) / 3);
    let speed = 0;
    if (edge > 0 && gesture.x >= bounds.left - 80 && gesture.x <= bounds.right + 80) {
      if (gesture.y < bounds.top + edge) {
        speed = -480 * Math.min(1, (bounds.top + edge - gesture.y) / edge);
      } else if (gesture.y > bounds.bottom - edge) {
        speed = 480 * Math.min(1, (gesture.y - bounds.bottom + edge) / edge);
      }
    }

    const elapsed = gesture.lastFrame === undefined ? 16 : Math.min(32, timestamp - gesture.lastFrame);
    gesture.lastFrame = timestamp;

    if (speed !== 0) {
      const prevScrollTop = container.scrollTop;
      container.scrollTop += (speed * elapsed) / 1000;
      if (container.scrollTop !== prevScrollTop) {
        updateRange();
      }
    }
    frame = view.requestAnimationFrame(tick);
  }

  function move(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!(event.buttons & 1)) {
      stop();
      return;
    }
    gesture.x = event.clientX;
    gesture.y = event.clientY;

    if (!gesture.started) {
      if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 5) return;
      gesture.started = true;
      suppressClick = true;
      container.classList.add("select-none");
      document.body.classList.add("select-none");
      try {
        container.setPointerCapture?.(event.pointerId);
      } catch (_) {}
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
    if (disabled || event.pointerType !== "mouse" || event.button !== 0) return;
    if (event.target.closest(INTERACTIVE)) return;

    const row = event.target.closest(ROW_SELECTOR);
    if (!row || !container.contains(row)) return;

    const visibleKeys = getVisibleKeys();
    const anchor = visibleKeys.indexOf(getRowKey(row));
    if (anchor < 0) return;

    stop();
    const isAdditive = event.ctrlKey || event.metaKey || event.shiftKey;
    const currentSelected = getSelectedKeys();

    gesture = {
      pointerId: event.pointerId,
      anchor,
      end: anchor,
      started: false,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      previous: isAdditive ? [...currentSelected] : [],
    };

    view.addEventListener("pointermove", move, { capture: true, passive: false });
    view.addEventListener("pointerup", finish, true);
    view.addEventListener("pointercancel", finish, true);
    view.addEventListener("blur", stop);
  }

  function click(event) {
    if (!suppressClick) return;
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
