import { ObjectId } from "mongodb";

const MAX_LENGTH = 500;

/**
 * Text-only or caption + optional attachment.
 * Empty text is allowed when attachmentId is present.
 */
export function validateMessagePayload(body) {
  const fields = {};
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, fields: { text: "Message body must be a JSON object." }, error: "Invalid message payload." };
  }

  const hasText = "text" in body;
  const rawText = hasText ? body.text : "";
  if (hasText && typeof rawText !== "string") {
    fields.text = "Message text must be a string.";
  }
  const text = typeof rawText === "string" ? rawText.trim() : "";

  let attachmentId = null;
  if (body.attachmentId != null && body.attachmentId !== "") {
    const raw = String(body.attachmentId).trim();
    if (!ObjectId.isValid(raw)) {
      fields.attachmentId = "Invalid attachment id.";
    } else {
      attachmentId = raw;
    }
  }

  if (!text && !attachmentId) {
    fields.text = "Message cannot be blank.";
  } else if (text.length > MAX_LENGTH) {
    fields.text = `Message must be ${MAX_LENGTH} characters or fewer.`;
  }

  if (Object.keys(fields).length) {
    return { ok: false, fields, error: "Please fix the highlighted fields." };
  }
  return { ok: true, value: { text, attachmentId } };
}

export { MAX_LENGTH };
