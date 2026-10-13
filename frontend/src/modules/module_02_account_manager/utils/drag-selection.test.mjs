import { test } from "node:test";
import assert from "node:assert/strict";
import { attachDragSelection } from "./drag-selection.mjs";

class Surface {
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, values = {}) {
    const event = {
      type, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1,
      clientX: 100, clientY: 70, detail: 1, ctrlKey: false, metaKey: false,
      defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...values,
    };
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
    return event;
  }
  listenerCount() { return [...this.listeners.values()].reduce((total, set) => total + set.size, 0); }
}

function table({ selected = ["hidden"], visible = ["1", "2", "3", "4", "5", "6"], disabled = false } = {}) {
  const view = new Surface();
  let nextFrame = 0;
  const frames = new Map();
  view.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
  view.cancelAnimationFrame = (id) => frames.delete(id);
  const container = new Surface();
  container.ownerDocument = { defaultView: view };
  let scrollTop = 0;
  Object.defineProperty(container, "scrollTop", {
    get: () => scrollTop,
    set: (value) => { scrollTop = Math.max(0, Math.min(200, value)); },
  });
  container.getBoundingClientRect = () => ({ top: 0, bottom: 210, left: 0, right: 400 });
  let captured;
  container.setPointerCapture = (id) => { captured = id; };
  container.hasPointerCapture = (id) => captured === id;
  container.releasePointerCapture = () => { captured = undefined; };
  const rows = visible.map((uid, index) => ({
    dataset: { accountUid: uid },
    getBoundingClientRect: () => ({ top: 50 + index * 40 - scrollTop, bottom: 90 + index * 40 - scrollTop }),
  }));
  container.querySelector = () => ({ getBoundingClientRect: () => ({ bottom: 50 }) });
  container.querySelectorAll = () => rows;
  container.contains = (row) => rows.includes(row);
  let selection = selected;
  const changes = [];
  const getSelectedUids = () => selection;
  const onSelectionChange = (value) => { selection = value; changes.push(value); };
  const availableUids = [...visible, "hidden"];
  const destroy = attachDragSelection(container, { visibleUids: visible, availableUids, getSelectedUids, onSelectionChange, disabled });
  return {
    view, container, rows, frames, changes, destroy, getSelectedUids, onSelectionChange,
    selected: () => selection,
    down(index = 0, values = {}) {
      const row = rows[index];
      return container.emit("pointerdown", {
        clientY: row.getBoundingClientRect().top + 20,
        target: { closest: (selector) => selector === "[data-account-uid]" ? row : null },
        ...values,
      });
    },
    move(index, values = {}) {
      return view.emit("pointermove", { clientY: rows[index].getBoundingClientRect().top + 20, ...values });
    },
    frame(timestamp = 16) {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(timestamp));
    },
    captured: () => captured,
  };
}

test("a click or movement below 4px keeps the current selection", () => {
  const t = table();
  t.down();
  t.move(0, { clientX: 103 });
  t.view.emit("pointerup");
  assert.deepEqual(t.selected(), ["hidden"]);
  assert.equal(t.changes.length, 0);
  assert.equal(t.captured(), undefined);
  t.destroy();
});

test("drag replaces the selection and shrinking restores the smaller range", () => {
  const t = table();
  t.down();
  assert.equal(t.move(3).defaultPrevented, true);
  assert.deepEqual(t.selected(), ["1", "2", "3", "4"]);
  t.move(1);
  assert.deepEqual(t.selected(), ["1", "2"]);
  assert.equal(t.captured(), 1);
  t.view.emit("pointerup", { clientY: 110 });
  assert.equal(t.captured(), undefined);
  assert.equal(t.frames.size, 0);
  t.destroy();
});

test("dragging upwards and crossing the anchor uses visible row order", () => {
  const t = table({ visible: ["9", "2", "7", "1"] });
  t.down(2);
  t.move(0);
  assert.deepEqual(t.selected(), ["9", "2", "7"]);
  t.move(3);
  assert.deepEqual(t.selected(), ["7", "1"]);
  t.destroy();
});

for (const modifier of ["ctrlKey", "metaKey"]) {
  test(`${modifier} adds a range and preserves hidden rows without duplicates`, () => {
    const t = table({ selected: ["hidden", "2", "6"] });
    t.down(0, { [modifier]: true });
    t.move(2);
    assert.deepEqual(t.selected(), ["hidden", "2", "6", "1", "3"]);
    t.move(0, { clientX: 110 });
    assert.deepEqual(t.selected(), ["hidden", "2", "6", "1"]);
    t.destroy();
  });
}

test("buttons, inputs, links and detail rows do not initiate selection", () => {
  for (const target of [
    { closest: () => ({}) }, // interactive child
    { closest: () => null }, // detail row without an account UID
  ]) {
    const t = table();
    t.down(0, { target });
    t.move(2);
    assert.deepEqual(t.selected(), ["hidden"]);
    assert.equal(t.view.listenerCount(), 0);
    t.destroy();
  }
});

test("right click, touch and loading tables keep their selection", () => {
  for (const values of [{ button: 2 }, { pointerType: "touch" }, { pointerType: "pen" }]) {
    const t = table();
    t.down(0, values);
    t.move(2);
    assert.deepEqual(t.selected(), ["hidden"]);
    t.destroy();
  }
  const t = table({ disabled: true });
  t.down();
  t.move(2);
  assert.deepEqual(t.selected(), ["hidden"]);
  t.destroy();
});

test("auto-scroll extends the range while the mouse stays at the lower edge", () => {
  const t = table({ selected: [] });
  t.down();
  t.view.emit("pointermove", { clientY: 209 });
  assert.deepEqual(t.selected(), ["1", "2", "3", "4"]);
  for (let index = 1; index <= 12; index++) t.frame(index * 16);
  assert.ok(t.container.scrollTop > 40);
  assert.ok(t.selected().includes("6"));
  t.view.emit("pointerup", { clientY: 209 });
  assert.equal(t.frames.size, 0);
  t.destroy();
});

test("auto-scroll at the upper edge selects earlier rows", () => {
  const t = table({ selected: [] });
  t.container.scrollTop = 80;
  t.down(4);
  t.view.emit("pointermove", { clientY: 51 });
  for (let index = 1; index <= 12; index++) t.frame(index * 16);
  assert.equal(t.container.scrollTop, 0);
  assert.deepEqual(t.selected(), ["1", "2", "3", "4", "5"]);
  t.destroy();
});

test("moving horizontally out of the table pauses selection and auto-scroll", () => {
  const t = table();
  t.down();
  t.move(1);
  t.view.emit("pointermove", { clientX: 450, clientY: 300 });
  t.frame();
  assert.deepEqual(t.selected(), ["1", "2"]);
  assert.equal(t.container.scrollTop, 0);
  t.destroy();
});

test("release outside the table, cancellation, lost capture and blur stop dragging", () => {
  for (const finish of ["pointerup", "pointercancel", "blur", "lostpointercapture"]) {
    const t = table();
    t.down();
    t.move(1);
    (finish === "lostpointercapture" ? t.container : t.view).emit(finish, { clientY: 110 });
    t.move(2);
    assert.deepEqual(t.selected(), ["1", "2"]);
    assert.equal(t.frames.size, 0);
    assert.equal(t.view.listenerCount(), 0);
    t.destroy();
  }
});

test("a missing button release and unrelated pointer cannot leave a stuck gesture", () => {
  const t = table();
  t.down();
  t.move(1, { pointerId: 2 });
  assert.deepEqual(t.selected(), ["hidden"]);
  t.move(1);
  t.move(2, { buttons: 0 });
  t.move(3);
  assert.deepEqual(t.selected(), ["1", "2"]);
  assert.equal(t.frames.size, 0);
  t.destroy();
});

test("drag suppresses the trailing action click but preserves ordinary and keyboard clicks", () => {
  const t = table();
  t.down();
  t.move(1);
  t.view.emit("pointerup", { clientY: 110 });
  assert.equal(t.container.emit("click", { detail: 0 }).defaultPrevented, false);
  const click = t.container.emit("click");
  assert.equal(click.defaultPrevented, true);
  assert.equal(click.propagationStopped, true);
  t.down();
  t.view.emit("pointerup");
  assert.equal(t.container.emit("click").defaultPrevented, false);
  t.destroy();
});

test("changed rows stop the old gesture, prune deleted UIDs and preserve filtered selections", () => {
  const t = table({ selected: ["hidden", "1", "2"] });
  t.down();
  t.move(1);
  t.destroy();
  const cleanup = attachDragSelection(t.container, {
    visibleUids: ["2"], availableUids: ["2", "hidden"],
    getSelectedUids: t.getSelectedUids, onSelectionChange: t.onSelectionChange,
  });
  assert.deepEqual(t.selected(), ["2"]);
  t.move(3);
  assert.deepEqual(t.selected(), ["2"]);
  cleanup();
  assert.equal(t.container.listenerCount(), 0);
  assert.equal(t.view.listenerCount(), 0);
  assert.equal(t.frames.size, 0);
});

test("reconciliation preserves selected rows hidden by the filter", () => {
  const t = table({ selected: ["hidden", "2", "deleted"] });
  assert.deepEqual(t.selected(), ["hidden", "2"]);
  t.destroy();
});
