import { ACTIONS, recordActivity } from "../activity/service.js";
import { asObjectId, requireMembership } from "../groups/service.js";

export async function ensureMessageIndexes(db) {
  await db.collection("messages").createIndex({ groupId: 1, createdAt: 1, _id: 1 });
}

export function publicMessage(doc, senderName) {
  return {
    id: String(doc._id),
    groupId: String(doc.groupId),
    text: doc.text,
    senderId: String(doc.senderId),
    senderName: senderName || "Unknown member",
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function listMessages(db, groupIdRaw, userId) {
  const { group } = await requireMembership(db, groupIdRaw, userId);
  const messages = await db.collection("messages")
    .find({ groupId: group._id })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  if (!messages.length) return [];

  const senderIds = [...new Set(messages.map((m) => String(m.senderId)))].map((id) => asObjectId(id, "sender id"));
  const users = await db.collection("users")
    .find({ _id: { $in: senderIds } })
    .project({ name: 1 })
    .toArray();
  const names = new Map(users.map((u) => [String(u._id), u.name]));
  return messages.map((doc) => publicMessage(doc, names.get(String(doc.senderId))));
}

export async function createMessage(db, groupIdRaw, user, { text }) {
  const { group } = await requireMembership(db, groupIdRaw, user._id);
  const now = new Date();
  const doc = {
    groupId: group._id,
    senderId: user._id,
    text,
    createdAt: now,
  };
  const result = await db.collection("messages").insertOne(doc);
  const message = { ...doc, _id: result.insertedId };
  await recordActivity(db, {
    groupId: group._id,
    actor: user,
    action: ACTIONS.MESSAGE_SENT,
    summary: `${user.name} sent a group message`,
    entityType: "message",
    entityId: message._id,
    entityTitle: null,
    metadata: {},
  });
  return publicMessage(message, user.name);
}
