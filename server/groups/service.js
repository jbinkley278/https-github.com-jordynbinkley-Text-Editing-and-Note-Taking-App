import crypto from "node:crypto";
import { ObjectId } from "mongodb";
import { config } from "../config.js";
import { hashToken } from "../auth/sessions.js";
import { ROLE_COORDINATOR, ROLE_MEMBER, roleLabel } from "./roles.js";

export async function ensureGroupIndexes(db) {
  await db.collection("groups").createIndex({ createdAt: -1 });
  await db.collection("memberships").createIndex({ userId: 1, groupId: 1 }, { unique: true });
  await db.collection("memberships").createIndex({ groupId: 1 });
  await db.collection("invitations").createIndex({ codeHash: 1 }, { unique: true });
  await db.collection("invitations").createIndex({ groupId: 1, createdAt: -1 });
  await db.collection("invitations").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export function asObjectId(id, label = "id") {
  if (!ObjectId.isValid(id)) {
    const error = new Error(`Invalid ${label}.`);
    error.status = 400;
    throw error;
  }
  return new ObjectId(id);
}

export function publicGroup(group, membership) {
  return {
    id: String(group._id),
    name: group.name,
    description: group.description ?? "",
    role: membership.role,
    roleLabel: roleLabel(membership.role),
    createdAt: group.createdAt.toISOString(),
  };
}

export function publicMember(user, membership) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: membership.role,
    roleLabel: roleLabel(membership.role),
    joinedAt: membership.joinedAt.toISOString(),
  };
}

export async function createGroup(db, user, { name, description }) {
  const now = new Date();
  const groupResult = await db.collection("groups").insertOne({
    name,
    description,
    createdBy: user._id,
    createdAt: now,
  });
  const groupId = groupResult.insertedId;
  await db.collection("memberships").insertOne({
    groupId,
    userId: user._id,
    role: ROLE_COORDINATOR,
    joinedAt: now,
  });
  const group = await db.collection("groups").findOne({ _id: groupId });
  return publicGroup(group, { role: ROLE_COORDINATOR });
}

export async function listGroupsForUser(db, userId) {
  const memberships = await db.collection("memberships").find({ userId }).toArray();
  if (!memberships.length) return [];
  const byGroup = new Map(memberships.map((m) => [String(m.groupId), m]));
  const groups = await db.collection("groups")
    .find({ _id: { $in: memberships.map((m) => m.groupId) } })
    .sort({ createdAt: -1 })
    .toArray();
  return groups.map((group) => publicGroup(group, byGroup.get(String(group._id))));
}

export async function getMembership(db, groupId, userId) {
  return db.collection("memberships").findOne({
    groupId: groupId instanceof ObjectId ? groupId : asObjectId(groupId, "group id"),
    userId: userId instanceof ObjectId ? userId : asObjectId(userId, "user id"),
  });
}

export async function requireMembership(db, groupIdRaw, userId) {
  const groupId = asObjectId(groupIdRaw, "group id");
  const group = await db.collection("groups").findOne({ _id: groupId });
  if (!group) {
    const error = new Error("Group not found.");
    error.status = 404;
    throw error;
  }
  const membership = await db.collection("memberships").findOne({ groupId, userId });
  if (!membership) {
    const error = new Error("You are not a member of this group.");
    error.status = 403;
    throw error;
  }
  return { group, membership };
}

export async function requireCoordinator(db, groupIdRaw, userId) {
  const result = await requireMembership(db, groupIdRaw, userId);
  if (result.membership.role !== ROLE_COORDINATOR) {
    const error = new Error("Only the Team Coordinator can do that.");
    error.status = 403;
    throw error;
  }
  return result;
}

export async function listMembers(db, groupIdRaw, userId) {
  const { group, membership } = await requireMembership(db, groupIdRaw, userId);
  const memberships = await db.collection("memberships")
    .find({ groupId: group._id })
    .sort({ joinedAt: 1 })
    .toArray();
  const users = await db.collection("users")
    .find({ _id: { $in: memberships.map((m) => m.userId) } })
    .project({ name: 1, email: 1 })
    .toArray();
  const usersById = new Map(users.map((u) => [String(u._id), u]));
  const members = memberships
    .map((m) => {
      const user = usersById.get(String(m.userId));
      return user ? publicMember(user, m) : null;
    })
    .filter(Boolean);
  return { group: publicGroup(group, membership), members };
}

function createInviteCode() {
  return crypto.randomBytes(24).toString("base64url");
}

export async function createInvitation(db, groupIdRaw, user) {
  const { group } = await requireCoordinator(db, groupIdRaw, user._id);
  const code = createInviteCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.inviteTtlMs);
  const result = await db.collection("invitations").insertOne({
    groupId: group._id,
    codeHash: hashToken(code),
    createdBy: user._id,
    createdAt: now,
    expiresAt,
    revokedAt: null,
  });
  return {
    id: String(result.insertedId),
    code,
    expiresAt: expiresAt.toISOString(),
    group: { id: String(group._id), name: group.name },
  };
}

export async function revokeInvitation(db, groupIdRaw, inviteIdRaw, userId) {
  await requireCoordinator(db, groupIdRaw, userId);
  const inviteId = asObjectId(inviteIdRaw, "invitation id");
  const groupId = asObjectId(groupIdRaw, "group id");
  const invite = await db.collection("invitations").findOne({ _id: inviteId, groupId });
  if (!invite) {
    const error = new Error("Invitation not found.");
    error.status = 404;
    throw error;
  }
  if (invite.revokedAt) {
    return { ok: true, alreadyRevoked: true };
  }
  await db.collection("invitations").updateOne(
    { _id: inviteId },
    { $set: { revokedAt: new Date() } },
  );
  return { ok: true, alreadyRevoked: false };
}

async function findInviteByCode(db, code) {
  return db.collection("invitations").findOne({ codeHash: hashToken(code) });
}

function inviteFailure(invite) {
  if (!invite) {
    return { status: 404, error: "Invitation is invalid." };
  }
  if (invite.revokedAt) {
    return { status: 410, error: "Invitation has been revoked." };
  }
  if (invite.expiresAt <= new Date()) {
    return { status: 410, error: "Invitation has expired." };
  }
  return null;
}

export async function previewInvitation(db, code, userId) {
  const invite = await findInviteByCode(db, code);
  const failure = inviteFailure(invite);
  if (failure) {
    const error = new Error(failure.error);
    error.status = failure.status;
    throw error;
  }
  const group = await db.collection("groups").findOne({ _id: invite.groupId });
  if (!group) {
    const error = new Error("Invitation is invalid.");
    error.status = 404;
    throw error;
  }
  const membership = await db.collection("memberships").findOne({
    groupId: invite.groupId,
    userId,
  });
  return {
    group: { id: String(group._id), name: group.name, description: group.description ?? "" },
    expiresAt: invite.expiresAt.toISOString(),
    alreadyMember: Boolean(membership),
  };
}

export async function acceptInvitation(db, code, user) {
  const invite = await findInviteByCode(db, code);
  const failure = inviteFailure(invite);
  if (failure) {
    const error = new Error(failure.error);
    error.status = failure.status;
    throw error;
  }

  const group = await db.collection("groups").findOne({ _id: invite.groupId });
  if (!group) {
    const error = new Error("Invitation is invalid.");
    error.status = 404;
    throw error;
  }

  const existing = await db.collection("memberships").findOne({
    groupId: invite.groupId,
    userId: user._id,
  });
  if (existing) {
    const error = new Error("You are already a member of this group.");
    error.status = 409;
    throw error;
  }

  const now = new Date();
  try {
    await db.collection("memberships").insertOne({
      groupId: invite.groupId,
      userId: user._id,
      role: ROLE_MEMBER,
      joinedAt: now,
    });
  } catch (error) {
    if (error?.code === 11000) {
      const dup = new Error("You are already a member of this group.");
      dup.status = 409;
      throw dup;
    }
    throw error;
  }

  return publicGroup(group, { role: ROLE_MEMBER });
}

/** Test helper: force an invitation document into an expired or revoked state. */
export async function mutateInvitationForTests(db, inviteId, patch) {
  await db.collection("invitations").updateOne(
    { _id: asObjectId(inviteId, "invitation id") },
    { $set: patch },
  );
}
