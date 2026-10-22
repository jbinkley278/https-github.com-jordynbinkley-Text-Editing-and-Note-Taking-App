import { getDb } from "../db.js";
import { config } from "../config.js";
import { findUserForSession } from "../auth/sessions.js";

export function dbOr503(res) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable. Try again when MongoDB is connected." });
    return null;
  }
  return db;
}

/** Requires a valid HttpOnly session. Sets req.user and req.sessionDoc. */
export async function requireAuth(req, res, next) {
  try {
    const db = dbOr503(res);
    if (!db) return;
    const token = req.cookies?.[config.sessionCookieName];
    const found = await findUserForSession(db, token);
    if (!found) {
      return res.status(401).json({ error: "Not signed in." });
    }
    req.db = db;
    req.user = found.user;
    req.sessionDoc = found.session;
    return next();
  } catch (error) {
    return next(error);
  }
}
