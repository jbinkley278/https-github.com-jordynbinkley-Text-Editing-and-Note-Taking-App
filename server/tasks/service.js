import crypto from "node:crypto";
import { ACTIONS, describeTaskStatus, recordActivityBestEffort } from "../activity/service.js";
import { asObjectId, requireMembership } from "../groups/service.js";

export async function ensureTaskIndexes(db) {
  await db.collection("tasks").createIndex({ groupId: 1, status: 1 });
  await db.collection("tasks").createIndex({ groupId: 1, dueDate: 1 });
  await db.collection("tasks").createIndex({ groupId: 1, assigneeId: 1 });
}

function newSubtaskId() {
  return crypto.randomBytes(8).toString("hex");
}

function normalizeStoredSubtasks(list = []) {
  return list.map((item) => ({
    id: item.id || newSubtaskId(),
    title: item.title,
    done: Boolean(item.done),
  }));
}

export function publicTask(doc) {
  return {
    id: String(doc._id),
    groupId: String(doc.groupId),
    title: doc.title,
    description: doc.description ?? "",
    assignee: doc.assigneeId ? String(doc.assigneeId) : null,
    status: doc.status,
    priority: doc.priority,
    dueDate: doc.dueDate,
    subtasks: (doc.subtasks ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      done: Boolean(s.done),
    })),
    createdBy: String(doc.createdBy),
    updatedBy: doc.updatedBy ? String(doc.updatedBy) : String(doc.createdBy),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

async function assertAssigneeInGroup(db, groupId, assigneeId) {
  if (assigneeId === null || assigneeId === undefined) return null;
  const userId = asObjectId(assigneeId, "assignee");
  const membership = await db.collection("memberships").findOne({ groupId, userId });
  if (!membership) {
    const error = new Error("Assignee must be a member of this group.");
    error.status = 400;
    error.fields = { assignee: "Assignee must be a member of this group." };
    throw error;
  }
  return userId;
}

async function assigneeLabel(db, assigneeId) {
  if (!assigneeId) return "Unassigned";
  const user = await db.collection("users").findOne({ _id: assigneeId }, { projection: { name: 1 } });
  return user?.name ?? "Unknown member";
}

export async function listTasks(db, groupIdRaw, userId) {
  const { group } = await requireMembership(db, groupIdRaw, userId);
  const tasks = await db.collection("tasks")
    .find({ groupId: group._id })
    .sort({ dueDate: 1, createdAt: 1 })
    .toArray();
  return tasks.map(publicTask);
}

export async function getTask(db, groupIdRaw, taskIdRaw, userId) {
  const { group } = await requireMembership(db, groupIdRaw, userId);
  const taskId = asObjectId(taskIdRaw, "task id");
  const task = await db.collection("tasks").findOne({ _id: taskId, groupId: group._id });
  if (!task) {
    const error = new Error("Task not found.");
    error.status = 404;
    throw error;
  }
  return publicTask(task);
}

export async function createTask(db, groupIdRaw, user, fields) {
  const { group } = await requireMembership(db, groupIdRaw, user._id);
  const assigneeId = await assertAssigneeInGroup(db, group._id, fields.assigneeId ?? null);
  const now = new Date();
  const doc = {
    groupId: group._id,
    title: fields.title,
    description: fields.description ?? "",
    assigneeId,
    status: fields.status ?? "todo",
    priority: fields.priority ?? "medium",
    dueDate: fields.dueDate,
    subtasks: normalizeStoredSubtasks(fields.subtasks ?? []),
    createdBy: user._id,
    updatedBy: user._id,
    createdAt: now,
    updatedAt: now,
  };
  const result = await db.collection("tasks").insertOne(doc);
  const task = { ...doc, _id: result.insertedId };
  await recordActivityBestEffort(db, {
    groupId: group._id,
    actor: user,
    action: ACTIONS.TASK_CREATED,
    summary: `${user.name} created “${task.title}”`,
    entityType: "task",
    entityId: task._id,
    entityTitle: task.title,
    metadata: { status: task.status },
  });
  return publicTask(task);
}

export async function updateTask(db, groupIdRaw, taskIdRaw, user, fields) {
  const { group } = await requireMembership(db, groupIdRaw, user._id);
  const taskId = asObjectId(taskIdRaw, "task id");
  const existing = await db.collection("tasks").findOne({ _id: taskId, groupId: group._id });
  if (!existing) {
    const error = new Error("Task not found.");
    error.status = 404;
    throw error;
  }

  const patch = { ...fields };
  if ("assigneeId" in patch) {
    patch.assigneeId = await assertAssigneeInGroup(db, group._id, patch.assigneeId);
  }
  if ("subtasks" in patch) {
    patch.subtasks = normalizeStoredSubtasks(patch.subtasks);
  }

  const updated = {
    ...existing,
    ...patch,
    updatedBy: user._id,
    updatedAt: new Date(),
  };
  await db.collection("tasks").replaceOne({ _id: taskId, groupId: group._id }, updated);

  const title = updated.title;
  // Each activity entry is independent so one failure does not block the others.
  if ("status" in fields && fields.status !== existing.status) {
    await recordActivityBestEffort(db, {
      groupId: group._id,
      actor: user,
      action: ACTIONS.TASK_STATUS_CHANGED,
      summary: `${user.name} moved “${title}” to ${describeTaskStatus(fields.status)}`,
      entityType: "task",
      entityId: taskId,
      entityTitle: title,
      metadata: { from: existing.status, to: fields.status },
    });
  }
  if ("assigneeId" in fields) {
    const prev = existing.assigneeId ? String(existing.assigneeId) : null;
    const next = updated.assigneeId ? String(updated.assigneeId) : null;
    if (prev !== next) {
      const label = await assigneeLabel(db, updated.assigneeId);
      await recordActivityBestEffort(db, {
        groupId: group._id,
        actor: user,
        action: ACTIONS.TASK_ASSIGNED,
        summary: `${user.name} assigned “${title}” to ${label}`,
        entityType: "task",
        entityId: taskId,
        entityTitle: title,
        metadata: { assigneeId: next },
      });
    }
  }
  const otherKeys = ["title", "description", "dueDate", "priority", "subtasks"];
  const otherChanged = otherKeys.some((key) => {
    if (!(key in fields)) return false;
    return JSON.stringify(updated[key]) !== JSON.stringify(existing[key]);
  });
  if (otherChanged) {
    await recordActivityBestEffort(db, {
      groupId: group._id,
      actor: user,
      action: ACTIONS.TASK_UPDATED,
      summary: `${user.name} updated “${title}”`,
      entityType: "task",
      entityId: taskId,
      entityTitle: title,
      metadata: { fields: otherKeys.filter((key) => key in fields) },
    });
  }

  return publicTask(updated);
}

export async function deleteTask(db, groupIdRaw, taskIdRaw, user) {
  const { group } = await requireMembership(db, groupIdRaw, user._id);
  const taskId = asObjectId(taskIdRaw, "task id");
  const existing = await db.collection("tasks").findOne({ _id: taskId, groupId: group._id });
  if (!existing) {
    const error = new Error("Task not found.");
    error.status = 404;
    throw error;
  }
  await db.collection("tasks").deleteOne({ _id: taskId, groupId: group._id });
  await recordActivityBestEffort(db, {
    groupId: group._id,
    actor: user,
    action: ACTIONS.TASK_DELETED,
    summary: `${user.name} deleted “${existing.title}”`,
    entityType: "task",
    entityId: taskId,
    entityTitle: existing.title,
    metadata: {},
  });
  return { ok: true };
}
