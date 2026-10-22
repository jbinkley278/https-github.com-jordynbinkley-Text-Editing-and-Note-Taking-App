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

export function registerUser(fields) {
  return api("/api/auth/register", { method: "POST", body: fields });
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

export function sendMessage(groupId, text) {
  return api(`/api/groups/${encodeURIComponent(groupId)}/messages`, {
    method: "POST",
    body: { text },
  });
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
