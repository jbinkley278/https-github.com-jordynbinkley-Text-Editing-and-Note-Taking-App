import { GridFSBucket, ObjectId } from "mongodb";
import { asObjectId, requireMembership } from "../groups/service.js";
import { ROLE_COORDINATOR } from "../groups/roles.js";
import {
  ATTACHMENT_MAX_BYTES,
  isImageContentType,
  resolveAttachmentType,
  sniffAttachmentContent,
} from "./fileTypes.js";

export const ATTACHMENT_BUCKET = "chat_attachments";
export const ATTACHMENT_META = "chat_attachment_meta";
export const STAGED_TTL_MS = 60 * 60 * 1000;
export const UPLOAD_RATE_LIMIT_PER_HOUR = 30;

export function getAttachmentBucket(db) {
  return new GridFSBucket(db, { bucketName: ATTACHMENT_BUCKET });
}

export async function ensureAttachmentIndexes(db) {
  await db.collection(ATTACHMENT_META).createIndex({ groupId: 1, createdAt: -1 });
  await db.collection(ATTACHMENT_META).createIndex({ uploaderId: 1, createdAt: -1 });
  await db.collection(ATTACHMENT_META).createIndex({ messageId: 1 }, { sparse: true });
  await db.collection(ATTACHMENT_META).createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, partialFilterExpression: { status: "staged" } },
  );
  await db.collection("attachment_upload_rate_limits").createIndex({ key: 1 }, { unique: true });
  await db.collection("attachment_upload_rate_limits").createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 },
  );
}

export function publicAttachment(doc, { canDelete = false } = {}) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    groupId: String(doc.groupId),
    fileName: doc.originalName,
    contentType: doc.contentType,
    size: doc.size,
    status: doc.status,
    isImage: isImageContentType(doc.contentType),
    uploaderId: String(doc.uploaderId),
    messageId: doc.messageId ? String(doc.messageId) : null,
    createdAt: doc.createdAt.toISOString(),
    canDelete: Boolean(canDelete),
  };
}

async function bumpUploadRateLimit(db, userId) {
  const key = `upload:${String(userId)}`;
  const now = new Date();
  const windowMs = 60 * 60 * 1000;
  const windowStart = new Date(now.getTime() - windowMs);
  const doc = await db.collection("attachment_upload_rate_limits").findOne({ key });
  let count = 1;
  let startedAt = now;
  if (doc && doc.startedAt > windowStart) {
    count = (doc.count ?? 0) + 1;
    startedAt = doc.startedAt;
  }
  if (count > UPLOAD_RATE_LIMIT_PER_HOUR) {
    const error = new Error("Too many attachment uploads. Try again later.");
    error.status = 429;
    throw error;
  }
  await db.collection("attachment_upload_rate_limits").updateOne(
    { key },
    {
      $set: {
        key,
        count,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + windowMs),
        updatedAt: now,
      },
    },
    { upsert: true },
  );
}

/**
 * Store a validated file in GridFS and create a staged metadata row.
 */
export async function stageAttachment(db, groupIdRaw, user, { buffer, filename, mimeType }) {
  const { group, membership } = await requireMembership(db, groupIdRaw, user._id);
  await bumpUploadRateLimit(db, user._id);

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error("Choose a non-empty file to attach.");
    error.status = 400;
    throw error;
  }
  if (buffer.length > ATTACHMENT_MAX_BYTES) {
    const error = new Error(`Attachment must be ${ATTACHMENT_MAX_BYTES} bytes or smaller (10 MB).`);
    error.status = 413;
    throw error;
  }

  const resolved = resolveAttachmentType({ filename, contentType: mimeType });
  if (!resolved.ok) {
    const error = new Error(resolved.error);
    error.status = 400;
    error.fields = { file: resolved.error };
    throw error;
  }

  const sniff = sniffAttachmentContent(buffer.subarray(0, Math.min(buffer.length, 512)), resolved.contentType);
  if (!sniff.ok) {
    const error = new Error(sniff.error);
    error.status = 400;
    error.fields = { file: sniff.error };
    throw error;
  }

  const now = new Date();
  const metaId = new ObjectId();
  const bucket = getAttachmentBucket(db);

  let gridFsFileId;
  try {
    gridFsFileId = await new Promise((resolve, reject) => {
      const upload = bucket.openUploadStream(resolved.filename, {
        contentType: resolved.contentType,
        metadata: {
          groupId: String(group._id),
          uploaderId: String(user._id),
          attachmentId: String(metaId),
        },
      });
      upload.on("error", reject);
      upload.on("finish", () => resolve(upload.id));
      upload.end(buffer);
    });
  } catch (error) {
    const err = new Error("Could not store the attachment.");
    err.status = 500;
    err.cause = error;
    throw err;
  }

  const doc = {
    _id: metaId,
    groupId: group._id,
    uploaderId: user._id,
    gridFsFileId,
    originalName: resolved.filename,
    contentType: resolved.contentType,
    size: buffer.length,
    status: "staged",
    messageId: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + STAGED_TTL_MS),
  };

  try {
    await db.collection(ATTACHMENT_META).insertOne(doc);
  } catch (error) {
    await bucket.delete(gridFsFileId).catch(() => {});
    throw error;
  }

  return publicAttachment(doc, {
    canDelete: canDeleteAttachment(doc, user._id, membership.role),
  });
}

export function canDeleteAttachment(doc, userId, role) {
  if (!doc) return false;
  if (String(doc.uploaderId) === String(userId)) return true;
  return role === ROLE_COORDINATOR;
}

export async function getAttachmentForMember(db, groupIdRaw, attachmentIdRaw, userId) {
  const { group, membership } = await requireMembership(db, groupIdRaw, userId);
  const attachmentId = asObjectId(attachmentIdRaw, "attachment id");
  const doc = await db.collection(ATTACHMENT_META).findOne({
    _id: attachmentId,
    groupId: group._id,
    status: { $in: ["staged", "attached"] },
  });
  if (!doc) {
    const error = new Error("Attachment not found.");
    error.status = 404;
    throw error;
  }
  return { group, membership, doc };
}

/**
 * Link a staged attachment owned by the sender to a newly created message.
 * Returns the public attachment or null when attachmentId is absent.
 */
export async function consumeStagedAttachment(db, {
  groupId,
  userId,
  messageId,
  attachmentIdRaw,
}) {
  if (!attachmentIdRaw) return null;
  const attachmentId = asObjectId(attachmentIdRaw, "attachment id");
  const now = new Date();
  const result = await db.collection(ATTACHMENT_META).findOneAndUpdate(
    {
      _id: attachmentId,
      groupId,
      uploaderId: userId,
      status: "staged",
      messageId: null,
    },
    {
      $set: {
        status: "attached",
        messageId,
        updatedAt: now,
      },
      $unset: { expiresAt: "" },
    },
    { returnDocument: "after" },
  );
  const doc = result?.value ?? result;
  if (!doc || !doc._id) {
    const error = new Error("Attachment is missing, expired, or already used.");
    error.status = 400;
    error.fields = { attachmentId: error.message };
    throw error;
  }
  return doc;
}

export async function openAttachmentDownload(db, groupIdRaw, attachmentIdRaw, userId) {
  const { membership, doc } = await getAttachmentForMember(db, groupIdRaw, attachmentIdRaw, userId);
  if (doc.status === "staged" && String(doc.uploaderId) !== String(userId)) {
    // Other members should not download unfinished drafts.
    const error = new Error("Attachment not found.");
    error.status = 404;
    throw error;
  }
  const bucket = getAttachmentBucket(db);
  const stream = bucket.openDownloadStream(doc.gridFsFileId);
  return {
    doc,
    stream,
    canDelete: canDeleteAttachment(doc, userId, membership.role),
  };
}

export async function deleteAttachment(db, groupIdRaw, attachmentIdRaw, user) {
  const { membership, doc } = await getAttachmentForMember(db, groupIdRaw, attachmentIdRaw, user._id);
  if (!canDeleteAttachment(doc, user._id, membership.role)) {
    const error = new Error("Only the uploader or Team Coordinator can delete this attachment.");
    error.status = 403;
    throw error;
  }

  const bucket = getAttachmentBucket(db);
  await bucket.delete(doc.gridFsFileId).catch(() => {});
  await db.collection(ATTACHMENT_META).deleteOne({ _id: doc._id });

  if (doc.messageId) {
    await db.collection("messages").updateOne(
      { _id: doc.messageId, groupId: doc.groupId },
      {
        $unset: { attachmentId: "", attachment: "" },
        $set: { attachmentRemovedAt: new Date() },
      },
    );
  }

  return { ok: true, id: String(doc._id) };
}

export async function attachmentByIdMap(db, ids) {
  if (!ids?.length) return new Map();
  const objectIds = ids.map((id) => (id instanceof ObjectId ? id : asObjectId(id, "attachment id")));
  const docs = await db.collection(ATTACHMENT_META)
    .find({ _id: { $in: objectIds }, status: "attached" })
    .toArray();
  return new Map(docs.map((d) => [String(d._id), d]));
}

/** Test / ops helper: wipe GridFS bucket contents for the dedicated test database. */
export async function clearAttachmentStorage(db) {
  await db.collection(ATTACHMENT_META).deleteMany({});
  await db.collection("attachment_upload_rate_limits").deleteMany({});
  await db.collection(`${ATTACHMENT_BUCKET}.files`).deleteMany({});
  await db.collection(`${ATTACHMENT_BUCKET}.chunks`).deleteMany({});
}
