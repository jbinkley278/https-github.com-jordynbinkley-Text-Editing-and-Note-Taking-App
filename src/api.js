/** JSON fetch helper. Auth uses HttpOnly cookies — never store credentials in localStorage. */
export async function api(path, { method = "GET", body, headers } = {}) {
  const response = await fetch(path, {
    method,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  return { ok: response.ok, status: response.status, data: data ?? {} };
}

export function fetchCurrentUser() {
  return api("/api/auth/me");
}

export function fetchRegistrationConfig() {
  return api("/api/auth/registration-config");
}

export function registerUser(fields) {
  return api("/api/auth/register", { method: "POST", body: fields });
}

export function verifyEmail(fields) {
  return api("/api/auth/verify-email", { method: "POST", body: fields });
}

export function resendVerificationCode(fields) {
  return api("/api/auth/resend-code", { method: "POST", body: fields });
}

export function loginUser(fields) {
  return api("/api/auth/login", { method: "POST", body: fields });
}

export function logoutUser() {
  return api("/api/auth/logout", { method: "POST", body: {} });
}

export function listGroups() {
  return api("/api/groups");
}

export function createGroup(fields) {
  return api("/api/groups", { method: "POST", body: fields });
}

export function fetchGroup(groupId) {
  return api(`/api/groups/${encodeURIComponent(groupId)}`);
}

export function fetchGroupMembers(groupId) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/members`);
}

export function fetchMemberProfile(groupId, memberId) {
  return api(
    `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
  );
}

export function createInvitation(groupId) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/invitations`, {
    method: "POST",
    body: {},
  });
}

export function revokeInvitation(groupId, inviteId) {
  return api(
    `/api/groups/${encodeURIComponent(groupId)}/invitations/${encodeURIComponent(inviteId)}/revoke`,
    { method: "POST", body: {} },
  );
}

export function previewInvitation(code) {
  return api(`/api/groups/invitations/preview?code=${encodeURIComponent(code)}`);
}

export function joinGroup(code) {
  return api("/api/groups/join", { method: "POST", body: { code } });
}

export function listTasks(groupId) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/tasks`);
}

export function createTask(groupId, fields) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/tasks`, {
    method: "POST",
    body: fields,
  });
}

export function updateTask(groupId, taskId, fields) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    body: fields,
  });
}

export function deleteTask(groupId, taskId) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
}

export function listMessages(groupId) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/messages`);
}

export function sendMessage(groupId, { text = "", attachmentId = null } = {}) {
  const body = { text };
  if (attachmentId) body.attachmentId = attachmentId;
  return api(`/api/groups/${encodeURIComponent(groupId)}/messages`, {
    method: "POST",
    body,
  });
}

export function attachmentDownloadUrl(groupId, attachmentId, { inline = false } = {}) {
  const base = `/api/groups/${encodeURIComponent(groupId)}/attachments/${encodeURIComponent(attachmentId)}`;
  return inline ? `${base}?disposition=inline` : base;
}

/**
 * Upload a chat attachment (multipart). Optional onProgress(0–100).
 */
export function uploadAttachment(groupId, file, { onProgress } = {}) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/groups/${encodeURIComponent(groupId)}/messages/attachments`);
    xhr.withCredentials = true;
    xhr.responseType = "json";
    if (typeof onProgress === "function") {
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        onProgress(Math.round((event.loaded / event.total) * 100));
      };
    }
    xhr.onload = () => {
      const data = xhr.response ?? {};
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        data: typeof data === "object" && data ? data : { error: "Upload failed." },
      });
    };
    xhr.onerror = () => {
      resolve({ ok: false, status: 0, data: { error: "Could not reach the server." } });
    };
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

export function deleteAttachment(groupId, attachmentId) {
  return api(
    `/api/groups/${encodeURIComponent(groupId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: "DELETE" },
  );
}

export function fetchUnreadCount(groupId) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/messages/unread`);
}

export function markMessagesRead(groupId, upToMessageId) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/messages/read`, {
    method: "POST",
    body: { upToMessageId },
  });
}

export function listEvents(groupId) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/events`);
}

export function createEvent(groupId, fields) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/events`, {
    method: "POST",
    body: fields,
  });
}

export function updateEvent(groupId, eventId, fields) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: fields,
  });
}

export function deleteEvent(groupId, eventId) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
}

export function listActivity(groupId, { limit, actorId } = {}) {
  const params = new URLSearchParams();
  if (limit != null) params.set("limit", String(limit));
  if (actorId) params.set("actorId", actorId);
  const query = params.toString();
  return api(`/api/groups/${encodeURIComponent(groupId)}/activity${query ? `?${query}` : ""}`);
}

export function fetchActivitySummary(groupId) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/activity/summary`);
}
