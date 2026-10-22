// Shared helpers for GroupFlow views.
// Real-group tasks load/save through the Express/MongoDB API (see src/api.js).
// STORAGE_KEY seed data is a preserved local prototype only — never auto-imported.
// Shared tasks, chat, and calendar meetings use the API. Prototype seed stays separate.

export const STORAGE_KEY = "groupflow.state.v1";
/** sessionStorage key for the selected MongoDB group (cleared on logout). */
export const ACTIVE_GROUP_KEY = "gf.activeGroupId";
export const STATUSES = ["todo", "progress", "done"];
export const STATUS_LABELS = { todo: "To Do", progress: "In Progress", done: "Done" };
export const PRIORITIES = ["low", "medium", "high"];

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return toDateKey(new Date(y, m - 1, d + days));
}

/**
 * Empty in-memory workspace for a real MongoDB group.
 * Does not copy demo members/tasks/messages and must not be written to STORAGE_KEY.
 */
export function emptyWorkspaceState(group, sessionUserId = null) {
  return {
    currentUserId: sessionUserId,
    group: {
      id: group.id,
      name: group.name,
      description: group.description ?? "",
    },
    members: [],
    tasks: [],
    events: [],
    messages: [],
    activity: [],
    lastReadChat: null,
    source: "mongodb-group",
  };
}

export function seedState(today = toDateKey(new Date())) {
  const members = [
    { id: "tobi", name: "Tobi Akere", role: "Team Coordinator" },
    { id: "brandon", name: "Brandon Clair", role: "Student Member" },
    { id: "sandesh", name: "Sandesh Pariyar", role: "Student Member" },
    { id: "jordyn", name: "Jordyn Binkley", role: "Student Member" },
  ];
  const task = (title, assignee, status, priority, offset, description = "") => ({
    id: newId(), title, description, assignee, status, priority,
    dueDate: addDays(today, offset), createdBy: "tobi", createdAt: new Date().toISOString(),
  });
  return {
    currentUserId: "brandon",
    group: { id: "group-6", name: "CSCE 3444 Group 6", description: "GroupFlow semester project" },
    source: "local-prototype",
    members,
    tasks: [
      task("Build calendar page", "tobi", "todo", "medium", 4),
      task("Progress page", "jordyn", "todo", "low", 6),
      task("Write test cases", "sandesh", "todo", "medium", 9),
      task("Chat UI", "sandesh", "progress", "high", 2),
      task("Dashboard", "brandon", "progress", "high", 1, "Stat cards, upcoming deadlines and recent activity."),
      task("Login page", "tobi", "done", "high", -5),
      task("Welcome page", "brandon", "done", "medium", -7),
    ],
    events: [{ id: newId(), title: "Sprint demo", date: addDays(today, 7), description: "Demo in class" }],
    messages: [
      { id: newId(), senderId: "tobi", text: "I added the calendar tasks to the board.", timestamp: new Date(Date.now() - 36e5 * 5).toISOString() },
      { id: newId(), senderId: "jordyn", text: "Updated the SRS and UI plan.", timestamp: new Date(Date.now() - 36e5 * 3).toISOString() },
      { id: newId(), senderId: "sandesh", text: "Working on the chat screen now.", timestamp: new Date(Date.now() - 36e5).toISOString() },
    ],
    activity: [],
    lastReadChat: null,
  };
}

export function loadState(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (value && Array.isArray(value.tasks) && Array.isArray(value.members)) return value;
  } catch {
    // bad JSON falls through to a fresh seed
  }
  return seedState();
}

export function saveState(state, storage = globalThis.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function memberName(state, id) {
  return state.members.find((m) => m.id === id)?.name ?? "Unassigned";
}

function log(state, userId, type, text) {
  state.activity.unshift({ id: newId(), userId, type, text, timestamp: new Date().toISOString() });
  state.activity.length = Math.min(state.activity.length, 200);
}

export function validateTask(fields) {
  const errors = {};
  if (!fields.title?.trim()) errors.title = "Task name is required.";
  if (!fields.dueDate) errors.dueDate = "Pick a due date.";
  if (fields.status && !STATUSES.includes(fields.status)) errors.status = "Unknown status.";
  if (fields.priority && !PRIORITIES.includes(fields.priority)) errors.priority = "Unknown priority.";
  return errors;
}

export function addTask(state, fields, userId = state.currentUserId) {
  const task = {
    id: newId(),
    title: fields.title.trim(),
    description: fields.description?.trim() ?? "",
    assignee: fields.assignee || null,
    status: fields.status ?? "todo",
    priority: fields.priority ?? "medium",
    dueDate: fields.dueDate,
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };
  state.tasks.push(task);
  log(state, userId, "task-created", `created “${task.title}”`);
  return task;
}

export function updateTask(state, id, changes, userId = state.currentUserId) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return null;
  if (changes.status && changes.status !== task.status) {
    log(state, userId, "task-moved", `moved “${changes.title ?? task.title}” to ${STATUS_LABELS[changes.status]}`);
  }
  if ("assignee" in changes && changes.assignee !== task.assignee) {
    log(state, userId, "task-assigned", `assigned “${changes.title ?? task.title}” to ${memberName(state, changes.assignee)}`);
  }
  Object.assign(task, changes, changes.title ? { title: changes.title.trim() } : {});
  return task;
}

export function deleteTask(state, id, userId = state.currentUserId) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return false;
  state.tasks = state.tasks.filter((t) => t.id !== id);
  log(state, userId, "task-deleted", `deleted “${task.title}”`);
  return true;
}

export function addMessage(state, text, userId = state.currentUserId) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const message = { id: newId(), senderId: userId, text: trimmed, timestamp: new Date().toISOString() };
  state.messages.push(message);
  return message;
}

export function addEvent(state, fields, userId = state.currentUserId) {
  const event = { id: newId(), title: fields.title.trim(), date: fields.date, description: fields.description?.trim() ?? "" };
  state.events.push(event);
  log(state, userId, "event-created", `scheduled “${event.title}”`);
  return event;
}

export function progress(state) {
  const total = state.tasks.length;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, state.tasks.filter((t) => t.status === s).length]));
  return { total, counts, percent: total ? Math.round((counts.done / total) * 100) : 0 };
}

export function contributions(state) {
  return state.members.map((member) => {
    const mine = state.tasks.filter((t) => t.assignee === member.id);
    return {
      member,
      done: mine.filter((t) => t.status === "done").length,
      active: mine.filter((t) => t.status !== "done").length,
    };
  });
}

// Open tasks due between today and today + days, soonest first. Overdue ones are included too.
export function upcoming(state, today, days = 7) {
  const limit = addDays(today, days);
  const tasks = state.tasks
    .filter((t) => t.status !== "done" && t.dueDate <= limit)
    .map((t) => ({ kind: "task", id: t.id, title: t.title, date: t.dueDate, overdue: t.dueDate < today }));
  const events = state.events
    .filter((e) => e.date >= today && e.date <= limit)
    .map((e) => ({
      kind: "event",
      id: e.id,
      title: e.title,
      date: e.date,
      startTime: e.startTime ?? null,
      timeZone: e.timeZone || "UTC",
      overdue: false,
    }));
  return [...tasks, ...events].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    const aTime = a.startTime || "99:99";
    const bTime = b.startTime || "99:99";
    return aTime.localeCompare(bTime);
  });
}

export function itemsByDate(state, monthPrefix) {
  const map = new Map();
  const push = (date, item) => map.set(date, [...(map.get(date) ?? []), item]);
  state.tasks
    .filter((t) => t.dueDate.startsWith(monthPrefix))
    .forEach((t) => push(t.dueDate, {
      kind: "task",
      id: t.id,
      title: t.title,
      done: t.status === "done",
      date: t.dueDate,
    }));
  state.events
    .filter((e) => e.date.startsWith(monthPrefix))
    .forEach((e) => push(e.date, {
      kind: "event",
      id: e.id,
      title: e.title,
      date: e.date,
      startTime: e.startTime ?? null,
      timeZone: e.timeZone || "UTC",
      description: e.description ?? "",
    }));
  return map;
}

export function unreadCount(state) {
  return state.messages.filter((m) => m.senderId !== state.currentUserId && (!state.lastReadChat || m.timestamp > state.lastReadChat)).length;
}
