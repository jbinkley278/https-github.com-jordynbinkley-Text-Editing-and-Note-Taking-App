import { asObjectId, requireMembership } from "../groups/service.js";

const STATUS_LABELS = { todo: "To Do", progress: "In Progress", done: "Done" };

export const ACTIONS = {
  TASK_CREATED: "task.created",
  TASK_STATUS_CHANGED: "task.status_changed",
  TASK_ASSIGNED: "task.assigned",
  TASK_UPDATED: "task.updated",
  TASK_DELETED: "task.deleted",
  MESSAGE_SENT: "message.sent",
  EVENT_CREATED: "event.created",
  EVENT_UPDATED: "event.updated",
  EVENT_DELETED: "event.deleted",
};

export const ACTION_LABELS = {
  [ACTIONS.TASK_CREATED]: "Tasks created",
  [ACTIONS.TASK_STATUS_CHANGED]: "Status updates",
  [ACTIONS.TASK_ASSIGNED]: "Assignments changed",
  [ACTIONS.TASK_UPDATED]: "Task edits",
  [ACTIONS.TASK_DELETED]: "Tasks deleted",
  [ACTIONS.MESSAGE_SENT]: "Messages sent",
  [ACTIONS.EVENT_CREATED]: "Meetings created",
  [ACTIONS.EVENT_UPDATED]: "Meetings updated",
  [ACTIONS.EVENT_DELETED]: "Meetings deleted",
};

export const ACTIVITY_MEASURE_NOTE =
  "Totals count recorded GroupFlow actions when activity logging succeeds (creates, edits, status moves, messages, meetings). Activity is best-effort after mutations—not atomic or guaranteed—so contribution totals may be incomplete. They are not a measure of effort, quality, or work done outside the app.";

export const ACTIVITY_TRACKED_NOTE =
  "Activity tracking began with this feature. Older actions were not backfilled. Logging is best-effort after successful mutations and is not guaranteed.";

export async function ensureActivityIndexes(db) {
  await db.collection("activity").createIndex({ groupId: 1, createdAt: -1 });
  await db.collection("activity").createIndex({ groupId: 1, actorId: 1, createdAt: -1 });
}

export function publicActivity(doc) {
  return {
    id: String(doc._id),
    groupId: String(doc.groupId),
    actorId: String(doc.actorId),
    actorName: doc.actorName,
    action: doc.action,
    summary: doc.summary,
    entityType: doc.entityType ?? null,
    entityId: doc.entityId ? String(doc.entityId) : null,
    entityTitle: doc.entityTitle ?? null,
    metadata: doc.metadata ?? {},
    createdAt: doc.createdAt.toISOString(),
  };
}

/**
 * Server-side only. Call after a successful mutation. Never exposed for client writes.
 */
function normalizeEntityId(entityId) {
  if (entityId == null || entityId === "") return null;
  if (typeof entityId === "object" && entityId._id) return entityId._id;
  if (typeof entityId === "string") return asObjectId(entityId, "entity id");
  return entityId;
}

export async function recordActivity(db, {
  groupId,
  actor,
  action,
  summary,
  entityType = null,
  entityId = null,
  entityTitle = null,
  metadata = {},
}) {
  const doc = {
    groupId,
    actorId: actor._id,
    actorName: actor.name,
    action,
    summary,
    entityType,
    entityId: normalizeEntityId(entityId),
    entityTitle: entityTitle ?? null,
    metadata,
    createdAt: new Date(),
  };
  const result = await db.collection("activity").insertOne(doc);
  return publicActivity({ ...doc, _id: result.insertedId });
}

/**
 * Best-effort activity write after a successful primary mutation.
 * Never throws: failures are logged without message bodies, credentials, or request payloads.
 * No automatic retries (ambiguous inserts could duplicate activity rows).
 * @returns {Promise<object | null>} public activity on success, otherwise null
 */
export async function recordActivityBestEffort(db, payload) {
  try {
    return await recordActivity(db, payload);
  } catch (error) {
    const entityId = payload?.entityId != null
      ? String(normalizeEntityId(payload.entityId) ?? payload.entityId)
      : null;
    console.error("Activity log failed (best-effort; primary mutation already saved)", {
      action: payload?.action ?? null,
      entityType: payload?.entityType ?? null,
      entityId,
      groupId: payload?.groupId != null ? String(payload.groupId) : null,
      error: error instanceof Error ? error.message : String(error),
      ...(error?.code != null ? { errorCode: String(error.code) } : {}),
    });
    return null;
  }
}

export async function listActivity(db, groupIdRaw, userId, { limit = 50, actorId = null } = {}) {
  const { group } = await requireMembership(db, groupIdRaw, userId);
  const query = { groupId: group._id };
  if (actorId) query.actorId = asObjectId(actorId, "actor id");
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = await db.collection("activity")
    .find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(capped)
    .toArray();
  return rows.map(publicActivity);
}

export async function activitySummary(db, groupIdRaw, userId) {
  const { group } = await requireMembership(db, groupIdRaw, userId);
  const memberships = await db.collection("memberships").find({ groupId: group._id }).toArray();
  const users = await db.collection("users")
    .find({ _id: { $in: memberships.map((m) => m.userId) } })
    .project({ name: 1 })
    .toArray();
  const nameById = new Map(users.map((u) => [String(u._id), u.name]));

  const counts = await db.collection("activity").aggregate([
    { $match: { groupId: group._id } },
    {
      $group: {
        _id: { actorId: "$actorId", action: "$action" },
        count: { $sum: 1 },
      },
    },
  ]).toArray();

  const byActor = new Map();
  for (const m of memberships) {
    const id = String(m.userId);
    byActor.set(id, {
      userId: id,
      name: nameById.get(id) ?? "Unknown member",
      total: 0,
      byAction: Object.fromEntries(Object.values(ACTIONS).map((a) => [a, 0])),
    });
  }

  for (const row of counts) {
    const id = String(row._id.actorId);
    if (!byActor.has(id)) {
      byActor.set(id, {
        userId: id,
        name: nameById.get(id) ?? "Former member",
        total: 0,
        byAction: Object.fromEntries(Object.values(ACTIONS).map((a) => [a, 0])),
      });
    }
    const entry = byActor.get(id);
    entry.byAction[row._id.action] = (entry.byAction[row._id.action] ?? 0) + row.count;
    entry.total += row.count;
  }

  return {
    trackedSinceNote: ACTIVITY_TRACKED_NOTE,
    measureNote: ACTIVITY_MEASURE_NOTE,
    actionLabels: ACTION_LABELS,
    members: [...byActor.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  };
}

export function describeTaskStatus(status) {
  return STATUS_LABELS[status] ?? status;
}
