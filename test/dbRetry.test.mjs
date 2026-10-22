import assert from "node:assert/strict";
import test from "node:test";
import { createDbRetryController, describeMongoTarget } from "../server/dbRetry.js";

function createFakeTimers() {
  /** @type {Array<{ id: symbol, fn: () => void, ms: number }>} */
  const pending = [];
  return {
    pending,
    setTimeoutFn(fn, ms) {
      const id = Symbol("timer");
      pending.push({ id, fn, ms });
      return id;
    },
    clearTimeoutFn(id) {
      const index = pending.findIndex((item) => item.id === id);
      if (index >= 0) pending.splice(index, 1);
    },
    async runNext() {
      const next = pending.shift();
      assert.ok(next, "expected a pending retry timer");
      await next.fn();
    },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

test("retry loop backs off with a cap and does not overlap attempts", async () => {
  const timers = createFakeTimers();
  let concurrent = 0;
  let maxConcurrent = 0;
  let calls = 0;
  const delays = [];
  /** @type {((value?: unknown) => void) | null} */
  let releaseAttempt = null;

  const controller = createDbRetryController({
    initialDelayMs: 100,
    maxDelayMs: 400,
    multiplier: 2,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    onFailure(_error, meta) {
      delays.push(meta.delayMs);
    },
    attempt: async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      calls += 1;
      await new Promise((resolve) => {
        releaseAttempt = resolve;
      });
      concurrent -= 1;
      if (calls < 3) throw new Error(`down-${calls}`);
    },
  });

  controller.start();
  await flush();
  // Second start while in-flight must not overlap.
  controller.start();
  assert.equal(calls, 1);
  assert.equal(maxConcurrent, 1);

  releaseAttempt?.();
  await flush();
  assert.equal(delays[0], 100);
  assert.equal(controller.hasPendingTimer, true);

  const second = timers.runNext();
  await flush();
  assert.equal(calls, 2);
  releaseAttempt?.();
  await second;
  await flush();
  assert.equal(delays[1], 200);

  const third = timers.runNext();
  await flush();
  assert.equal(calls, 3);
  releaseAttempt?.();
  await third;
  await flush();
  assert.equal(controller.attemptCount, 0);
  assert.equal(controller.hasPendingTimer, false);
  assert.equal(maxConcurrent, 1);
  assert.ok(delays.every((ms) => ms <= 400));
});

test("shutdown cleanup clears pending retry timers", async () => {
  const timers = createFakeTimers();
  const controller = createDbRetryController({
    initialDelayMs: 250,
    maxDelayMs: 250,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    attempt: async () => {
      throw new Error("unavailable");
    },
  });

  controller.start();
  await flush();
  assert.equal(controller.hasPendingTimer, true);
  assert.equal(timers.pending.length, 1);

  controller.stop();
  assert.equal(controller.stopped, true);
  assert.equal(controller.hasPendingTimer, false);
  assert.equal(timers.pending.length, 0);
});

test("isActivelyRetrying is true only during attempts or backoff, and resume restarts idle controllers", async () => {
  const timers = createFakeTimers();
  let calls = 0;
  /** @type {((value?: unknown) => void) | null} */
  let releaseAttempt = null;

  const controller = createDbRetryController({
    initialDelayMs: 100,
    maxDelayMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    attempt: async () => {
      calls += 1;
      await new Promise((resolve) => {
        releaseAttempt = resolve;
      });
      if (calls === 1) throw new Error("down");
    },
  });

  assert.equal(controller.isActivelyRetrying, false);
  controller.start();
  await flush();
  assert.equal(controller.isActivelyRetrying, true);
  assert.equal(controller.inFlight, true);

  releaseAttempt?.();
  await flush();
  assert.equal(controller.hasPendingTimer, true);
  assert.equal(controller.isActivelyRetrying, true);
  assert.equal(controller.inFlight, false);

  const second = timers.runNext();
  await flush();
  releaseAttempt?.();
  await second;
  await flush();
  assert.equal(calls, 2);
  assert.equal(controller.isActivelyRetrying, false);

  // Idle after success — resume kicks a new attempt.
  controller.resume();
  await flush();
  assert.equal(calls, 3);
  assert.equal(controller.isActivelyRetrying, true);
  releaseAttempt?.();
  await flush();
  assert.equal(controller.isActivelyRetrying, false);
});

test("describeMongoTarget never includes credentials", () => {
  assert.equal(
    describeMongoTarget("mongodb://alice:s3cret@cluster.example:27017/groupflow"),
    "mongodb://cluster.example:27017/groupflow",
  );
  assert.equal(
    describeMongoTarget("mongodb://127.0.0.1:27017/groupflow_test"),
    "mongodb://127.0.0.1:27017/groupflow_test",
  );
  assert.doesNotMatch(
    describeMongoTarget("mongodb://alice:s3cret@host/db"),
    /s3cret|alice/,
  );
});
