import assert from "node:assert/strict";
import { once } from "node:events";
import { config as loadEnv } from "dotenv";
import { assertSafeTestMongoUri } from "./mongoTestUri.mjs";

// Load .env for MONGODB_URI_TEST / MONGODB_URI comparison only. Do not connect yet.
loadEnv();

process.env.BCRYPT_COST = process.env.BCRYPT_COST ?? "4";

// Registration verification defaults for the test suite (no Cloudflare / Resend network).
process.env.TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY
  || "1x00000000000000000000AA";
process.env.TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY
  || "1x0000000000000000000000000000000AA";
process.env.REGISTRATION_CODE_PEPPER = process.env.REGISTRATION_CODE_PEPPER
  || "test-registration-pepper-not-for-production";
process.env.EMAIL_ADAPTER = process.env.EMAIL_ADAPTER || "memory";
process.env.EXPOSE_DEV_VERIFICATION_CODE = process.env.EXPOSE_DEV_VERIFICATION_CODE || "1";

/**
 * Validate the dedicated test database BEFORE importing server/db or deleting anything.
 * Never falls back to MONGODB_URI or the application database.
 */
const validatedTestTarget = assertSafeTestMongoUri(process.env.MONGODB_URI_TEST, {
  appUri: process.env.MONGODB_URI ?? null,
});

// Force every subsequent server/config import to use only the validated test URI.
process.env.MONGODB_URI = validatedTestTarget.uri;

const { becomeReady, closeDb, getDb, stopDbReconnect } = await import("../server/db.js");
const { createApp } = await import("../server/app.js");
const { ensureAuthIndexes } = await import("../server/auth/sessions.js");
const { ensurePendingRegistrationIndexes } = await import("../server/auth/pendingRegistrations.js");
const { ensureGroupIndexes } = await import("../server/groups/service.js");
const { ensureTaskIndexes } = await import("../server/tasks/service.js");
const { ensureMessageIndexes } = await import("../server/messages/service.js");
const { ensureReadPositionIndexes } = await import("../server/messages/readPosition.js");
const {
  clearAttachmentStorage,
  ensureAttachmentIndexes,
} = await import("../server/messages/attachments.js");
const { ensureEventIndexes } = await import("../server/events/service.js");
const { ensureActivityIndexes } = await import("../server/activity/service.js");
const { config } = await import("../server/config.js");
const {
  resetEmailAdapterForTests,
  setEmailAdapterForTests,
} = await import("../server/auth/routes.js");
const { createMemoryEmailAdapter } = await import("../server/email/adapter.js");
const {
  resetTurnstileVerifyForTests,
  setTurnstileVerifyForTests,
} = await import("../server/auth/turnstile.js");

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

assert.equal(
  config.mongodbUri,
  validatedTestTarget.uri,
  "Integration tests must use only the validated MONGODB_URI_TEST connection",
);

export function cookieJar() {
  const jar = new Map();
  return {
    store(response) {
      const cookies = typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
      for (const raw of cookies) {
        const [pair] = raw.split(";");
        const eq = pair.indexOf("=");
        if (eq < 0) continue;
        const name = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        const clearing = /Max-Age=0/i.test(raw) || /Expires=Thu, 01 Jan 1970/i.test(raw);
        if (!value || clearing) jar.delete(name);
        else jar.set(name, value);
      }
    },
    header() {
      return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    hasSession() {
      return jar.has(config.sessionCookieName);
    },
    clear() {
      jar.clear();
    },
  };
}

export async function withServer(run) {
  stopDbReconnect();
  await becomeReady({
    uri: validatedTestTarget.uri,
    ensureIndexes: ensureAllIndexes,
  });
  const db = getDb();
  assert.ok(db, "MongoDB must be available for API tests");
  assert.equal(
    db.databaseName,
    validatedTestTarget.database,
    `Refusing cleanup: connected database "${db.databaseName}" is not the validated test database "${validatedTestTarget.database}"`,
  );

  // Cleanup is limited to the dedicated test database verified above.
  await db.collection("activity").deleteMany({});
  await db.collection("chat_read_positions").deleteMany({});
  await db.collection("events").deleteMany({});
  await db.collection("messages").deleteMany({});
  await db.collection("tasks").deleteMany({});
  await db.collection("invitations").deleteMany({});
  await db.collection("memberships").deleteMany({});
  await db.collection("groups").deleteMany({});
  await db.collection("sessions").deleteMany({});
  await db.collection("users").deleteMany({});
  await db.collection("pending_registrations").deleteMany({});
  await db.collection("registration_rate_limits").deleteMany({});
  await clearAttachmentStorage(db);

  const emailAdapter = createMemoryEmailAdapter();
  setEmailAdapterForTests(emailAdapter);
  setTurnstileVerifyForTests(async () => ({ ok: true, hostname: "localhost" }));

  const app = createApp();
  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const jar = cookieJar();

  async function request(path, { method = "GET", body, formData, jar: customJar, raw = false } = {}) {
    const activeJar = customJar ?? jar;
    const usingForm = formData instanceof FormData;
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined && !usingForm ? { "Content-Type": "application/json" } : {}),
        ...(activeJar.header() ? { Cookie: activeJar.header() } : {}),
      },
      body: usingForm ? formData : body !== undefined ? JSON.stringify(body) : undefined,
    });
    activeJar.store(response);
    if (raw) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return { status: response.status, data: {}, response, buffer };
    }
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }
    return { status: response.status, data, response, text };
  }

  /**
   * Complete verified registration (pending → verify) and leave a session cookie
   * on the active jar (default server jar, or `options.jar`).
   */
  async function register(name = "Test User", options = {}) {
    const activeJar = options.jar ?? jar;
    const email = options.email
      ?? `user_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`;
    const password = options.password ?? "password123";
    const pending = await request("/api/auth/register", {
      method: "POST",
      body: {
        name,
        email,
        password,
        turnstileToken: "test-turnstile-token",
      },
      jar: activeJar,
    });
    assert.equal(pending.status, 200, pending.data.error);
    assert.equal(pending.data.pending, true);
    const code = pending.data.devCode ?? emailAdapter.sent.at(-1)?.code;
    assert.ok(code, "verification code missing from response and memory email adapter");
    const verified = await request("/api/auth/verify-email", {
      method: "POST",
      body: { email, code },
      jar: activeJar,
    });
    assert.equal(verified.status, 201, verified.data.error);
    assert.equal(activeJar.hasSession(), true);
    return { email, password, user: verified.data.user, pending: pending.data };
  }

  try {
    await run({
      request,
      jar,
      db,
      register,
      emailAdapter,
      cookieJar,
      testDatabase: validatedTestTarget.database,
    });
  } finally {
    resetEmailAdapterForTests();
    resetTurnstileVerifyForTests();
    stopDbReconnect();
    server.close();
    await once(server, "close");
    await closeDb();
  }
}

export { config, validatedTestTarget };
