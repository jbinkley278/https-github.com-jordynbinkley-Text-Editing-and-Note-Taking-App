import { Router } from "express";
import { getDb } from "../db.js";
import { config } from "../config.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import {
  clearSessionCookieOptions,
  createSession,
  destroySession,
  findUserForSession,
  publicUser,
  sessionCookieOptions,
} from "./sessions.js";
import { validateLogin, validateRegistration } from "./validation.js";

function dbOr503(res) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable. Try again when MongoDB is connected." });
    return null;
  }
  return db;
}

export function createAuthRouter() {
  const router = Router();

  router.post("/register", async (req, res) => {
    const db = dbOr503(res);
    if (!db) return;

    const parsed = validateRegistration(req.body ?? {});
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error, fields: parsed.fields });
    }

    const { name, email, emailNormalized, password } = parsed.value;
    const existing = await db.collection("users").findOne({ emailNormalized });
    if (existing) {
      return res.status(409).json({
        error: "An account with this email already exists.",
        fields: { email: "An account with this email already exists." },
      });
    }

    const passwordHash = await hashPassword(password);
    const now = new Date();
    let insertedId;
    try {
      const result = await db.collection("users").insertOne({
        name,
        email,
        emailNormalized,
        passwordHash,
        createdAt: now,
      });
      insertedId = result.insertedId;
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          error: "An account with this email already exists.",
          fields: { email: "An account with this email already exists." },
        });
      }
      throw error;
    }

    const { token, expiresAt } = await createSession(db, insertedId);
    res.cookie(config.sessionCookieName, token, sessionCookieOptions(expiresAt));
    const user = { _id: insertedId, name, email };
    return res.status(201).json({ user: publicUser(user) });
  });

  router.post("/login", async (req, res) => {
    const db = dbOr503(res);
    if (!db) return;

    const parsed = validateLogin(req.body ?? {});
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error, fields: parsed.fields });
    }

    const { emailNormalized, password } = parsed.value;
    const user = await db.collection("users").findOne({ emailNormalized });
    const valid = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !valid) {
      return res.status(401).json({
        error: "Incorrect email or password.",
        fields: { password: "Incorrect email or password." },
      });
    }

    const { token, expiresAt } = await createSession(db, user._id);
    res.cookie(config.sessionCookieName, token, sessionCookieOptions(expiresAt));
    return res.json({ user: publicUser(user) });
  });

  router.post("/logout", async (req, res) => {
    const db = dbOr503(res);
    if (!db) return;

    const token = req.cookies?.[config.sessionCookieName];
    await destroySession(db, token);
    res.clearCookie(config.sessionCookieName, clearSessionCookieOptions());
    return res.json({ ok: true });
  });

  router.get("/me", async (req, res) => {
    const db = dbOr503(res);
    if (!db) return;

    const token = req.cookies?.[config.sessionCookieName];
    const found = await findUserForSession(db, token);
    if (!found) {
      return res.status(401).json({ error: "Not signed in." });
    }
    return res.json({ user: publicUser(found.user) });
  });

  return router;
}
