import { test } from "node:test";
import assert from "node:assert/strict";
import { createActionLock } from "./actionLock.mjs";

/** Đồng hồ + hẹn giờ giả để kiểm tra không cần chờ thật. */
function fakeClock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    schedule: (fn, ms) => {
      const id = { fn, at: t + ms };
      timers.push(id);
      return id;
    },
    cancel: (id) => {
      const i = timers.indexOf(id);
      if (i >= 0) timers.splice(i, 1);
    },
    advance(ms) {
      t += ms;
      for (const id of [...timers].sort((a, b) => a.at - b.at)) {
        if (id.at <= t) {
          timers.splice(timers.indexOf(id), 1);
          id.fn();
        }
      }
    },
  };
}

test("clicking 5 times in a row runs the handler once", async () => {
  const clock = fakeClock();
  const lock = createActionLock({ minMs: 1500, ...clock });
  let calls = 0;
  const handler = async () => {
    calls += 1;
  };
  await Promise.all([1, 2, 3, 4, 5].map(() => lock.run(handler)));
  assert.equal(calls, 1);
  assert.equal(lock.isLocked(), true); // còn trong 1,5 giây tối thiểu
  assert.equal(lock.isRunning(), false); // handler đã xong, chỉ còn giữ khoá
  clock.advance(1499);
  await lock.run(handler);
  assert.equal(calls, 1);
  clock.advance(1);
  assert.equal(lock.isLocked(), false);
  await lock.run(handler);
  assert.equal(calls, 2);
});

test("stays locked while a slow handler (API call) is still running", async () => {
  const clock = fakeClock();
  const runningStates = [];
  const lock = createActionLock({
    minMs: 1500,
    onRunningChange: (r) => runningStates.push(r),
    ...clock,
  });
  let finish;
  let calls = 0;
  const slow = () =>
    new Promise((resolve) => {
      calls += 1;
      finish = resolve;
    });
  const first = lock.run(slow);
  assert.equal(lock.isRunning(), true);
  clock.advance(5000); // API trả lời chậm hơn thời gian khoá tối thiểu
  await lock.run(slow);
  assert.equal(calls, 1);
  assert.equal(lock.isLocked(), true);
  assert.equal(lock.isRunning(), true);
  finish("ok");
  assert.equal(await first, "ok");
  assert.equal(lock.isRunning(), false);
  assert.equal(lock.isLocked(), false); // đã quá 1,5 giây → mở ngay khi xong
  assert.deepEqual(runningStates, [true, false]);
});

test("sync handler locks for minMs without turning running on", async () => {
  const clock = fakeClock();
  const busyStates = [];
  const runningStates = [];
  const lock = createActionLock({
    minMs: 1500,
    onBusyChange: (b) => busyStates.push(b),
    onRunningChange: (r) => runningStates.push(r),
    ...clock,
  });
  let calls = 0;
  const validateFail = () => {
    calls += 1;
    return false;
  };
  const res = await lock.run(validateFail);
  assert.equal(res, false);
  assert.equal(calls, 1);
  assert.equal(lock.isLocked(), true);
  assert.equal(lock.isRunning(), false);
  assert.deepEqual(busyStates, [true]);
  assert.deepEqual(runningStates, []);
  clock.advance(1500);
  assert.equal(lock.isLocked(), false);
  assert.deepEqual(busyStates, [true, false]);
});

test("reports busy state and unlocks even when the handler throws", async () => {
  const clock = fakeClock();
  const states = [];
  const runningStates = [];
  const lock = createActionLock({
    minMs: 1500,
    onBusyChange: (b) => states.push(b),
    onRunningChange: (r) => runningStates.push(r),
    ...clock,
  });
  await assert.rejects(
    lock.run(async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.deepEqual(states, [true]);
  assert.deepEqual(runningStates, [true, false]);
  assert.equal(lock.isRunning(), false);
  clock.advance(1500);
  assert.deepEqual(states, [true, false]);
  assert.equal(lock.isLocked(), false);
});

test("passes arguments through and dispose clears the pending unlock", async () => {
  const clock = fakeClock();
  const lock = createActionLock({ minMs: 1500, ...clock });
  assert.equal(await lock.run(async (a, b) => a + b, 2, 3), 5);
  lock.dispose();
  assert.equal(lock.isLocked(), false);
  assert.equal(lock.isRunning(), false);
});
