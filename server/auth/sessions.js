import crypto from "node:crypto";
import { ObjectId } from "mongodb";
import { config } from "../config.js";

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function publicUser(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    email: doc.email,
  };
}

export async function ensureAuthIndexes(db) {
  await db.collection("users").createIndex({ emailNormalized: 1 }, { unique: true });
  await db.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true });
  await db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export async function createSession(db, userId) {
  const token = createSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionTtlMs);
  await db.collection("sessions").insertOne({
    tokenHash: hashToken(token),
    userId: userId instanceof ObjectId ? userId : new ObjectId(userId),
    createdAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function findUserForSession(db, token) {
  if (!token) return null;
  const session = await db.collection("sessions").findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;
  const user = await db.collection("users").findOne({ _id: session.userId });
  if (!user) return null;
  return { user, session };
}

export async function destroySession(db, token) {
  if (!token) return false;
  const result = await db.collection("sessions").deleteOne({ tokenHash: hashToken(token) });
  return result.deletedCount > 0;
}

export function sessionCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/",
    expires: expiresAt,
  };
}

export function clearSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/",
    maxAge: 0,
  };
}
