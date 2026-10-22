export function validateGroupCreate({ name, description }) {
  const fields = {};
  const trimmedName = String(name ?? "").trim();
  const trimmedDescription = String(description ?? "").trim();

  if (!trimmedName) fields.name = "Group name is required.";
  else if (trimmedName.length > 80) fields.name = "Group name must be 80 characters or fewer.";

  if (trimmedDescription.length > 280) {
    fields.description = "Description must be 280 characters or fewer.";
  }

  if (Object.keys(fields).length) {
    return { ok: false, fields, error: "Please fix the highlighted fields." };
  }
  return {
    ok: true,
    value: { name: trimmedName, description: trimmedDescription },
  };
}

export function validateInviteCode(code) {
  const trimmed = String(code ?? "").trim();
  if (!trimmed) {
    return { ok: false, fields: { code: "Invitation code is required." }, error: "Invitation code is required." };
  }
  if (trimmed.length < 16 || trimmed.length > 128 || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return { ok: false, fields: { code: "Invitation code is not valid." }, error: "Invitation code is not valid." };
  }
  return { ok: true, value: { code: trimmed } };
}
