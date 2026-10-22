import assert from "node:assert/strict";
import test from "node:test";
import { withServer } from "./helpers.mjs";

const uniqueEmail = () => `user_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`;

test("registration creates a user session and returns the public profile", async () => {
  await withServer(async ({ request, jar }) => {
    const email = uniqueEmail();
    const result = await request("/api/auth/register", {
      method: "POST",
      body: { name: "Sandesh Pariyar", email, password: "password123" },
    });
    assert.equal(result.status, 201);
    assert.equal(result.data.user.name, "Sandesh Pariyar");
    assert.equal(result.data.user.email, email.toLowerCase());
    assert.ok(result.data.user.id);
    assert.equal(result.data.user.passwordHash, undefined);
    assert.equal(jar.hasSession(), true);

    const me = await request("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.user.email, email.toLowerCase());
  });
});

test("duplicate email registration is rejected", async () => {
  await withServer(async ({ request }) => {
    const email = uniqueEmail();
    const first = await request("/api/auth/register", {
      method: "POST",
      body: { name: "First User", email: email.toUpperCase(), password: "password123" },
    });
    assert.equal(first.status, 201);

    const second = await request("/api/auth/register", {
      method: "POST",
      body: { name: "Second User", email, password: "password456" },
    });
    assert.equal(second.status, 409);
    assert.match(second.data.error, /already exists/i);
  });
});

test("incorrect password is rejected", async () => {
  await withServer(async ({ request, jar }) => {
    const email = uniqueEmail();
    await request("/api/auth/register", {
      method: "POST",
      body: { name: "Login User", email, password: "password123" },
    });
    await request("/api/auth/logout", { method: "POST", body: {} });
    assert.equal(jar.hasSession(), false);

    const bad = await request("/api/auth/login", {
      method: "POST",
      body: { email, password: "wrong-password" },
    });
    assert.equal(bad.status, 401);
    assert.match(bad.data.error, /incorrect/i);

    const me = await request("/api/auth/me");
    assert.equal(me.status, 401);
  });
});

test("login creates a session that /api/auth/me can read", async () => {
  await withServer(async ({ request, jar }) => {
    const email = uniqueEmail();
    await request("/api/auth/register", {
      method: "POST",
      body: { name: "Session User", email, password: "password123" },
    });
    await request("/api/auth/logout", { method: "POST", body: {} });

    const login = await request("/api/auth/login", {
      method: "POST",
      body: { email, password: "password123" },
    });
    assert.equal(login.status, 200);
    assert.equal(jar.hasSession(), true);

    const me = await request("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.user.name, "Session User");
  });
});

test("logout invalidates the session cookie", async () => {
  await withServer(async ({ request, jar }) => {
    const email = uniqueEmail();
    await request("/api/auth/register", {
      method: "POST",
      body: { name: "Logout User", email, password: "password123" },
    });
    assert.equal((await request("/api/auth/me")).status, 200);

    const logout = await request("/api/auth/logout", { method: "POST", body: {} });
    assert.equal(logout.status, 200);
    assert.equal(jar.hasSession(), false);

    const me = await request("/api/auth/me");
    assert.equal(me.status, 401);
  });
});
