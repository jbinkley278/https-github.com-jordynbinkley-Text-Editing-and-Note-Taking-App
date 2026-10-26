import crypto from "node:crypto";
import { config } from "../config.js";

/** Six-digit numeric code as a string (preserves leading zeros). */
export function generateRegistrationCode() {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

/**
 * Keyed protection for the small OTP space: HMAC-SHA256(code, pepper).
 * Never store or log the plaintext code.
 */
export function hashRegistrationCode(code, pepper = config.registrationCodePepper) {
  if (!pepper) {
    throw new Error("REGISTRATION_CODE_PEPPER is required to protect verification codes.");
  }
  return crypto
    .createHmac("sha256", pepper)
    .update(String(code), "utf8")
    .digest("hex");
}

export function codesMatch(plaintextCode, storedHash, pepper = config.registrationCodePepper) {
  const incoming = hashRegistrationCode(plaintextCode, pepper);
  const a = Buffer.from(incoming, "utf8");
  const b = Buffer.from(String(storedHash ?? ""), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function maskEmail(email) {
  const raw = String(email ?? "").trim().toLowerCase();
  const at = raw.indexOf("@");
  if (at <= 0) return "***";
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}
