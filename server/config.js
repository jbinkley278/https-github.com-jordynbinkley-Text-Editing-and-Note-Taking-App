import { config as loadEnv } from "dotenv";

loadEnv();

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function listEnv(name, fallbackList) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallbackList;
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}

/** Hostname-only allowlist entries (no scheme/port/path). */
function hostnameListEnv(name, fallbackList) {
  return listEnv(name, fallbackList).flatMap((raw) => {
    let host = String(raw).trim().toLowerCase();
    if (!host) return [];
    host = host.replace(/^https?:\/\//i, "");
    host = host.split("/")[0] ?? "";
    if (host.startsWith("[")) {
      const end = host.indexOf("]");
      host = end >= 0 ? host.slice(0, end + 1) : host;
    } else {
      host = host.replace(/:\d+$/, "");
    }
    return host ? [host] : [];
  });
}

export const config = {
  port: intEnv("PORT", 3000),
  mongodbUri: process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/groupflow",
  nodeEnv: process.env.NODE_ENV ?? "development",
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "gf.sid",
  /** Default session lifetime: 7 days */
  sessionTtlMs: intEnv("SESSION_TTL_MS", 7 * 24 * 60 * 60 * 1000),
  /** Invitation lifetime: 7 days */
  inviteTtlMs: intEnv("INVITE_TTL_MS", 7 * 24 * 60 * 60 * 1000),
  bcryptCost: intEnv("BCRYPT_COST", 12),

  // --- Registration human verification (Cloudflare Turnstile) ---
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY ?? "",
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY ?? "",
  /** Hostnames only — schemes/ports/paths are stripped at load time. */
  turnstileAllowedHostnames: hostnameListEnv("TURNSTILE_ALLOWED_HOSTNAMES", ["localhost", "127.0.0.1"]),

  // --- Email verification codes ---
  registrationCodePepper: process.env.REGISTRATION_CODE_PEPPER ?? "",
  registrationCodeTtlMs: intEnv("REGISTRATION_CODE_TTL_MS", 10 * 60 * 1000),
  registrationCodeMaxAttempts: intEnv("REGISTRATION_CODE_MAX_ATTEMPTS", 5),
  registrationResendCooldownMs: intEnv("REGISTRATION_RESEND_COOLDOWN_MS", 60 * 1000),
  registrationMaxStartsPerEmailPerHour: intEnv("REGISTRATION_MAX_STARTS_PER_EMAIL_PER_HOUR", 5),
  registrationMaxStartsPerIpPerHour: intEnv("REGISTRATION_MAX_STARTS_PER_IP_PER_HOUR", 20),
  registrationMaxVerifyPerIpPerHour: intEnv("REGISTRATION_MAX_VERIFY_PER_IP_PER_HOUR", 60),

  // --- Transactional email (Resend HTTPS API) ---
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "",
  /** "resend" | "memory" — tests set memory via EMAIL_ADAPTER */
  emailAdapter: process.env.EMAIL_ADAPTER ?? "resend",

  /** When true, verify responses may include the plaintext code (never in production). */
  exposeDevVerificationCode:
    (process.env.EXPOSE_DEV_VERIFICATION_CODE ?? "") === "1"
    && (process.env.NODE_ENV ?? "development") !== "production",
};
