import assert from "node:assert/strict";
import test from "node:test";
import { withServer } from "./helpers.mjs";
import { mutateInvitationForTests } from "../server/groups/service.js";
import { emptyWorkspaceState, seedState, STORAGE_KEY } from "../src/store.js";

test("creating a group makes the creator Team Coordinator and lists the group", async () => {
  await withServer(async ({ request, register }) => {
    await register("Coordinator One");
    const created = await request("/api/groups", {
      method: "POST",
      body: { name: "Sprint Team", description: "FR03 workspace" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.group.name, "Sprint Team");
    assert.equal(created.data.group.role, "coordinator");
    assert.equal(created.data.group.roleLabel, "Team Coordinator");

    const listed = await request("/api/groups");
    assert.equal(listed.status, 200);
    assert.equal(listed.data.groups.length, 1);
    assert.equal(listed.data.groups[0].id, created.data.group.id);

    const members = await request(`/api/groups/${created.data.group.id}/members`);
    assert.equal(members.status, 200);
    assert.equal(members.data.members.length, 1);
    assert.equal(members.data.members[0].role, "coordinator");
    assert.equal(members.data.members[0].name, "Coordinator One");
  });
});

test("invite acceptance adds a Student Member; duplicate join is rejected", async () => {
  await withServer(async ({ request, register, cookieJar }) => {
    await register("Coordinator Two");
    const group = await request("/api/groups", {
      method: "POST",
      body: { name: "Invite Lab" },
    });
    const invite = await request(`/api/groups/${group.data.group.id}/invitations`, {
      method: "POST",
      body: {},
    });
    assert.equal(invite.status, 201);
    assert.ok(invite.data.invitation.code.length >= 16);

    const memberJar = cookieJar();
    const email = `member_${Date.now()}@example.com`;
    const memberReg = await request("/api/auth/register", {
      method: "POST",
      body: { name: "Member Two", email, password: "password123" },
      jar: memberJar,
    });
    assert.equal(memberReg.status, 201);

    const joined = await request("/api/groups/join", {
      method: "POST",
      body: { code: invite.data.invitation.code },
      jar: memberJar,
    });
    assert.equal(joined.status, 200);
    assert.equal(joined.data.group.role, "member");
    assert.equal(joined.data.group.roleLabel, "Student Member");

    const again = await request("/api/groups/join", {
      method: "POST",
      body: { code: invite.data.invitation.code },
      jar: memberJar,
    });
    assert.equal(again.status, 409);

    const members = await request(`/api/groups/${group.data.group.id}/members`);
    assert.equal(members.status, 200);
    assert.equal(members.data.members.length, 2);
    assert.ok(members.data.members.some((m) => m.name === "Member Two" && m.role === "member"));
  });
});

test("invalid, expired, and revoked invitations are rejected", async () => {
  await withServer(async ({ request, register, cookieJar, db }) => {
    await register("Coordinator Three");
    const group = await request("/api/groups", {
      method: "POST",
      body: { name: "Expiry Lab" },
    });

    const bad = await request("/api/groups/join", {
      method: "POST",
      body: { code: "this-code-is-not-real-zzzz" },
    });
    assert.equal(bad.status, 404);

    const invite = await request(`/api/groups/${group.data.group.id}/invitations`, {
      method: "POST",
      body: {},
    });
    assert.equal(invite.status, 201);

    await mutateInvitationForTests(db, invite.data.invitation.id, {
      expiresAt: new Date(Date.now() - 60_000),
    });

    const memberJar = cookieJar();
    await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Late Joiner",
        email: `late_${Date.now()}@example.com`,
        password: "password123",
      },
      jar: memberJar,
    });
    const expired = await request("/api/groups/join", {
      method: "POST",
      body: { code: invite.data.invitation.code },
      jar: memberJar,
    });
    assert.equal(expired.status, 410);
    assert.match(expired.data.error, /expired/i);

    const invite2 = await request(`/api/groups/${group.data.group.id}/invitations`, {
      method: "POST",
      body: {},
    });
    const revoked = await request(
      `/api/groups/${group.data.group.id}/invitations/${invite2.data.invitation.id}/revoke`,
      { method: "POST", body: {} },
    );
    assert.equal(revoked.status, 200);

    const afterRevoke = await request("/api/groups/join", {
      method: "POST",
      body: { code: invite2.data.invitation.code },
      jar: memberJar,
    });
    assert.equal(afterRevoke.status, 410);
    assert.match(afterRevoke.data.error, /revoked/i);
  });
});

test("non-members and non-coordinators are denied group management access", async () => {
  await withServer(async ({ request, register, cookieJar }) => {
    await register("Coordinator Four");
    const group = await request("/api/groups", {
      method: "POST",
      body: { name: "Private Lab" },
    });
    const groupId = group.data.group.id;

    const outsiderJar = cookieJar();
    await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Outsider",
        email: `out_${Date.now()}@example.com`,
        password: "password123",
      },
      jar: outsiderJar,
    });

    const deniedMembers = await request(`/api/groups/${groupId}/members`, { jar: outsiderJar });
    assert.equal(deniedMembers.status, 403);

    const deniedInvite = await request(`/api/groups/${groupId}/invitations`, {
      method: "POST",
      body: {},
      jar: outsiderJar,
    });
    assert.equal(deniedInvite.status, 403);

    const invite = await request(`/api/groups/${groupId}/invitations`, {
      method: "POST",
      body: {},
    });
    const memberJar = cookieJar();
    await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Plain Member",
        email: `plain_${Date.now()}@example.com`,
        password: "password123",
      },
      jar: memberJar,
    });
    await request("/api/groups/join", {
      method: "POST",
      body: { code: invite.data.invitation.code },
      jar: memberJar,
    });

    const memberInvite = await request(`/api/groups/${groupId}/invitations`, {
      method: "POST",
      body: {},
      jar: memberJar,
    });
    assert.equal(memberInvite.status, 403);
    assert.match(memberInvite.data.error, /coordinator/i);
  });
});

test("new workspace state stays empty and does not copy the local prototype seed", () => {
  const seed = seedState("2026-10-14");
  assert.ok(seed.tasks.length > 0);
  assert.equal(seed.group.name, "CSCE 3444 Group 6");

  const workspace = emptyWorkspaceState(
    { id: "abc", name: "Real Group", description: "" },
    "user-1",
  );
  assert.equal(workspace.source, "mongodb-group");
  assert.equal(workspace.tasks.length, 0);
  assert.equal(workspace.messages.length, 0);
  assert.equal(workspace.members.length, 0);
  assert.notEqual(workspace.group.name, seed.group.name);
  assert.notEqual(STORAGE_KEY, "gf.activeGroupId");
});
