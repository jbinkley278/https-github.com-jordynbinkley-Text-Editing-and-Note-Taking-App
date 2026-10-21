const MAX_LENGTH = 500;

export function validateMessagePayload(body) {
  const fields = {};
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, fields: { text: "Message body must be a JSON object." }, error: "Invalid message payload." };
  }
  if (!("text" in body) || typeof body.text !== "string") {
    fields.text = "Message text is required.";
    return { ok: false, fields, error: "Please fix the highlighted fields." };
  }
  const text = body.text.trim();
  if (!text) fields.text = "Message cannot be blank.";
  else if (text.length > MAX_LENGTH) fields.text = `Message must be ${MAX_LENGTH} characters or fewer.`;

  if (Object.keys(fields).length) {
    return { ok: false, fields, error: "Please fix the highlighted fields." };
  }
  return { ok: true, value: { text } };
}

export { MAX_LENGTH };
