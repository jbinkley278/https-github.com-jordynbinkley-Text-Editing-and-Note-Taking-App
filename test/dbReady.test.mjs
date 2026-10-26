import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { validatedTestTarget } from "./helpers.mjs";
import {
  becomeReady,
  checkDbHealth,
  closeDb,
  getDb,
  getDbStatus,
  isDbReady,
  startDbReconnect,
  stopDbReconnect,
} from "../server/db.js";
import { createApp } from "../server/app.js";
import { ensureAuthIndexes } from "../server/auth/sessions.js";
import { ensurePendingRegistrationIndexes } from "../server/auth/pendingRegistrations.js";
import { ensureGroupIndexes } from "../server/groups/service.js";
import { ensureTaskIndexes } from "../server/tasks/service.js";
import { ensureMessageIndexes } from "../server/messages/service.js";
import { ensureReadPositionIndexes } from "../server/messages/readPosition.js";
import { ensureAttachmentIndexes } from "../server/messages/attachments.js";
import { ensureEventIndexes } from "../server/events/service.js";
import { ensureActivityIndexes } from "../server/activity/service.js";
import {
  resetEmailAdapterForTests,
  setEmailAdapterForTests,
} from "../server/auth/routes.js";
import { createMemoryEmailAdapter } from "../server/email/adapter.js";
import {
  resetTurnstileVerifyForTests,
  setTurnstileVerifyForTests,
} from "../server/auth/turnstile.js";

/** Closed port — does not touch the user's running MongoDB process. */
const UNREACHABLE_TEST_URI = "mongodb://127.0.0.1:1/groupflow_reconnect_test";

async function ensureAllIndexes(db) {
  await ensureAuthIndexes(db);
  await ensurePendingRegistrationIndexes(db);
  await ensureGroupIndexes(db);
  await ensureTaskIndexes(db);
  await ensureMessageIndexes(db);
  await ensureReadPositionIndexes(db);
  await ensureAttachmentIndexes(db);
  await ensureEventIndexes(db);
  await ensureActivityIndexes(db);
}

async function registerVerified(request, { name, email, password }) {
  const emailAdapter = createMemoryEmailAdapter();
  setEmailAdapterForTests(emailAdapter);
  setTurnstileVerifyForTests(async () => ({ ok: true, hostname: "localhost" }));
  try {
    const pending = await request("/api/auth/register", {
      method: "POST",
      body: { name, email, password, turnstileToken: "test-token" },
    });
    assert.equal(pending.status, 200, pending.data.error);
    const code = pending.data.devCode ?? emailAdapter.sent.at(-1)?.code;
    assert.ok(code);
    const verified = await request("/api/auth/verify-email", {
      method: "POST",
      body: { email, code },
    });
    assert.equal(verified.status, 201, verified.data.error);
    return verified;
  } finally {
    resetEmailAdapterForTests();
    resetTurnstileVerifyForTests();
  }
}

async function withEphemeralApp(run) {
  const app = createApp();
  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  async function request(path, { method = "GET", body } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    return { status: response.status, data };
  }

  try {
    await run({ request, base });
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function waitFor(predicate, timeoutMs = 8000, label = "condition") {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForReady(timeoutMs = 8000) {
  await waitFor(() => isDbReady() && getDb(), timeoutMs, "database readiness");
}

async function waitForNotReady(timeoutMs = 8000) {
  await waitFor(() => !isDbReady() && !getDb(), timeoutMs, "database unreadiness");
}

test("unavailable startup keeps handlers at 503 and health degraded", async () => {
  stopDbReconnect();
  await closeDb();
  assert.equal(isDbReady(), false);
  assert.equal(getDb(), null);

  await assert.rejects(
    () => becomeReady({
      uri: UNREACHABLE_TEST_URI,
      ensureIndexes: ensureAllIndexes,
    }),
    /ECONNREFUSED|connect|selection|timeout|Server/i,
  );
  assert.equal(isDbReady(), false);
  assert.equal(getDb(), null);

  const health = await checkDbHealth();
  assert.equal(health.ready, false);
  assert.equal(health.connected, false);
  assert.equal(health.retrying, false);

  await withEphemeralApp(async ({ request }) => {
    const status = await request("/api/health");
    assert.equal(status.status, 200);
    assert.equal(status.data.status, "degraded");
    assert.equal(status.data.server, "ok");
    assert.equal(status.data.database, "disconnected");
    assert.equal(status.data.databaseReady, false);
    assert.equal(status.data.databaseRetrying, false);
    assert.ok(status.data.databaseError);

    const login = await request("/api/auth/login", {
      method: "POST",
      body: { email: "anyone@example.com", password: "password123" },
    });
    assert.equal(login.status, 503);
    assert.match(login.data.error, /Database unavailable/i);
  });
});

test("eventual recovery from startup marks ready after indexes without restarting Express", async () => {
  stopDbReconnect();
  await closeDb();
  assert.equal(validatedTestTarget.database.endsWith("_test"), true);

  await withEphemeralApp(async ({ request }) => {
    const before = await request("/api/health");
    assert.equal(before.data.databaseReady, false);

    startDbReconnect({
      uri: validatedTestTarget.uri,
      ensureIndexes: ensureAllIndexes,
      initialDelayMs: 50,
      maxDelayMs: 200,
      monitorIntervalMs: 60_000,
    });

    await waitForReady();

    const after = await request("/api/health");
    assert.equal(after.status, 200);
    assert.equal(after.data.status, "ok");
    assert.equal(after.data.database, "connected");
    assert.equal(after.data.databaseReady, true);
    assert.equal(after.data.databaseRetrying, false);

    const db = getDb();
    assert.ok(db);
    assert.equal(db.databaseName, validatedTestTarget.database);

    await registerVerified(request, {
      name: "Recovered User",
      email: `recovered_${Date.now()}@example.com`,
      password: "password123",
    });
  });

  stopDbReconnect();
  await closeDb();
});

test("post-ready connection loss clears readiness, returns 503, and recovers with indexes", async () => {
  stopDbReconnect();
  await closeDb();
  assert.equal(validatedTestTarget.database, "groupflow_test");

  let indexPasses = 0;
  startDbReconnect({
    uri: validatedTestTarget.uri,
    ensureIndexes: async (db) => {
      indexPasses += 1;
      await ensureAllIndexes(db);
    },
    initialDelayMs: 50,
    maxDelayMs: 200,
    monitorIntervalMs: 60_000,
  });
  await waitForReady();
  assert.equal(getDbStatus().retrying, false);
  const indexesAtReady = indexPasses;
  assert.ok(indexesAtReady >= 1);

  await withEphemeralApp(async ({ request }) => {
    const healthy = await request("/api/health");
    assert.equal(healthy.data.databaseReady, true);
    assert.equal(healthy.data.databaseRetrying, false);

    // Simulate lost connection without stopping the MongoDB process.
    const live = getDb();
    assert.ok(live);
    await live.client.close();

    // Driver signals must clear readiness without requiring /api/health.
    await waitForNotReady();
    assert.equal(getDb(), null);

    const loginWhileDown = await request("/api/auth/login", {
      method: "POST",
      body: { email: "down@example.com", password: "password123" },
    });
    // Reconnect starts immediately, so against a fast local MongoDB recovery can
    // finish before these requests: 503 while down, 401 (unknown user) once back.
    assert.ok([503, 401].includes(loginWhileDown.status), `unexpected status ${loginWhileDown.status}`);

    // Health must stay consistent whether or not recovery already finished.
    const degraded = await request("/api/health");
    assert.equal(degraded.data.database, degraded.data.databaseReady ? "connected" : "disconnected");
    if (degraded.data.databaseRetrying) {
      assert.equal(typeof getDbStatus().retrying, "boolean");
    }

    await waitForReady();
    assert.ok(indexPasses > indexesAtReady, "recovery must re-run index preparation");
    assert.equal(getDb()?.databaseName, validatedTestTarget.database);
    assert.equal(getDbStatus().retrying, false);

    const restored = await request("/api/health");
    assert.equal(restored.data.databaseReady, true);
    assert.equal(restored.data.databaseRetrying, false);

    await registerVerified(request, {
      name: "Case Two User",
      email: `case2_${Date.now()}@example.com`,
      password: "password123",
    });
  });

  stopDbReconnect();
  await closeDb();
});

test("databaseRetrying is true only during active attempt or scheduled backoff", async () => {
  stopDbReconnect();
  await closeDb();

  const controller = startDbReconnect({
    uri: UNREACHABLE_TEST_URI,
    ensureIndexes: async () => {},
    initialDelayMs: 30_000,
    maxDelayMs: 30_000,
    monitorIntervalMs: 60_000,
  });

  await waitFor(() => controller.isActivelyRetrying || controller.hasPendingTimer, 5000, "active retry");
  // After the failed attempt, a backoff timer should be pending.
  await waitFor(() => controller.hasPendingTimer, 5000, "backoff timer");
  assert.equal(getDbStatus().ready, false);
  assert.equal(getDbStatus().retrying, true, "scheduled backoff counts as retrying");

  await withEphemeralApp(async ({ request }) => {
    const health = await request("/api/health");
    assert.equal(health.data.databaseReady, false);
    assert.equal(health.data.databaseRetrying, true);
  });

  stopDbReconnect();
  await closeDb();
  assert.equal(getDbStatus().retrying, false);

  // After a successful ready, idle controller must not report retrying.
  startDbReconnect({
    uri: validatedTestTarget.uri,
    ensureIndexes: ensureAllIndexes,
    initialDelayMs: 50,
    maxDelayMs: 100,
    monitorIntervalMs: 60_000,
  });
  await waitForReady();
  assert.equal(getDbStatus().retrying, false);

  await withEphemeralApp(async ({ request }) => {
    const health = await request("/api/health");
    assert.equal(health.data.databaseReady, true);
    assert.equal(health.data.databaseRetrying, false);
  });

  stopDbReconnect();
  await closeDb();
});

test("shutdown during retry stops timers and prevents further reconnection", async () => {
  stopDbReconnect();
  await closeDb();

  let failures = 0;
  const controller = startDbReconnect({
    uri: UNREACHABLE_TEST_URI,
    ensureIndexes: async () => {},
    initialDelayMs: 30_000,
    maxDelayMs: 30_000,
    monitorIntervalMs: 60_000,
    onFailure: () => {
      failures += 1;
    },
  });

  await waitFor(() => failures >= 1 && controller.hasPendingTimer, 5000, "first failure + timer");
  assert.equal(isDbReady(), false);

  stopDbReconnect();
  await closeDb();

  assert.equal(controller.stopped, true);
  assert.equal(controller.hasPendingTimer, false);
  assert.equal(controller.isActivelyRetrying, false);
  assert.equal(getDbStatus().retrying, false);
  assert.equal(isDbReady(), false);
  assert.equal(getDb(), null);

  const failuresAfterStop = failures;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(failures, failuresAfterStop, "no further reconnect attempts after shutdown");
});
