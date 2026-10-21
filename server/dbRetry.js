/**
 * Single-flight retry helper with capped exponential backoff.
 * Used for MongoDB connect + index setup without overlapping attempts.
 */

/**
 * @param {object} options
 * @param {() => Promise<unknown>} options.attempt
 * @param {(error: unknown, meta: { attemptCount: number, delayMs: number }) => void} [options.onFailure]
 * @param {() => void} [options.onSuccess]
 * @param {(fn: () => void, ms: number) => any} [options.setTimeoutFn]
 * @param {(id: any) => void} [options.clearTimeoutFn]
 * @param {number} [options.initialDelayMs]
 * @param {number} [options.maxDelayMs]
 * @param {number} [options.multiplier]
 */
export function createDbRetryController({
  attempt,
  onFailure,
  onSuccess,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  initialDelayMs = 1000,
  maxDelayMs = 30_000,
  multiplier = 2,
}) {
  let timer = null;
  let stopped = true;
  let inFlight = false;
  let attemptCount = 0;

  function backoffDelayMs(failureCount) {
    const exp = initialDelayMs * (multiplier ** Math.max(0, failureCount - 1));
    return Math.min(maxDelayMs, exp);
  }

  function clearTimer() {
    if (timer != null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  }

  async function run() {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await attempt();
      if (stopped) return;
      attemptCount = 0;
      onSuccess?.();
    } catch (error) {
      if (stopped) return;
      attemptCount += 1;
      const delayMs = backoffDelayMs(attemptCount);
      onFailure?.(error, { attemptCount, delayMs });
      if (stopped) return;
      clearTimer();
      timer = setTimeoutFn(() => {
        timer = null;
        void run();
      }, delayMs);
    } finally {
      inFlight = false;
    }
  }

  return {
    start() {
      stopped = false;
      clearTimer();
      void run();
    },
    /**
     * After a successful attempt the controller is idle (not stopped, no timer).
     * Kick a new attempt without overlapping an in-flight or scheduled one.
     */
    resume() {
      if (inFlight || timer != null) return;
      stopped = false;
      void run();
    },
    stop() {
      stopped = true;
      clearTimer();
    },
    get stopped() {
      return stopped;
    },
    get inFlight() {
      return inFlight;
    },
    get attemptCount() {
      return attemptCount;
    },
    get hasPendingTimer() {
      return timer != null;
    },
    /** True only while an attempt is running or a backoff timer is scheduled. */
    get isActivelyRetrying() {
      return !stopped && (inFlight || timer != null);
    },
  };
}

/** Log-safe Mongo target (host/db only — never userinfo/password). */
export function describeMongoTarget(uri) {
  try {
    const parsed = new URL(uri);
    const dbName = parsed.pathname.replace(/^\//, "") || "(none)";
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${parsed.hostname}${port}/${dbName}`;
  } catch {
    return "(mongodb)";
  }
}
