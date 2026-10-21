import { config as loadEnv } from "dotenv";

loadEnv();

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
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
};
