import assert from "node:assert/strict";
import test from "node:test";
import {
  DUMMY_SITEVERIFY_HOSTNAMES,
  TURNSTILE_DUMMY_SECRET,
  TURNSTILE_DUMMY_SITE_KEY,
  TURNSTILE_DUMMY_TOKEN,
  getTurnstilePublicConfig,
  isOfficialDummyKeyPair,
  normalizeHostnameAllowlist,
  verifyTurnstileToken,
} from "../server/auth/turnstile.js";

function jsonResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    },
  };
}

test("normalizeHostnameAllowlist strips scheme, path, and port", () => {
  assert.deepEqual(
    normalizeHostnameAllowlist([
      "https://localhost:3000/",
      "http://127.0.0.1:5173/register",
      "groupflow.example",
      "  ",
    ]),
    ["localhost", "127.0.0.1", "groupflow.example"],
  );
});

test("official dummy key pair detection requires both sitekey and secret", () => {
  assert.equal(isOfficialDummyKeyPair(TURNSTILE_DUMMY_SITE_KEY, TURNSTILE_DUMMY_SECRET), true);
  assert.equal(isOfficialDummyKeyPair(TURNSTILE_DUMMY_SITE_KEY, "real-looking-secret"), false);
  assert.equal(isOfficialDummyKeyPair("real-site-key", TURNSTILE_DUMMY_SECRET), false);
});

test("production rejects official dummy keys in public config", () => {
  const cfg = getTurnstilePublicConfig({
    siteKey: TURNSTILE_DUMMY_SITE_KEY,
    secretKey: TURNSTILE_DUMMY_SECRET,
    nodeEnv: "production",
  });
  assert.equal(cfg.ok, false);
  assert.match(cfg.error, /dummy/i);
});

test("development accepts live dummy siteverify hostname example.com without allowlist match", async () => {
  assert.ok(DUMMY_SITEVERIFY_HOSTNAMES.has("example.com"));

  const result = await verifyTurnstileToken({
    token: TURNSTILE_DUMMY_TOKEN,
    expectedAction: "register",
    siteKey: TURNSTILE_DUMMY_SITE_KEY,
    secretKey: TURNSTILE_DUMMY_SECRET,
    allowedHostnames: ["localhost", "127.0.0.1"],
    nodeEnv: "development",
    fetchImpl: async () => jsonResponse({
      success: true,
      hostname: "example.com",
      challenge_ts: "2026-10-26T00:00:00.000Z",
      "error-codes": [],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.hostname, "example.com");
  assert.equal(result.dummyDevMode, true);
});

test("development accepts documented dummy siteverify action test and hostname localhost", async () => {
  const result = await verifyTurnstileToken({
    token: TURNSTILE_DUMMY_TOKEN,
    expectedAction: "register",
    siteKey: TURNSTILE_DUMMY_SITE_KEY,
    secretKey: TURNSTILE_DUMMY_SECRET,
    allowedHostnames: ["127.0.0.1"],
    nodeEnv: "development",
    fetchImpl: async () => jsonResponse({
      success: true,
      hostname: "localhost",
      action: "test",
      challenge_ts: "2022-02-28T15:14:30.096Z",
      "error-codes": [],
      cdata: "test-data",
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "test");
  assert.equal(result.dummyDevMode, true);
});

test("production never enters dummyDevMode even if siteverify returns example.com", async () => {
  const result = await verifyTurnstileToken({
    token: "real-looking-token",
    expectedAction: "register",
    siteKey: "production-site-key",
    secretKey: "production-secret-key",
    allowedHostnames: ["groupflow.example"],
    nodeEnv: "production",
    fetchImpl: async () => jsonResponse({
      success: true,
      hostname: "example.com",
      action: "register",
      "error-codes": [],
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /hostname/i);
  assert.equal(result.dummyDevMode, undefined);
});

test("production accepts matching hostname and action for real keys", async () => {
  const result = await verifyTurnstileToken({
    token: "real-looking-token",
    expectedAction: "register",
    siteKey: "production-site-key",
    secretKey: "production-secret-key",
    allowedHostnames: ["https://groupflow.example:443/path"],
    nodeEnv: "production",
    fetchImpl: async () => jsonResponse({
      success: true,
      hostname: "groupflow.example",
      action: "register",
      "error-codes": [],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.hostname, "groupflow.example");
  assert.equal(result.action, "register");
});

test("production rejects action mismatch for real keys", async () => {
  const result = await verifyTurnstileToken({
    token: "real-looking-token",
    expectedAction: "register",
    siteKey: "production-site-key",
    secretKey: "production-secret-key",
    allowedHostnames: ["groupflow.example"],
    nodeEnv: "production",
    fetchImpl: async () => jsonResponse({
      success: true,
      hostname: "groupflow.example",
      action: "login",
      "error-codes": [],
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /human verification failed/i);
});

test("development still enforces hostname allowlist when keys are not official dummies", async () => {
  const result = await verifyTurnstileToken({
    token: "real-looking-token",
    expectedAction: "register",
    siteKey: "custom-dev-site-key",
    secretKey: "custom-dev-secret",
    allowedHostnames: ["localhost", "127.0.0.1"],
    nodeEnv: "development",
    fetchImpl: async () => jsonResponse({
      success: true,
      hostname: "example.com",
      action: "register",
      "error-codes": [],
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /hostname/i);
});

test("dummy keys alone do not relax checks in production public config path", async () => {
  const result = await verifyTurnstileToken({
    token: TURNSTILE_DUMMY_TOKEN,
    expectedAction: "register",
    siteKey: TURNSTILE_DUMMY_SITE_KEY,
    secretKey: TURNSTILE_DUMMY_SECRET,
    allowedHostnames: ["localhost"],
    nodeEnv: "production",
    fetchImpl: async () => {
      throw new Error("siteverify must not be called when dummy keys are rejected");
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /dummy/i);
});
