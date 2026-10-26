import assert from "node:assert/strict";
import test from "node:test";
import { withServer } from "./helpers.mjs";

const uniqueEmail = () => `user_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`;

test("registration-config reports readiness for Turnstile and email", async () => {
  await withServer(async ({ request }) => {
    const result = await request("/api/auth/registration-config");
    assert.equal(result.status, 200);
    assert.equal(result.data.registrationReady, true);
    assert.equal(result.data.turnstileConfigured, true);
    assert.equal(result.data.emailConfigured, true);
    assert.ok(result.data.turnstileSiteKey);
  });
});

test("registration starts pending, sends a code, and verify creates a session", async () => {
  await withServer(async ({ request, jar, emailAdapter, db }) => {
    const email = uniqueEmail();
    const pending = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Sandesh Pariyar",
        email,
        password: "password123",
        turnstileToken: "test-token",
      },
    });
    assert.equal(pending.status, 200);
    assert.equal(pending.data.pending, true);
    assert.match(pending.data.emailMasked, /@example\.com$/);
    assert.equal(jar.hasSession(), false);
    assert.equal(await db.collection("users").countDocuments({ emailNormalized: email }), 0);
    assert.equal(emailAdapter.sent.length, 1);
    assert.equal(emailAdapter.sent[0].to, email.toLowerCase());
    assert.match(emailAdapter.sent[0].code, /^\d{6}$/);

    const code = pending.data.devCode ?? emailAdapter.sent[0].code;
    const verified = await request("/api/auth/verify-email", {
      method: "POST",
      body: { email, code },
    });
    assert.equal(verified.status, 201);
    assert.equal(verified.data.user.name, "Sandesh Pariyar");
    assert.equal(verified.data.user.email, email.toLowerCase());
    assert.equal(verified.data.user.emailVerified, true);
    assert.ok(verified.data.user.id);
    assert.equal(verified.data.user.passwordHash, undefined);
    assert.equal(jar.hasSession(), true);

    const me = await request("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.user.email, email.toLowerCase());

    const pendingLeft = await db.collection("pending_registrations").findOne({
      emailNormalized: email.toLowerCase(),
    });
    assert.equal(pendingLeft, null);
  });
});

test("duplicate active email registration is rejected", async () => {
  await withServer(async ({ request, register }) => {
    const { email } = await register("First User");

    const second = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Second User",
        email,
        password: "password456",
        turnstileToken: "test-token",
      },
    });
    assert.equal(second.status, 409);
    assert.match(second.data.error, /unable to start registration/i);
  });
});

test("incorrect verification code is rejected and pending user cannot log in", async () => {
  await withServer(async ({ request, jar, emailAdapter }) => {
    const email = uniqueEmail();
    const pending = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Pending User",
        email,
        password: "password123",
        turnstileToken: "test-token",
      },
    });
    assert.equal(pending.status, 200);
    const realCode = pending.data.devCode ?? emailAdapter.sent[0].code;
    assert.notEqual(realCode, "000000");

    const bad = await request("/api/auth/verify-email", {
      method: "POST",
      body: { email, code: "000000" },
    });
    assert.equal(bad.status, 401);
    assert.equal(jar.hasSession(), false);

    const login = await request("/api/auth/login", {
      method: "POST",
      body: { email, password: "password123" },
    });
    assert.equal(login.status, 401);
  });
});

test("incorrect password is rejected after verified registration", async () => {
  await withServer(async ({ request, jar, register }) => {
    const { email } = await register("Login User");
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
  await withServer(async ({ request, jar, register }) => {
    const { email } = await register("Session User");
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
  await withServer(async ({ request, jar, register }) => {
    await register("Logout User");
    assert.equal((await request("/api/auth/me")).status, 200);

    const logout = await request("/api/auth/logout", { method: "POST", body: {} });
    assert.equal(logout.status, 200);
    assert.equal(jar.hasSession(), false);

    const me = await request("/api/auth/me");
    assert.equal(me.status, 401);
  });
});

test("resend-code issues a new code after cooldown is cleared", async () => {
  await withServer(async ({ request, db, emailAdapter }) => {
    const email = uniqueEmail();
    const first = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Resend User",
        email,
        password: "password123",
        turnstileToken: "test-token",
      },
    });
    assert.equal(first.status, 200);
    const firstCode = first.data.devCode ?? emailAdapter.sent[0].code;

    const tooSoon = await request("/api/auth/resend-code", {
      method: "POST",
      body: { email },
    });
    assert.equal(tooSoon.status, 429);

    await db.collection("pending_registrations").updateOne(
      { emailNormalized: email.toLowerCase() },
      { $set: { resendAvailableAt: new Date(Date.now() - 1000) } },
    );

    const resent = await request("/api/auth/resend-code", {
      method: "POST",
      body: { email },
    });
    assert.equal(resent.status, 200);
    assert.equal(resent.data.pending, true);
    const secondCode = resent.data.devCode ?? emailAdapter.sent.at(-1)?.code;
    assert.ok(secondCode);
    assert.notEqual(secondCode, firstCode);
    assert.equal(emailAdapter.sent.length, 2);

    const stale = await request("/api/auth/verify-email", {
      method: "POST",
      body: { email, code: firstCode },
    });
    assert.equal(stale.status, 401);

    const ok = await request("/api/auth/verify-email", {
      method: "POST",
      body: { email, code: secondCode },
    });
    assert.equal(ok.status, 201);
  });
});

test("missing Turnstile token is rejected", async () => {
  await withServer(async ({ request }) => {
    // Restore real Turnstile validation for this assertion only.
    const { resetTurnstileVerifyForTests } = await import("../server/auth/turnstile.js");
    resetTurnstileVerifyForTests();

    const result = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "No Captcha",
        email: uniqueEmail(),
        password: "password123",
      },
    });
    assert.equal(result.status, 400);
    assert.match(result.data.error, /human verification/i);
  });
});
