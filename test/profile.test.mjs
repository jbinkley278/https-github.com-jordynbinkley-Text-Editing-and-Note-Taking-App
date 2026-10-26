import assert from "node:assert/strict";
import test from "node:test";
import { withServer } from "./helpers.mjs";

async function johnMarkGroup(request, cookieJar, register) {
  const john = await register("John Profile");
  const group = await request("/api/groups", {
    method: "POST",
    body: { name: "Profile Lab" },
  });
  assert.equal(group.status, 201);
  const invite = await request(`/api/groups/${group.data.group.id}/invitations`, {
    method: "POST",
    body: {},
  });
  const markJar = cookieJar();
  const mark = await register("Mark Profile", { jar: markJar });
  await request("/api/groups/join", {
    method: "POST",
    body: { code: invite.data.invitation.code },
    jar: markJar,
  });
  return {
    groupId: group.data.group.id,
    johnId: john.user.id,
    markId: mark.user.id,
    markJar,
  };
}

test("member profile returns identity, role, assignments, contribution, and recent activity", async () => {
  await withServer(async ({ request, cookieJar, register }) => {
    const { groupId, johnId, markId, markJar } = await johnMarkGroup(request, cookieJar, register);

    const forMark = await request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      body: {
        title: "Owned by Mark",
        dueDate: "2026-11-12",
        status: "todo",
        priority: "medium",
        assignee: markId,
      },
    });
    assert.equal(forMark.status, 201);

    await request(`/api/groups/${groupId}/tasks/${forMark.data.task.id}`, {
      method: "PATCH",
      body: { status: "progress", description: "Mark working" },
      jar: markJar,
    });

    const profile = await request(`/api/groups/${groupId}/members/${markId}`);
    assert.equal(profile.status, 200, profile.data.error);
    const p = profile.data.profile;
    assert.equal(p.id, markId);
    assert.equal(p.name, "Mark Profile");
    assert.equal(p.role, "member");
    assert.equal(p.roleLabel, "Student Member");
    assert.ok(p.email.includes("@"));
    assert.ok(!("passwordHash" in p));
    assert.ok(!("password" in p));
    assert.ok(!("sessions" in p));

    assert.equal(p.assignments.total, 1);
    assert.equal(p.assignments.active, 1);
    assert.equal(p.assignments.done, 0);
    assert.equal(p.assignments.tasks[0].title, "Owned by Mark");
    assert.match(p.assignments.note, /not contribution/i);

    assert.ok(p.contribution.total >= 1);
    assert.ok(p.contribution.byAction["task.status_changed"] >= 1
      || p.contribution.byAction["task.updated"] >= 1);
    assert.match(p.contribution.note, /not a measure of effort/i);
    assert.notEqual(p.contribution.total, p.assignments.total);

    assert.ok(Array.isArray(p.recentActivity));
    assert.ok(p.recentActivity.length >= 1);
    assert.ok(p.recentActivity.every((a) => a.actorId === markId));
    assert.ok(p.lastActiveAt);

    const johnProfile = await request(`/api/groups/${groupId}/members/${johnId}`, { jar: markJar });
    assert.equal(johnProfile.status, 200);
    assert.equal(johnProfile.data.profile.role, "coordinator");
    assert.equal(johnProfile.data.profile.assignments.total, 0);
    assert.ok(johnProfile.data.profile.contribution.total >= 1);
  });
});

test("profile access requires auth and group membership; non-members are not exposed", async () => {
  await withServer(async ({ request, cookieJar, register }) => {
    const { groupId, markId } = await johnMarkGroup(request, cookieJar, register);

    const anon = cookieJar();
    const unauth = await request(`/api/groups/${groupId}/members/${markId}`, { jar: anon });
    assert.equal(unauth.status, 401);

    const outsiderJar = cookieJar();
    await register("Outsider", { jar: outsiderJar, email: `out_prof_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com` });
    const denied = await request(`/api/groups/${groupId}/members/${markId}`, { jar: outsiderJar });
    assert.equal(denied.status, 403);

    const missing = await request(`/api/groups/${groupId}/members/000000000000000000000000`);
    assert.equal(missing.status, 404);

    const otherGroup = await request("/api/groups", {
      method: "POST",
      body: { name: "Other" },
      jar: outsiderJar,
    });
    const cross = await request(
      `/api/groups/${otherGroup.data.group.id}/members/${markId}`,
      { jar: outsiderJar },
    );
    assert.equal(cross.status, 404);
  });
});

test("profile mutations are rejected and cannot grant coordinator role", async () => {
  await withServer(async ({ request, cookieJar, db, register }) => {
    const { groupId, markId } = await johnMarkGroup(request, cookieJar, register);

    const patched = await request(`/api/groups/${groupId}/members/${markId}`, {
      method: "PATCH",
      body: { role: "coordinator", name: "Hacked" },
    });
    assert.equal(patched.status, 405);

    const posted = await request(`/api/groups/${groupId}/members/${markId}`, {
      method: "POST",
      body: { role: "coordinator" },
    });
    assert.equal(posted.status, 405);

    const membership = await db.collection("memberships").findOne({
      userId: (await db.collection("users").findOne({ name: "Mark Profile" }))._id,
    });
    assert.equal(membership.role, "member");

    const profile = await request(`/api/groups/${groupId}/members/${markId}`);
    assert.equal(profile.data.profile.role, "member");
    assert.equal(profile.data.profile.name, "Mark Profile");
  });
});

test("member list responses omit password hashes", async () => {
  await withServer(async ({ request, cookieJar, register }) => {
    const { groupId } = await johnMarkGroup(request, cookieJar, register);
    const listed = await request(`/api/groups/${groupId}/members`);
    assert.equal(listed.status, 200);
    for (const member of listed.data.members) {
      assert.ok(!("passwordHash" in member));
      assert.ok(!("password" in member));
      assert.ok(member.name);
      assert.ok(member.role);
    }
  });
});
