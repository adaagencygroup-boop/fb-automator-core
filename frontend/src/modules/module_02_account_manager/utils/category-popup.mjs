export function categoryPopupPosition(anchor, popup, viewport) {
  const margin = 12, gap = 8;
  const width = Math.min(280, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(popup.height, Math.max(0, viewport.height - margin * 2));
  let left, top;
  if (anchor.right + gap + width <= viewport.width - margin) {
    left = anchor.right + gap;
    top = anchor.top;
  } else if (anchor.left - gap - width >= margin) {
    left = anchor.left - gap - width;
    top = anchor.top;
  } else {
    left = anchor.left;
    top = anchor.bottom + gap + height <= viewport.height - margin
      ? anchor.bottom + gap : anchor.top - gap - height;
  }
  return {
    width,
    left: Math.max(margin, Math.min(left, viewport.width - width - margin)),
    top: Math.max(margin, Math.min(top, viewport.height - height - margin)),
    maxHeight: Math.max(0, viewport.height - margin * 2),
  };
}
