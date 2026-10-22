const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

/**
 * @returns {{ ok: true, value: { name: string, email: string, emailNormalized: string, password: string } } | { ok: false, fields: Record<string, string>, error: string }}
 */
export function validateRegistration({ name, email, password }) {
  const fields = {};
  const trimmedName = String(name ?? "").trim();
  const emailNormalized = normalizeEmail(email);
  const rawPassword = String(password ?? "");

  if (!trimmedName) fields.name = "Name is required.";
  else if (trimmedName.length > 80) fields.name = "Name must be 80 characters or fewer.";

  if (!emailNormalized) fields.email = "Email is required.";
  else if (!EMAIL_RE.test(emailNormalized) || emailNormalized.length > 254) {
    fields.email = "Enter a valid email address.";
  }

  if (!rawPassword) fields.password = "Password is required.";
  else if (rawPassword.length < 8) fields.password = "Password must be at least 8 characters.";
  else if (rawPassword.length > 128) fields.password = "Password must be 128 characters or fewer.";

  if (Object.keys(fields).length) {
    return { ok: false, fields, error: "Please fix the highlighted fields." };
  }
  return {
    ok: true,
    value: { name: trimmedName, email: emailNormalized, emailNormalized, password: rawPassword },
  };
}

/**
 * @returns {{ ok: true, value: { emailNormalized: string, password: string } } | { ok: false, fields: Record<string, string>, error: string }}
 */
export function validateLogin({ email, password }) {
  const fields = {};
  const emailNormalized = normalizeEmail(email);
  const rawPassword = String(password ?? "");

  if (!emailNormalized) fields.email = "Email is required.";
  else if (!EMAIL_RE.test(emailNormalized)) fields.email = "Enter a valid email address.";
  if (!rawPassword) fields.password = "Password is required.";

  if (Object.keys(fields).length) {
    return { ok: false, fields, error: "Please fix the highlighted fields." };
  }
  return { ok: true, value: { emailNormalized, password: rawPassword } };
}
