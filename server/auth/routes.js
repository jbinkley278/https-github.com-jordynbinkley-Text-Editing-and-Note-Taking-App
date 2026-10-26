import { Router } from "express";
import { getDb } from "../db.js";
import { config } from "../config.js";
import { verifyPassword } from "./passwords.js";
import {
  clearSessionCookieOptions,
  createSession,
  destroySession,
  findUserForSession,
  publicUser,
  sessionCookieOptions,
} from "./sessions.js";
import { validateLogin, validateRegistration, validateVerificationCode } from "./validation.js";
import { getTurnstilePublicConfig, verifyTurnstileToken } from "./turnstile.js";
import { createEmailAdapter, emailDeliveryConfigured } from "../email/adapter.js";
import {
  resendPendingRegistrationCode,
  startPendingRegistration,
  verifyPendingRegistration,
} from "./pendingRegistrations.js";
import { normalizeEmail } from "./validation.js";
function dbOr503(res) {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable. Try again when MongoDB is connected." });
    return null;
  }
  return db;
}

function sendAuthError(res, error) {
  const status = error.status ?? 500;
  if (status >= 500) console.error(error);
  const payload = { error: error.message || "Internal server error" };
  if (error.fields) payload.fields = error.fields;
  if (error.resendAvailableAt) payload.resendAvailableAt = error.resendAvailableAt;
  return res.status(status).json(payload);
}

/** Domain auth errors keep their status/fields; unexpected failures go to Express. */
function handleAuthCatch(res, next, error) {
  if (error?.status) {
    return sendAuthError(res, error);
  }
  return next(error);
}

/** @type {ReturnType<typeof createEmailAdapter> | null} */
let emailAdapterOverride = null;

/** Test hook: inject a memory email adapter without changing env mid-suite. */
export function setEmailAdapterForTests(adapter) {
  emailAdapterOverride = adapter;
}

export function resetEmailAdapterForTests() {
  emailAdapterOverride = null;
}

function getEmailAdapter() {
  return emailAdapterOverride ?? createEmailAdapter();
}

export function createAuthRouter() {
  const router = Router();

  router.get("/registration-config", (_req, res) => {
    const turnstile = getTurnstilePublicConfig();
    const emailReady = emailDeliveryConfigured()
      || config.emailAdapter === "memory"
      || Boolean(emailAdapterOverride);
    const pepperReady = Boolean(config.registrationCodePepper);
    const ready = turnstile.ok && emailReady && pepperReady;
    return res.json({
      turnstileSiteKey: turnstile.ok ? turnstile.siteKey : null,
      turnstileConfigured: turnstile.ok,
      emailConfigured: emailReady,
      registrationReady: ready,
      ...(turnstile.ok ? {} : { turnstileError: turnstile.error }),
      ...(!emailReady ? { emailError: "Email delivery is not configured (RESEND_API_KEY / EMAIL_FROM)." } : {}),
      ...(!pepperReady ? { pepperError: "REGISTRATION_CODE_PEPPER is not set." } : {}),
    });
  });

  router.post("/register", async (req, res, next) => {
    try {
      const db = dbOr503(res);
      if (!db) return;

      const parsed = validateRegistration(req.body ?? {});
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error, fields: parsed.fields });
      }

      const captcha = await verifyTurnstileToken({
        token: req.body?.turnstileToken ?? req.body?.["cf-turnstile-response"],
        remoteip: req.ip,
        expectedAction: "register",
      });
      if (!captcha.ok) {
        return res.status(400).json({
          error: captcha.error,
          fields: captcha.fields ?? { captcha: captcha.error },
        });
      }

      const { name, email, emailNormalized, password } = parsed.value;
      const result = await startPendingRegistration(db, {
        name,
        email,
        emailNormalized,
        password,
        req,
        emailAdapter: getEmailAdapter(),
      });
      return res.status(200).json(result);
    } catch (error) {
      return handleAuthCatch(res, next, error);
    }
  });

  router.post("/verify-email", async (req, res, next) => {
    try {
      const db = dbOr503(res);
      if (!db) return;

      const emailNormalized = normalizeEmail(req.body?.email);
      const codeParsed = validateVerificationCode(req.body?.code);
      if (!emailNormalized) {
        return res.status(400).json({
          error: "Email is required.",
          fields: { email: "Email is required." },
        });
      }
      if (!codeParsed.ok) {
        return res.status(400).json({ error: codeParsed.error, fields: codeParsed.fields });
      }

      const { user } = await verifyPendingRegistration(db, {
        emailNormalized,
        code: codeParsed.value,
        req,
      });
      const { token, expiresAt } = await createSession(db, user._id);
      res.cookie(config.sessionCookieName, token, sessionCookieOptions(expiresAt));
      return res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      return handleAuthCatch(res, next, error);
    }
  });

  router.post("/resend-code", async (req, res, next) => {
    try {
      const db = dbOr503(res);
      if (!db) return;

      const emailNormalized = normalizeEmail(req.body?.email);
      if (!emailNormalized) {
        return res.status(400).json({
          error: "Email is required.",
          fields: { email: "Email is required." },
        });
      }

      const result = await resendPendingRegistrationCode(db, {
        emailNormalized,
        req,
        emailAdapter: getEmailAdapter(),
      });
      return res.status(200).json(result);
    } catch (error) {
      return handleAuthCatch(res, next, error);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
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

      // Pending registrations live in a separate collection and cannot log in.
      // Existing users without emailVerified are grandfathered as verified.
      const { token, expiresAt } = await createSession(db, user._id);
      res.cookie(config.sessionCookieName, token, sessionCookieOptions(expiresAt));
      return res.json({ user: publicUser(user) });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/logout", async (req, res, next) => {
    try {
      const db = dbOr503(res);
      if (!db) return;

      const token = req.cookies?.[config.sessionCookieName];
      await destroySession(db, token);
      res.clearCookie(config.sessionCookieName, clearSessionCookieOptions());
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/me", async (req, res, next) => {
    try {
      const db = dbOr503(res);
      if (!db) return;

      const token = req.cookies?.[config.sessionCookieName];
      const found = await findUserForSession(db, token);
      if (!found) {
        return res.status(401).json({ error: "Not signed in." });
      }
      return res.json({ user: publicUser(found.user) });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
