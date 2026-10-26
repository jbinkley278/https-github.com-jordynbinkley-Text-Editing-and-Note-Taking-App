import { ACTIONS, recordActivityBestEffort } from "../activity/service.js";
import { asObjectId, requireMembership } from "../groups/service.js";
import {
  attachmentByIdMap,
  canDeleteAttachment,
  consumeStagedAttachment,
  publicAttachment,
} from "./attachments.js";

export async function ensureMessageIndexes(db) {
  await db.collection("messages").createIndex({ groupId: 1, createdAt: 1, _id: 1 });
}

export function publicMessage(doc, senderName, attachment = null, { viewerId, viewerRole } = {}) {
  const payload = {
    id: String(doc._id),
    groupId: String(doc.groupId),
    text: doc.text ?? "",
    senderId: String(doc.senderId),
    senderName: senderName || "Unknown member",
    createdAt: doc.createdAt.toISOString(),
    attachment: null,
  };
  if (attachment) {
    payload.attachment = publicAttachment(attachment, {
      canDelete: canDeleteAttachment(attachment, viewerId, viewerRole),
    });
  } else if (doc.attachmentRemovedAt) {
    payload.attachment = { removed: true };
  }
  return payload;
}

export async function listMessages(db, groupIdRaw, userId) {
  const { group, membership } = await requireMembership(db, groupIdRaw, userId);
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

  const attachmentIds = messages.map((m) => m.attachmentId).filter(Boolean);
  const attachments = await attachmentByIdMap(db, attachmentIds);

  return messages.map((doc) => publicMessage(
    doc,
    names.get(String(doc.senderId)),
    doc.attachmentId ? attachments.get(String(doc.attachmentId)) ?? null : null,
    { viewerId: userId, viewerRole: membership.role },
  ));
}

export async function createMessage(db, groupIdRaw, user, { text, attachmentId = null }) {
  const { group, membership } = await requireMembership(db, groupIdRaw, user._id);
  const now = new Date();
  const doc = {
    groupId: group._id,
    senderId: user._id,
    text: text ?? "",
    createdAt: now,
  };
  if (attachmentId) {
    // Placeholder until consume succeeds; insert then link for a stable message id.
    doc.attachmentId = asObjectId(attachmentId, "attachment id");
  }

  const result = await db.collection("messages").insertOne(doc);
  const message = { ...doc, _id: result.insertedId };

  let attachmentDoc = null;
  if (attachmentId) {
    try {
      attachmentDoc = await consumeStagedAttachment(db, {
        groupId: group._id,
        userId: user._id,
        messageId: message._id,
        attachmentIdRaw: attachmentId,
      });
    } catch (error) {
      await db.collection("messages").deleteOne({ _id: message._id });
      throw error;
    }
  }

  const summary = attachmentDoc
    ? `${user.name} shared a file${text ? " with a caption" : ""}`
    : `${user.name} sent a group message`;

  await recordActivityBestEffort(db, {
    groupId: group._id,
    actor: user,
    action: ACTIONS.MESSAGE_SENT,
    summary,
    entityType: "message",
    entityId: message._id,
    entityTitle: attachmentDoc?.originalName ?? null,
    metadata: attachmentDoc ? { attachmentId: String(attachmentDoc._id) } : {},
  });

  return publicMessage(message, user.name, attachmentDoc, {
    viewerId: user._id,
    viewerRole: membership.role,
  });
}
