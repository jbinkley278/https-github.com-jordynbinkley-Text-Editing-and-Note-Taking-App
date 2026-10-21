import assert from "node:assert/strict";
import { once } from "node:events";
import { config as loadEnv } from "dotenv";
import { assertSafeTestMongoUri } from "./mongoTestUri.mjs";

// Load .env for MONGODB_URI_TEST / MONGODB_URI comparison only. Do not connect yet.
loadEnv();

process.env.BCRYPT_COST = process.env.BCRYPT_COST ?? "4";

/**
 * Validate the dedicated test database BEFORE importing server/db or deleting anything.
 * Never falls back to MONGODB_URI or the application database.
 */
const validatedTestTarget = assertSafeTestMongoUri(process.env.MONGODB_URI_TEST, {
  appUri: process.env.MONGODB_URI ?? null,
});

// Force every subsequent server/config import to use only the validated test URI.
process.env.MONGODB_URI = validatedTestTarget.uri;

const { closeDb, connectDb, getDb } = await import("../server/db.js");
const { createApp } = await import("../server/app.js");
const { ensureAuthIndexes } = await import("../server/auth/sessions.js");
const { ensureGroupIndexes } = await import("../server/groups/service.js");
const { ensureTaskIndexes } = await import("../server/tasks/service.js");
const { ensureMessageIndexes } = await import("../server/messages/service.js");
const { ensureReadPositionIndexes } = await import("../server/messages/readPosition.js");
const { ensureEventIndexes } = await import("../server/events/service.js");
const { ensureActivityIndexes } = await import("../server/activity/service.js");
const { config } = await import("../server/config.js");

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
  await connectDb(validatedTestTarget.uri);
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
  await ensureAuthIndexes(db);
  await ensureGroupIndexes(db);
  await ensureTaskIndexes(db);
  await ensureMessageIndexes(db);
  await ensureReadPositionIndexes(db);
  await ensureEventIndexes(db);
  await ensureActivityIndexes(db);

  const app = createApp();
  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const jar = cookieJar();

  async function request(path, { method = "GET", body, jar: customJar } = {}) {
    const activeJar = customJar ?? jar;
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(activeJar.header() ? { Cookie: activeJar.header() } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    activeJar.store(response);
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    return { status: response.status, data, response };
  }

  async function register(name = "Test User") {
    const email = `user_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`;
    const password = "password123";
    const result = await request("/api/auth/register", {
      method: "POST",
      body: { name, email, password },
    });
    assert.equal(result.status, 201, result.data.error);
    return { email, password, user: result.data.user };
  }

  try {
    await run({
      request,
      jar,
      db,
      register,
      cookieJar,
      testDatabase: validatedTestTarget.database,
    });
  } finally {
    server.close();
    await once(server, "close");
    await closeDb();
  }
}

export { config, validatedTestTarget };
