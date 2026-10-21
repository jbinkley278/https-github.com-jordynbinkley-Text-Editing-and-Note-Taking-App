import {
  ACTIONS,
  ACTION_LABELS,
  ACTIVITY_MEASURE_NOTE,
  ACTIVITY_TRACKED_NOTE,
  publicActivity,
} from "../activity/service.js";
import { asObjectId, publicMember, requireMembership } from "../groups/service.js";

/**
 * FR14 member profile for a group member.
 * Identity/role from membership; assignment counts from tasks; contribution from activity.
 * Does not return password hashes, sessions, or other private account fields.
 */
export async function getMemberProfile(db, groupIdRaw, memberIdRaw, requesterId) {
  const { group } = await requireMembership(db, groupIdRaw, requesterId);
  const memberId = asObjectId(memberIdRaw, "member id");

  const membership = await db.collection("memberships").findOne({
    groupId: group._id,
    userId: memberId,
  });
  if (!membership) {
    const error = new Error("Member not found in this group.");
    error.status = 404;
    throw error;
  }

  const user = await db.collection("users").findOne(
    { _id: memberId },
    { projection: { name: 1, email: 1 } },
  );
  if (!user) {
    const error = new Error("Member not found in this group.");
    error.status = 404;
    throw error;
  }

  const assignedTasks = await db.collection("tasks")
    .find({ groupId: group._id, assigneeId: memberId })
    .project({ status: 1, title: 1, dueDate: 1, priority: 1 })
    .toArray();

  const byStatus = { todo: 0, progress: 0, done: 0 };
  for (const task of assignedTasks) {
    if (byStatus[task.status] !== undefined) byStatus[task.status] += 1;
  }
  const done = byStatus.done;
  const active = byStatus.todo + byStatus.progress;

  const activityRows = await db.collection("activity")
    .find({ groupId: group._id, actorId: memberId })
    .sort({ createdAt: -1, _id: -1 })
    .limit(50)
    .toArray();

  const byAction = Object.fromEntries(Object.values(ACTIONS).map((a) => [a, 0]));
  let contributionTotal = 0;
  const actionCounts = await db.collection("activity").aggregate([
    { $match: { groupId: group._id, actorId: memberId } },
    { $group: { _id: "$action", count: { $sum: 1 } } },
  ]).toArray();
  for (const row of actionCounts) {
    byAction[row._id] = (byAction[row._id] ?? 0) + row.count;
    contributionTotal += row.count;
  }

  const lastActiveAt = activityRows[0]?.createdAt
    ? activityRows[0].createdAt.toISOString()
    : null;

  const identity = publicMember(user, membership);
  return {
    id: identity.id,
    name: identity.name,
    email: identity.email,
    role: identity.role,
    roleLabel: identity.roleLabel,
    joinedAt: identity.joinedAt,
    lastActiveAt,
    assignments: {
      note: "Assigned-task counts show current ownership on the board. They are not contribution totals and do not measure effort or quality.",
      total: assignedTasks.length,
      done,
      active,
      byStatus,
      tasks: assignedTasks.map((t) => ({
        id: String(t._id),
        title: t.title,
        status: t.status,
        dueDate: t.dueDate,
        priority: t.priority,
      })),
    },
    contribution: {
      note: ACTIVITY_MEASURE_NOTE,
      trackedSinceNote: ACTIVITY_TRACKED_NOTE,
      total: contributionTotal,
      byAction,
      actionLabels: ACTION_LABELS,
    },
    recentActivity: activityRows.slice(0, 15).map(publicActivity),
  };
}
