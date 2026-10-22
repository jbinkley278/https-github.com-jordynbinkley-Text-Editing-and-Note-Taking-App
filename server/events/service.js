import { ACTIONS, recordActivityBestEffort } from "../activity/service.js";
import { asObjectId, requireMembership } from "../groups/service.js";

export async function ensureEventIndexes(db) {
  await db.collection("events").createIndex({ groupId: 1, date: 1, startTime: 1 });
}

export function publicEvent(doc) {
  return {
    id: String(doc._id),
    groupId: String(doc.groupId),
    title: doc.title,
    date: doc.date,
    startTime: doc.startTime ?? null,
    timeZone: doc.timeZone || "UTC",
    description: doc.description ?? "",
    createdBy: String(doc.createdBy),
    updatedBy: doc.updatedBy ? String(doc.updatedBy) : String(doc.createdBy),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export async function listEvents(db, groupIdRaw, userId) {
  const { group } = await requireMembership(db, groupIdRaw, userId);
  const events = await db.collection("events")
    .find({ groupId: group._id })
    .sort({ date: 1, startTime: 1, createdAt: 1 })
    .toArray();
  return events.map(publicEvent);
}

export async function getEvent(db, groupIdRaw, eventIdRaw, userId) {
  const { group } = await requireMembership(db, groupIdRaw, userId);
  const eventId = asObjectId(eventIdRaw, "event id");
  const event = await db.collection("events").findOne({ _id: eventId, groupId: group._id });
  if (!event) {
    const error = new Error("Event not found.");
    error.status = 404;
    throw error;
  }
  return publicEvent(event);
}

export async function createEvent(db, groupIdRaw, user, fields) {
  const { group } = await requireMembership(db, groupIdRaw, user._id);
  const now = new Date();
  const doc = {
    groupId: group._id,
    title: fields.title,
    date: fields.date,
    startTime: fields.startTime ?? null,
    timeZone: fields.timeZone || "UTC",
    description: fields.description ?? "",
    createdBy: user._id,
    updatedBy: user._id,
    createdAt: now,
    updatedAt: now,
  };
  const result = await db.collection("events").insertOne(doc);
  const event = { ...doc, _id: result.insertedId };
  await recordActivityBestEffort(db, {
    groupId: group._id,
    actor: user,
    action: ACTIONS.EVENT_CREATED,
    summary: `${user.name} scheduled “${event.title}”`,
    entityType: "event",
    entityId: event._id,
    entityTitle: event.title,
    metadata: { date: event.date },
  });
  return publicEvent(event);
}

export async function updateEvent(db, groupIdRaw, eventIdRaw, user, fields) {
  const { group } = await requireMembership(db, groupIdRaw, user._id);
  const eventId = asObjectId(eventIdRaw, "event id");
  const existing = await db.collection("events").findOne({ _id: eventId, groupId: group._id });
  if (!existing) {
    const error = new Error("Event not found.");
    error.status = 404;
    throw error;
  }
  const updated = {
    ...existing,
    ...fields,
    updatedBy: user._id,
    updatedAt: new Date(),
  };
  await db.collection("events").replaceOne({ _id: eventId, groupId: group._id }, updated);
  const changed = ["title", "date", "startTime", "timeZone", "description"].some(
    (key) => key in fields && JSON.stringify(updated[key]) !== JSON.stringify(existing[key]),
  );
  if (changed) {
    await recordActivityBestEffort(db, {
      groupId: group._id,
      actor: user,
      action: ACTIONS.EVENT_UPDATED,
      summary: `${user.name} updated meeting “${updated.title}”`,
      entityType: "event",
      entityId: eventId,
      entityTitle: updated.title,
      metadata: { date: updated.date },
    });
  }
  return publicEvent(updated);
}

export async function deleteEvent(db, groupIdRaw, eventIdRaw, user) {
  const { group } = await requireMembership(db, groupIdRaw, user._id);
  const eventId = asObjectId(eventIdRaw, "event id");
  const existing = await db.collection("events").findOne({ _id: eventId, groupId: group._id });
  if (!existing) {
    const error = new Error("Event not found.");
    error.status = 404;
    throw error;
  }
  await db.collection("events").deleteOne({ _id: eventId, groupId: group._id });
  await recordActivityBestEffort(db, {
    groupId: group._id,
    actor: user,
    action: ACTIONS.EVENT_DELETED,
    summary: `${user.name} deleted meeting “${existing.title}”`,
    entityType: "event",
    entityId: eventId,
    entityTitle: existing.title,
    metadata: {},
  });
  return { ok: true };
}
