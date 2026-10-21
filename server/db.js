import { MongoClient } from "mongodb";
import { config } from "./config.js";
import { createDbRetryController, describeMongoTarget } from "./dbRetry.js";

/** @type {MongoClient | null} */
let client = null;
let connected = false;
/** True only after a successful connect and required index setup. */
let ready = false;
/** @type {string | null} */
let lastError = null;
/** @type {Promise<import("mongodb").Db> | null} */
let connectLock = null;
/** @type {Promise<import("mongodb").Db> | null} */
let prepareLock = null;
/** @type {ReturnType<typeof createDbRetryController> | null} */
let retryController = null;
/** @type {((db: import("mongodb").Db) => Promise<void>) | null} */
let storedEnsureIndexes = null;
/** @type {string | null} */
let storedUri = null;
/** @type {object} */
let storedRetryOpts = {};
/** When false, connection-loss handlers must not start reconnect. */
let allowReconnect = false;
/** Suppresses driver close events during intentional client teardown. */
let intentionalClose = false;
/** @type {ReturnType<typeof setInterval> | null} */
let monitorTimer = null;
/** @type {Array<[string, (...args: any[]) => void]>} */
let clientListeners = [];

const DEFAULT_MONITOR_INTERVAL_MS = 10_000;

export function isDbReady() {
  return ready;
}

export function getDbStatus() {
  const retrying = Boolean(prepareLock)
    || Boolean(retryController?.isActivelyRetrying);
  return {
    connected: ready,
    ready,
    retrying,
    error: ready ? null : lastError ?? "Database not connected",
  };
}

function stopMonitor() {
  if (monitorTimer != null) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

function startMonitor(intervalMs = DEFAULT_MONITOR_INTERVAL_MS) {
  stopMonitor();
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
  monitorTimer = setInterval(() => {
    void monitorPing();
  }, intervalMs);
  // Allow Node to exit in tests if only the monitor remains (server keeps process alive).
  monitorTimer.unref?.();
}

async function monitorPing() {
  if (!allowReconnect || !ready || !client || intentionalClose) return;
  try {
    await client.db().command({ ping: 1 });
  } catch (error) {
    await markUnavailableAndReconnect(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function detachClientListeners() {
  if (!client || !clientListeners.length) {
    clientListeners = [];
    return;
  }
  for (const [event, handler] of clientListeners) {
    client.off(event, handler);
  }
  clientListeners = [];
}

function attachClientListeners(next) {
  detachClientListeners();
  const onLoss = (signal) => {
    if (intentionalClose || !allowReconnect) return;
    void markUnavailableAndReconnect(`driver:${signal}`);
  };
  // topologyClosed / connectionPoolClosed fire when the client is torn down.
  // Mid-run server death without client close is caught by the bounded monitor.
  const bindings = [
    ["topologyClosed", () => onLoss("topologyClosed")],
    ["connectionPoolClosed", () => onLoss("connectionPoolClosed")],
  ];
  for (const [event, handler] of bindings) {
    next.on(event, handler);
    clientListeners.push([event, handler]);
  }
}

function ensureReconnectActive() {
  if (!allowReconnect || !storedEnsureIndexes) return;
  if (!retryController || retryController.stopped) {
    startDbReconnect({
      uri: storedUri ?? config.mongodbUri,
      ensureIndexes: storedEnsureIndexes,
      ...storedRetryOpts,
    });
    return;
  }
  // Idle after a prior success: kick a new single-flight prepare attempt.
  retryController.resume();
}

/**
 * Clear readiness and resume controlled reconnect + index setup.
 * Safe to call from driver events, monitor, or health checks.
 */
export async function markUnavailableAndReconnect(reason = "Database connection lost") {
  const message = typeof reason === "string" ? reason : String(reason);
  lastError = message;

  if (!allowReconnect) return;

  // Already recovering — do not stack overlapping prepare attempts.
  if (!ready && (prepareLock || retryController?.isActivelyRetrying) && !client) {
    return;
  }

  stopMonitor();
  ready = false;
  connected = false;

  if (client) {
    intentionalClose = true;
    detachClientListeners();
    try {
      await client.close();
    } catch {
      // already closed
    }
    client = null;
    intentionalClose = false;
  }

  ensureReconnectActive();
}

/** Live check used by /api/health (does not replace background monitoring). */
export async function checkDbHealth() {
  if (!client || !ready) {
    return getDbStatus();
  }
  try {
    await client.db().command({ ping: 1 });
    connected = true;
    lastError = null;
  } catch (error) {
    await markUnavailableAndReconnect(
      error instanceof Error ? error.message : String(error),
    );
  }
  return getDbStatus();
}

async function connectDbUnlocked(uri) {
  if (client && connected) {
    try {
      await client.db().command({ ping: 1 });
      return client.db();
    } catch {
      // fall through and reconnect
    }
  }

  if (client) {
    intentionalClose = true;
    stopMonitor();
    detachClientListeners();
    try {
      await client.close();
    } catch {
      // ignore close errors during reconnect
    }
    client = null;
    intentionalClose = false;
    connected = false;
    ready = false;
  }

  try {
    const next = new MongoClient(uri, {
      serverSelectionTimeoutMS: 1500,
    });
    await next.connect();
    await next.db().command({ ping: 1 });
    client = next;
    attachClientListeners(next);
    connected = true;
    lastError = null;
    return client.db();
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    client = null;
    connected = false;
    ready = false;
    throw error;
  }
}

/**
 * Open (or reuse) a Mongo client. Does not mark the app DB ready — call
 * becomeReady / startDbReconnect so indexes run first.
 */
export async function connectDb(uri = config.mongodbUri) {
  if (connectLock) return connectLock;
  connectLock = connectDbUnlocked(uri).finally(() => {
    connectLock = null;
  });
  return connectLock;
}

/**
 * Connect, run required index setup, then mark ready for request handlers.
 * Single-flight: overlapping callers share one attempt.
 */
export async function becomeReady({
  uri = config.mongodbUri,
  ensureIndexes,
  monitorIntervalMs = storedRetryOpts.monitorIntervalMs ?? DEFAULT_MONITOR_INTERVAL_MS,
} = {}) {
  if (prepareLock) return prepareLock;
  prepareLock = (async () => {
    ready = false;
    stopMonitor();
    const db = await connectDb(uri);
    if (typeof ensureIndexes === "function") {
      await ensureIndexes(db);
    }
    ready = true;
    connected = true;
    lastError = null;
    if (allowReconnect) {
      startMonitor(monitorIntervalMs);
    }
    return db;
  })().catch((error) => {
    ready = false;
    stopMonitor();
    lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }).finally(() => {
    prepareLock = null;
  });
  return prepareLock;
}

/**
 * Background reconnect with capped backoff. Safe to call when Mongo was down
 * at process start or after a mid-run disconnect; recovers without restarting Express.
 */
export function startDbReconnect({
  uri = config.mongodbUri,
  ensureIndexes,
  initialDelayMs = 1000,
  maxDelayMs = 30_000,
  multiplier = 2,
  monitorIntervalMs = DEFAULT_MONITOR_INTERVAL_MS,
  setTimeoutFn,
  clearTimeoutFn,
  onFailure,
  onSuccess,
} = {}) {
  if (typeof ensureIndexes !== "function") {
    throw new Error("startDbReconnect requires ensureIndexes");
  }

  stopMonitor();
  retryController?.stop();
  retryController = null;

  allowReconnect = true;
  storedEnsureIndexes = ensureIndexes;
  storedUri = uri;
  storedRetryOpts = {
    initialDelayMs,
    maxDelayMs,
    multiplier,
    monitorIntervalMs,
    setTimeoutFn,
    clearTimeoutFn,
    onFailure,
    onSuccess,
  };

  retryController = createDbRetryController({
    attempt: () => becomeReady({
      uri,
      ensureIndexes,
      monitorIntervalMs,
    }),
    initialDelayMs,
    maxDelayMs,
    multiplier,
    setTimeoutFn,
    clearTimeoutFn,
    onFailure: (error, meta) => {
      ready = false;
      stopMonitor();
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `MongoDB unavailable at ${describeMongoTarget(uri)} `
        + `(attempt ${meta.attemptCount}): ${message}. `
        + `Retrying in ${meta.delayMs}ms.`,
      );
      onFailure?.(error, meta);
    },
    onSuccess: () => {
      console.log(`MongoDB ready at ${describeMongoTarget(uri)} (indexes ensured)`);
      onSuccess?.();
    },
  });
  retryController.start();
  return retryController;
}

/** Stop retry timers/monitor and prevent further reconnection attempts. */
export function stopDbReconnect() {
  allowReconnect = false;
  stopMonitor();
  retryController?.stop();
  retryController = null;
}

export async function closeDb() {
  allowReconnect = false;
  stopMonitor();
  retryController?.stop();
  retryController = null;
  storedEnsureIndexes = null;
  storedUri = null;
  storedRetryOpts = {};
  ready = false;

  if (prepareLock) {
    try {
      await prepareLock.catch(() => {});
    } catch {
      // ignore
    }
  }

  if (!client) {
    connected = false;
    return;
  }

  intentionalClose = true;
  detachClientListeners();
  try {
    await client.close();
  } catch {
    // ignore
  }
  client = null;
  intentionalClose = false;
  connected = false;
}

/** Returns the database only when connected and indexes are ready; otherwise null. */
export function getDb() {
  if (!client || !connected || !ready) return null;
  return client.db();
}

export { describeMongoTarget };
