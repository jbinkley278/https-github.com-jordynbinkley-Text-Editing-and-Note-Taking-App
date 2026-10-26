import { config } from "../config.js";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Official Cloudflare dummy keys — development/tests only.
 * @see https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
export const TURNSTILE_DUMMY_SITE_KEY = "1x00000000000000000000AA";
export const TURNSTILE_DUMMY_SECRET = "1x0000000000000000000000000000000AA";
export const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/** Always-passes visible sitekey (same as TURNSTILE_DUMMY_SITE_KEY). */
const OFFICIAL_DUMMY_SITE_KEYS = new Set([
  "1x00000000000000000000AA", // always passes (visible)
  "2x00000000000000000000AB", // always fails (visible)
  "1x00000000000000000000BB", // always passes (invisible)
  "2x00000000000000000000BB", // always fails (invisible)
  "3x00000000000000000000FF", // forces interactive challenge
]);

const OFFICIAL_DUMMY_SECRETS = new Set([
  "1x0000000000000000000000000000000AA", // always passes validation
  "2x0000000000000000000000000000000AA", // always fails validation
  "3x0000000000000000000000000000000AA", // token already spent
]);

/**
 * Hostnames observed / documented for official dummy siteverify success payloads.
 * Live always-pass secret currently returns `example.com` (not the page hostname).
 * Docs example uses `localhost` with `action: "test"`.
 */
export const DUMMY_SITEVERIFY_HOSTNAMES = new Set(["example.com", "localhost"]);

/** @type {null | ((opts: object) => Promise<object>)} */
let verifyOverride = null;

/** Test hook: short-circuit siteverify (no network). */
export function setTurnstileVerifyForTests(fn) {
  verifyOverride = fn;
}

export function resetTurnstileVerifyForTests() {
  verifyOverride = null;
}

export function isOfficialDummySiteKey(siteKey) {
  return OFFICIAL_DUMMY_SITE_KEYS.has(String(siteKey ?? ""));
}

export function isOfficialDummySecret(secretKey) {
  return OFFICIAL_DUMMY_SECRETS.has(String(secretKey ?? ""));
}

/** True only when both the configured sitekey and secret are official Cloudflare test keys. */
export function isOfficialDummyKeyPair(siteKey, secretKey) {
  return isOfficialDummySiteKey(siteKey) && isOfficialDummySecret(secretKey);
}

export function isNonProductionTurnstileEnv(nodeEnv = config.nodeEnv) {
  return nodeEnv !== "production";
}

/**
 * Strip scheme, path, and port so allowlists stay hostname-only.
 * @param {string[]} entries
 * @returns {string[]}
 */
export function normalizeHostnameAllowlist(entries) {
  const out = [];
  for (const raw of entries ?? []) {
    let host = String(raw ?? "").trim().toLowerCase();
    if (!host) continue;
    host = host.replace(/^https?:\/\//i, "");
    host = host.split("/")[0] ?? "";
    if (host.startsWith("[")) {
      const end = host.indexOf("]");
      host = end >= 0 ? host.slice(0, end + 1) : host;
    } else {
      host = host.replace(/:\d+$/, "");
    }
    if (host) out.push(host);
  }
  return out;
}

function hostnameAllowed(hostname, allowedHostnames) {
  const normalized = String(hostname ?? "").toLowerCase();
  if (!normalized) return false;
  return allowedHostnames.some((host) => {
    const h = host.toLowerCase();
    return normalized === h || normalized.endsWith(`.${h}`);
  });
}

/**
 * @param {object} [overrides]
 * @returns {{ ok: true, siteKey: string } | { ok: false, error: string }}
 */
export function getTurnstilePublicConfig(overrides = {}) {
  const siteKey = overrides.siteKey ?? config.turnstileSiteKey;
  const secret = overrides.secretKey ?? config.turnstileSecretKey;
  const nodeEnv = overrides.nodeEnv ?? config.nodeEnv;

  if (!siteKey || !secret) {
    return {
      ok: false,
      error: "Human verification is not configured. Set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY.",
    };
  }

  if (nodeEnv === "production") {
    if (isOfficialDummySiteKey(siteKey) || isOfficialDummySecret(secret)) {
      return {
        ok: false,
        error: "Dummy Turnstile keys are not allowed in production.",
      };
    }
  }

  return { ok: true, siteKey };
}

/**
 * Server-side Turnstile validation. Never trust a client success flag.
 * @param {object} options
 * @param {string} options.token
 * @param {string} [options.remoteip]
 * @param {string} [options.expectedAction]
 * @param {(url: string, init: RequestInit) => Promise<Response>} [options.fetchImpl]
 */
export async function verifyTurnstileToken({
  token,
  remoteip,
  expectedAction = "register",
  fetchImpl = fetch,
  siteKey = config.turnstileSiteKey,
  secretKey = config.turnstileSecretKey,
  allowedHostnames = config.turnstileAllowedHostnames,
  nodeEnv = config.nodeEnv,
} = {}) {
  if (verifyOverride) {
    return verifyOverride({ token, remoteip, expectedAction });
  }

  const publicCfg = getTurnstilePublicConfig({ siteKey, secretKey, nodeEnv });
  if (!publicCfg.ok) {
    return { ok: false, error: publicCfg.error, fields: { captcha: publicCfg.error } };
  }

  const responseToken = String(token ?? "").trim();
  if (!responseToken) {
    return {
      ok: false,
      error: "Complete the human verification challenge.",
      fields: { captcha: "Complete the human verification challenge." },
    };
  }

  let payload;
  try {
    const body = new URLSearchParams();
    body.set("secret", secretKey);
    body.set("response", responseToken);
    if (remoteip) body.set("remoteip", remoteip);

    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    payload = await response.json();
  } catch {
    return {
      ok: false,
      error: "Human verification service is unavailable. Try again.",
      fields: { captcha: "Human verification service is unavailable. Try again." },
    };
  }

  if (!payload?.success) {
    const codes = Array.isArray(payload?.["error-codes"]) ? payload["error-codes"] : [];
    const expired = codes.includes("timeout-or-duplicate") || codes.includes("invalid-input-response");
    const message = expired
      ? "Human verification expired or already used. Complete the challenge again."
      : "Human verification failed. Complete the challenge again.";
    return { ok: false, error: message, fields: { captcha: message }, errorCodes: codes };
  }

  const allowlist = normalizeHostnameAllowlist(allowedHostnames);
  const hostname = String(payload.hostname ?? "").toLowerCase();
  const action = payload.action == null || payload.action === ""
    ? null
    : String(payload.action);

  // Official Cloudflare test keys: siteverify does not mirror the browser page.
  // Live always-pass secret returns hostname "example.com" (docs example: "localhost",
  // action "test"). Only relax checks outside production and only for recognized dummy pairs.
  const dummyDevMode = isNonProductionTurnstileEnv(nodeEnv)
    && isOfficialDummyKeyPair(siteKey, secretKey);

  if (dummyDevMode) {
    const dummyHostnameOk = !hostname || DUMMY_SITEVERIFY_HOSTNAMES.has(hostname)
      || hostnameAllowed(hostname, allowlist);
    if (!dummyHostnameOk) {
      return {
        ok: false,
        error: "Human verification failed hostname checks.",
        fields: { captcha: "Human verification failed hostname checks." },
        hostname,
        action,
        dummyDevMode: true,
      };
    }
    // Documented dummy action is "test"; live response often omits action entirely.
    if (action && action !== expectedAction && action !== "test") {
      return {
        ok: false,
        error: "Human verification failed. Complete the challenge again.",
        fields: { captcha: "Human verification failed. Complete the challenge again." },
        hostname,
        action,
        dummyDevMode: true,
      };
    }
    return {
      ok: true,
      hostname,
      challengeTs: payload.challenge_ts ?? null,
      action,
      dummyDevMode: true,
    };
  }

  if (expectedAction && action && action !== expectedAction) {
    return {
      ok: false,
      error: "Human verification failed. Complete the challenge again.",
      fields: { captcha: "Human verification failed. Complete the challenge again." },
      hostname,
      action,
    };
  }

  if (allowlist.length > 0 && !hostnameAllowed(hostname, allowlist)) {
    return {
      ok: false,
      error: "Human verification failed hostname checks.",
      fields: { captcha: "Human verification failed hostname checks." },
      hostname,
      action,
    };
  }

  return {
    ok: true,
    hostname,
    challengeTs: payload.challenge_ts ?? null,
    action,
  };
}
