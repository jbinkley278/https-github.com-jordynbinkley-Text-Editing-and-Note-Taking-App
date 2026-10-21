import { asObjectId, requireMembership } from "../groups/service.js";

/**
 * Per-user, per-group chat read cursor.
 *
 * Policy for existing history / newly joined members:
 * - Until a read position exists, every message from other members counts as unread
 *   (including messages written before the user joined). Opening Chat and successfully
 *   displaying messages advances the cursor through those displayed messages only.
 * - Own messages never count toward unread.
 * - Read updates never create contribution/activity records.
 */

export async function ensureReadPositionIndexes(db) {
  await db.collection("chat_read_positions").createIndex(
    { groupId: 1, userId: 1 },
    { unique: true },
  );
}

function isAfterCursor(message, cursor) {
  if (!cursor?.lastReadMessageId || !cursor?.lastReadAt) return true;
  const createdAt = message.createdAt instanceof Date
    ? message.createdAt
    : new Date(message.createdAt);
  const cursorAt = cursor.lastReadAt instanceof Date
    ? cursor.lastReadAt
    : new Date(cursor.lastReadAt);
  if (createdAt > cursorAt) return true;
  if (createdAt < cursorAt) return false;
  return message._id > cursor.lastReadMessageId;
}

function isSameOrBeforeCursor(message, cursor) {
  return !isAfterCursor(message, cursor);
}

export async function getReadPosition(db, groupId, userId) {
  return db.collection("chat_read_positions").findOne({ groupId, userId });
}

export async function countUnreadMessages(db, groupIdRaw, userId) {
  const { group } = await requireMembership(db, groupIdRaw, userId);
  const cursor = await getReadPosition(db, group._id, userId);
  const filter = {
    groupId: group._id,
    senderId: { $ne: userId },
  };
  if (cursor?.lastReadMessageId && cursor?.lastReadAt) {
    filter.$or = [
      { createdAt: { $gt: cursor.lastReadAt } },
      { createdAt: cursor.lastReadAt, _id: { $gt: cursor.lastReadMessageId } },
    ];
  }
  const unreadCount = await db.collection("messages").countDocuments(filter);
  return {
    unreadCount,
    lastReadMessageId: cursor?.lastReadMessageId ? String(cursor.lastReadMessageId) : null,
  };
}

/**
 * Advance read position to upToMessageId if that message is in the group and
 * strictly after the stored cursor. Never moves the cursor backward.
 * Does not mark messages beyond upToMessageId.
 */
export async function markMessagesRead(db, groupIdRaw, userId, upToMessageIdRaw) {
  const { group } = await requireMembership(db, groupIdRaw, userId);
  const upToMessageId = asObjectId(upToMessageIdRaw, "message id");
  const message = await db.collection("messages").findOne({
    _id: upToMessageId,
    groupId: group._id,
  });
  if (!message) {
    const error = new Error("Message not found in this group.");
    error.status = 404;
    throw error;
  }

  const existing = await getReadPosition(db, group._id, userId);
  if (existing && isSameOrBeforeCursor(message, existing)) {
    return countUnreadMessages(db, groupIdRaw, userId);
  }

  const now = new Date();
  await db.collection("chat_read_positions").updateOne(
    { groupId: group._id, userId },
    {
      $set: {
        groupId: group._id,
        userId,
        lastReadMessageId: message._id,
        lastReadAt: message.createdAt,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  return countUnreadMessages(db, groupIdRaw, userId);
}

export { isAfterCursor };
