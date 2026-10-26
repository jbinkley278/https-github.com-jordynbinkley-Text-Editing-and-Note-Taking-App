import { config } from "../config.js";

/**
 * Replaceable email delivery adapter.
 * - production/dev with credentials: Resend HTTPS API
 * - tests: inject sendImpl / use createMemoryEmailAdapter()
 */

export function emailDeliveryConfigured({
  apiKey = config.resendApiKey,
  from = config.emailFrom,
} = {}) {
  return Boolean(apiKey && from);
}

export function createMemoryEmailAdapter() {
  /** @type {Array<{ to: string, subject: string, text: string, html: string, code?: string }>} */
  const sent = [];
  return {
    kind: "memory",
    sent,
    async sendVerificationCode({ to, code, maskedTo }) {
      sent.push({
        to,
        subject: "Your GroupFlow verification code",
        text: `Your GroupFlow verification code is ${code}. It expires in 10 minutes.`,
        html: `<p>Your GroupFlow verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
        code,
        maskedTo,
      });
      return { ok: true, id: `memory-${sent.length}` };
    },
  };
}

/**
 * @param {object} [options]
 * @param {(url: string, init: RequestInit) => Promise<Response>} [options.fetchImpl]
 */
export function createResendEmailAdapter({
  apiKey = config.resendApiKey,
  from = config.emailFrom,
  fetchImpl = fetch,
} = {}) {
  return {
    kind: "resend",
    async sendVerificationCode({ to, code }) {
      if (!apiKey || !from) {
        return {
          ok: false,
          error: "Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.",
        };
      }

      try {
        const response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "User-Agent": "GroupFlow/0.1",
          },
          body: JSON.stringify({
            from,
            to: [to],
            subject: "Your GroupFlow verification code",
            text: `Your GroupFlow verification code is ${code}. It expires in 10 minutes.`,
            html: `<p>Your GroupFlow verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          return {
            ok: false,
            error: "Could not send the verification email. Try again later.",
            providerStatus: response.status,
          };
        }
        return { ok: true, id: data?.id ?? null };
      } catch {
        return {
          ok: false,
          error: "Could not send the verification email. Try again later.",
        };
      }
    },
  };
}

/** Default adapter for the running server. */
export function createEmailAdapter() {
  if (config.emailAdapter === "memory") {
    return createMemoryEmailAdapter();
  }
  return createResendEmailAdapter();
}
