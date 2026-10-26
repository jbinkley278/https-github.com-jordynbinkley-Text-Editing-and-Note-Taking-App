import { ObjectId } from "mongodb";
import { config } from "../config.js";
import { hashPassword } from "./passwords.js";
import {
  codesMatch,
  generateRegistrationCode,
  hashRegistrationCode,
  maskEmail,
} from "./registrationCodes.js";

const PURPOSE = "registration_verification";

export async function ensurePendingRegistrationIndexes(db) {
  await db.collection("pending_registrations").createIndex(
    { emailNormalized: 1 },
    { unique: true },
  );
  await db.collection("pending_registrations").createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 },
  );
  await db.collection("registration_rate_limits").createIndex(
    { key: 1 },
    { unique: true },
  );
  await db.collection("registration_rate_limits").createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 },
  );
}

async function bumpRateLimit(db, key, limit, windowMs) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);
  const doc = await db.collection("registration_rate_limits").findOne({ key });
  let count = 1;
  let startedAt = now;
  if (doc && doc.startedAt > windowStart) {
    count = (doc.count ?? 0) + 1;
    startedAt = doc.startedAt;
  }
  if (count > limit) {
    return { ok: false, count, limit };
  }
  const expiresAt = new Date(startedAt.getTime() + windowMs);
  await db.collection("registration_rate_limits").updateOne(
    { key },
    { $set: { key, count, startedAt, expiresAt, updatedAt: now } },
    { upsert: true },
  );
  return { ok: true, count, limit };
}

function clientIp(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req?.ip || req?.socket?.remoteAddress || "unknown";
}

/**
 * Start or refresh a pending registration and send a verification code.
 * Does not create a session or active user.
 */
export async function startPendingRegistration(db, {
  name,
  email,
  emailNormalized,
  password,
  req,
  emailAdapter,
  now = new Date(),
}) {
  if (!config.registrationCodePepper) {
    const error = new Error("Registration verification is not configured (REGISTRATION_CODE_PEPPER).");
    error.status = 503;
    throw error;
  }
  if (!emailAdapter) {
    const error = new Error("Email delivery is not configured.");
    error.status = 503;
    throw error;
  }

  const existingUser = await db.collection("users").findOne({ emailNormalized });
  if (existingUser) {
    // Do not reveal whether the email is pending vs active beyond a generic conflict.
    const error = new Error("Unable to start registration for this email. Try signing in or use a different email.");
    error.status = 409;
    error.fields = { email: "Unable to start registration for this email." };
    throw error;
  }

  const ip = clientIp(req);
  const hourMs = 60 * 60 * 1000;
  const emailLimit = await bumpRateLimit(
    db,
    `reg-start-email:${emailNormalized}`,
    config.registrationMaxStartsPerEmailPerHour,
    hourMs,
  );
  if (!emailLimit.ok) {
    const error = new Error("Too many registration attempts for this email. Try again later.");
    error.status = 429;
    throw error;
  }
  const ipLimit = await bumpRateLimit(
    db,
    `reg-start-ip:${ip}`,
    config.registrationMaxStartsPerIpPerHour,
    hourMs,
  );
  if (!ipLimit.ok) {
    const error = new Error("Too many registration attempts from this network. Try again later.");
    error.status = 429;
    throw error;
  }

  const passwordHash = await hashPassword(password);
  const code = generateRegistrationCode();
  const codeHash = hashRegistrationCode(code);
  const expiresAt = new Date(now.getTime() + config.registrationCodeTtlMs);
  const resendAvailableAt = new Date(now.getTime() + config.registrationResendCooldownMs);

  await db.collection("pending_registrations").updateOne(
    { emailNormalized },
    {
      $set: {
        name,
        email: emailNormalized,
        emailNormalized,
        passwordHash,
        purpose: PURPOSE,
        codeHash,
        codeIssuedAt: now,
        expiresAt,
        failedAttempts: 0,
        resendAvailableAt,
        lastIp: ip,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
      $inc: { issueCount: 1 },
    },
    { upsert: true },
  );

  const sent = await emailAdapter.sendVerificationCode({
    to: emailNormalized,
    code,
    maskedTo: maskEmail(emailNormalized),
  });
  if (!sent.ok) {
    // Leave pending row so the user can retry resend; surface send failure clearly.
    const error = new Error(sent.error || "Could not send the verification email.");
    error.status = 502;
    error.fields = { email: error.message };
    throw error;
  }

  const payload = {
    pending: true,
    emailMasked: maskEmail(emailNormalized),
    email: emailNormalized,
    resendAvailableAt: resendAvailableAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  if (config.exposeDevVerificationCode) {
    payload.devCode = code;
  }
  return payload;
}

export async function resendPendingRegistrationCode(db, {
  emailNormalized,
  req,
  emailAdapter,
  now = new Date(),
}) {
  if (!config.registrationCodePepper) {
    const error = new Error("Registration verification is not configured.");
    error.status = 503;
    throw error;
  }

  const ip = clientIp(req);
  const hourMs = 60 * 60 * 1000;
  const ipLimit = await bumpRateLimit(
    db,
    `reg-start-ip:${ip}`,
    config.registrationMaxStartsPerIpPerHour,
    hourMs,
  );
  if (!ipLimit.ok) {
    const error = new Error("Too many registration attempts from this network. Try again later.");
    error.status = 429;
    throw error;
  }

  const pending = await db.collection("pending_registrations").findOne({ emailNormalized });
  // Generic response if missing — avoid account enumeration.
  if (!pending || pending.purpose !== PURPOSE) {
    const error = new Error("No pending registration found for this email. Start registration again.");
    error.status = 404;
    throw error;
  }

  if (pending.resendAvailableAt && pending.resendAvailableAt > now) {
    const error = new Error("Please wait before requesting another code.");
    error.status = 429;
    error.resendAvailableAt = pending.resendAvailableAt.toISOString();
    throw error;
  }

  const emailLimit = await bumpRateLimit(
    db,
    `reg-start-email:${emailNormalized}`,
    config.registrationMaxStartsPerEmailPerHour,
    hourMs,
  );
  if (!emailLimit.ok) {
    const error = new Error("Too many registration attempts for this email. Try again later.");
    error.status = 429;
    throw error;
  }

  const code = generateRegistrationCode();
  const codeHash = hashRegistrationCode(code);
  const expiresAt = new Date(now.getTime() + config.registrationCodeTtlMs);
  const resendAvailableAt = new Date(now.getTime() + config.registrationResendCooldownMs);

  await db.collection("pending_registrations").updateOne(
    { _id: pending._id },
    {
      $set: {
        codeHash,
        codeIssuedAt: now,
        expiresAt,
        failedAttempts: 0,
        resendAvailableAt,
        lastIp: ip,
        updatedAt: now,
      },
      $inc: { issueCount: 1 },
    },
  );

  const sent = await emailAdapter.sendVerificationCode({
    to: emailNormalized,
    code,
    maskedTo: maskEmail(emailNormalized),
  });
  if (!sent.ok) {
    const error = new Error(sent.error || "Could not send the verification email.");
    error.status = 502;
    throw error;
  }

  const payload = {
    pending: true,
    emailMasked: maskEmail(emailNormalized),
    email: emailNormalized,
    resendAvailableAt: resendAvailableAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  if (config.exposeDevVerificationCode) {
    payload.devCode = code;
  }
  return payload;
}

/**
 * Verify code, create active user once, delete pending row.
 * @returns {{ user: object }}
 */
export async function verifyPendingRegistration(db, {
  emailNormalized,
  code,
  req,
  now = new Date(),
}) {
  const ip = clientIp(req);
  const hourMs = 60 * 60 * 1000;
  const ipLimit = await bumpRateLimit(
    db,
    `reg-verify-ip:${ip}`,
    config.registrationMaxVerifyPerIpPerHour,
    hourMs,
  );
  if (!ipLimit.ok) {
    const error = new Error("Too many verification attempts. Try again later.");
    error.status = 429;
    throw error;
  }

  const pending = await db.collection("pending_registrations").findOne({ emailNormalized });
  if (!pending || pending.purpose !== PURPOSE) {
    const error = new Error("No pending registration found. Start registration again.");
    error.status = 404;
    throw error;
  }

  if (pending.expiresAt && pending.expiresAt <= now) {
    await db.collection("pending_registrations").deleteOne({ _id: pending._id });
    const error = new Error("This verification code has expired. Request a new code.");
    error.status = 410;
    throw error;
  }

  if ((pending.failedAttempts ?? 0) >= config.registrationCodeMaxAttempts) {
    const error = new Error("Too many incorrect codes. Request a new verification code.");
    error.status = 429;
    throw error;
  }

  const normalizedCode = String(code ?? "").trim();
  if (!/^\d{6}$/.test(normalizedCode) || !codesMatch(normalizedCode, pending.codeHash)) {
    const failedAttempts = (pending.failedAttempts ?? 0) + 1;
    await db.collection("pending_registrations").updateOne(
      { _id: pending._id },
      { $set: { failedAttempts, updatedAt: now } },
    );
    const remaining = Math.max(0, config.registrationCodeMaxAttempts - failedAttempts);
    const error = new Error(
      remaining > 0
        ? "Incorrect verification code."
        : "Too many incorrect codes. Request a new verification code.",
    );
    error.status = remaining > 0 ? 401 : 429;
    error.fields = { code: error.message };
    throw error;
  }

  // Consume pending row first to prevent concurrent double activation.
  const consumed = await db.collection("pending_registrations").findOneAndDelete({
    _id: pending._id,
    codeHash: pending.codeHash,
  });
  if (!consumed) {
    const error = new Error("This verification code was already used. Sign in or register again.");
    error.status = 409;
    throw error;
  }

  const pendingDoc = consumed.value ?? consumed; // driver version variance
  const doc = pendingDoc?.emailNormalized ? pendingDoc : pending;

  let insertedId;
  try {
    const result = await db.collection("users").insertOne({
      name: doc.name,
      email: doc.emailNormalized,
      emailNormalized: doc.emailNormalized,
      passwordHash: doc.passwordHash,
      emailVerified: true,
      createdAt: now,
    });
    insertedId = result.insertedId;
  } catch (error) {
    if (error?.code === 11000) {
      const err = new Error("Unable to complete registration for this email. Try signing in.");
      err.status = 409;
      throw err;
    }
    // Restore pending so the user can retry if insert failed for other reasons.
    await db.collection("pending_registrations").insertOne({
      ...doc,
      _id: doc._id instanceof ObjectId ? doc._id : new ObjectId(doc._id),
      updatedAt: now,
    }).catch(() => {});
    throw error;
  }

  return {
    user: {
      _id: insertedId,
      name: doc.name,
      email: doc.emailNormalized,
    },
  };
}

export { PURPOSE as REGISTRATION_PURPOSE, clientIp, maskEmail };
