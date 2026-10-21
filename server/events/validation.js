const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TZ_RE = /^[A-Za-z0-9_+\-/]+$/;

/**
 * @param {"create"|"update"} mode
 */
export function validateEventPayload(body, mode = "create") {
  const fields = {};
  const data = body ?? {};
  const patch = {};

  if (mode === "create" || "title" in data) {
    const title = String(data.title ?? "").trim();
    if (!title) fields.title = "Title is required.";
    else if (title.length > 80) fields.title = "Title must be 80 characters or fewer.";
    else patch.title = title;
  }

  if (mode === "create" || "date" in data) {
    const date = String(data.date ?? "").trim();
    if (!date) fields.date = "Date is required.";
    else if (!DATE_RE.test(date)) fields.date = "Date must be YYYY-MM-DD.";
    else patch.date = date;
  }

  if (mode === "create" || "startTime" in data) {
    const raw = data.startTime;
    if (raw === "" || raw === null || raw === undefined) {
      patch.startTime = null;
    } else {
      const startTime = String(raw).trim();
      if (!TIME_RE.test(startTime)) fields.startTime = "Time must be HH:MM (24-hour).";
      else patch.startTime = startTime;
    }
  } else if (mode === "create") {
    patch.startTime = null;
  }

  if (mode === "create" || "timeZone" in data || patch.startTime) {
    const timeZone = String(data.timeZone ?? "UTC").trim() || "UTC";
    if (timeZone.length > 64 || !TZ_RE.test(timeZone)) {
      fields.timeZone = "Enter a valid IANA timezone (for example America/Chicago).";
    } else {
      patch.timeZone = timeZone;
    }
  } else if (mode === "create") {
    patch.timeZone = "UTC";
  }

  if (mode === "create" || "description" in data) {
    const description = String(data.description ?? "").trim();
    if (description.length > 1000) fields.description = "Notes must be 1000 characters or fewer.";
    else patch.description = description;
  } else if (mode === "create") {
    patch.description = "";
  }

  if (Object.keys(fields).length) {
    return { ok: false, fields, error: "Please fix the highlighted fields." };
  }
  if (mode === "update" && !Object.keys(patch).length) {
    return { ok: false, fields: {}, error: "No changes provided." };
  }
  return { ok: true, value: patch };
}
