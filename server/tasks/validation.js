const STATUSES = new Set(["todo", "progress", "done"]);
const PRIORITIES = new Set(["low", "medium", "high"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeSubtasks(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Subtasks must be a list." };
  }
  if (raw.length > 50) {
    return { ok: false, error: "A task can have at most 50 subtasks." };
  }
  const value = [];
  for (const item of raw) {
    const title = String(item?.title ?? "").trim();
    if (!title) continue;
    if (title.length > 120) {
      return { ok: false, error: "Each subtask title must be 120 characters or fewer." };
    }
    value.push({
      id: String(item?.id ?? "").trim() || undefined,
      title,
      done: Boolean(item?.done),
    });
  }
  return { ok: true, value };
}

/**
 * @param {"create"|"update"} mode
 */
export function validateTaskPayload(body, mode = "create") {
  const fields = {};
  const data = body ?? {};
  const patch = {};

  if (mode === "create" || "title" in data) {
    const title = String(data.title ?? "").trim();
    if (!title) fields.title = "Task name is required.";
    else if (title.length > 100) fields.title = "Task name must be 100 characters or fewer.";
    else patch.title = title;
  }

  if (mode === "create" || "description" in data) {
    const description = String(data.description ?? "").trim();
    if (description.length > 2000) fields.description = "Description must be 2000 characters or fewer.";
    else patch.description = description;
  }

  if (mode === "create" || "dueDate" in data) {
    const dueDate = String(data.dueDate ?? "").trim();
    if (!dueDate) fields.dueDate = "Pick a due date.";
    else if (!DATE_RE.test(dueDate)) fields.dueDate = "Due date must be YYYY-MM-DD.";
    else patch.dueDate = dueDate;
  }

  if (mode === "create" || "status" in data) {
    const status = data.status ?? (mode === "create" ? "todo" : undefined);
    if (status !== undefined) {
      if (!STATUSES.has(status)) fields.status = "Status must be To Do, In Progress, or Done.";
      else patch.status = status;
    }
  }

  if (mode === "create" || "priority" in data) {
    const priority = data.priority ?? (mode === "create" ? "medium" : undefined);
    if (priority !== undefined) {
      if (!PRIORITIES.has(priority)) fields.priority = "Priority must be low, medium, or high.";
      else patch.priority = priority;
    }
  }

  if (mode === "create" || "assignee" in data || "assigneeId" in data) {
    const raw = data.assignee ?? data.assigneeId;
    if (raw === "" || raw === null || raw === undefined) patch.assigneeId = null;
    else patch.assigneeId = String(raw);
  }

  if (mode === "create" || "subtasks" in data) {
    const sub = normalizeSubtasks(data.subtasks);
    if (!sub.ok) fields.subtasks = sub.error;
    else patch.subtasks = sub.value;
  } else if (mode === "create") {
    patch.subtasks = [];
  }

  if (Object.keys(fields).length) {
    return { ok: false, fields, error: "Please fix the highlighted fields." };
  }
  if (mode === "update" && !Object.keys(patch).length) {
    return { ok: false, fields: {}, error: "No changes provided." };
  }
  return { ok: true, value: patch };
}

export { STATUSES, PRIORITIES };
