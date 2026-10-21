import assert from "node:assert/strict";
import test from "node:test";
import { withServer } from "./helpers.mjs";

async function createGroupWithMember(request, cookieJar) {
  const coordinator = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "John Coordinator",
      email: `john_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`,
      password: "password123",
    },
  });
  assert.equal(coordinator.status, 201);

  const group = await request("/api/groups", {
    method: "POST",
    body: { name: "Task Lab" },
  });
  assert.equal(group.status, 201);
  const groupId = group.data.group.id;

  const invite = await request(`/api/groups/${groupId}/invitations`, {
    method: "POST",
    body: {},
  });
  assert.equal(invite.status, 201);

  const memberJar = cookieJar();
  const member = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "Mark Member",
      email: `mark_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`,
      password: "password123",
    },
    jar: memberJar,
  });
  assert.equal(member.status, 201);

  const joined = await request("/api/groups/join", {
    method: "POST",
    body: { code: invite.data.invitation.code },
    jar: memberJar,
  });
  assert.equal(joined.status, 200);

  return {
    groupId,
    coordinatorId: coordinator.data.user.id,
    memberId: member.data.user.id,
    memberJar,
  };
}

test("task CRUD, status change, and subtask updates persist for group members", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId, memberId, memberJar } = await createGroupWithMember(request, cookieJar);

    const created = await request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      body: {
        title: "Write acceptance tests",
        description: "Cover FR05–FR08",
        assignee: memberId,
        dueDate: "2026-10-25",
        priority: "high",
        status: "todo",
        subtasks: [
          { title: "Draft cases", done: false },
          { title: "Run suite", done: false },
        ],
      },
    });
    assert.equal(created.status, 201, created.data.error);
    assert.equal(created.data.task.title, "Write acceptance tests");
    assert.equal(created.data.task.assignee, memberId);
    assert.equal(created.data.task.subtasks.length, 2);

    const taskId = created.data.task.id;
    const listedForMember = await request(`/api/groups/${groupId}/tasks`, { jar: memberJar });
    assert.equal(listedForMember.status, 200);
    assert.equal(listedForMember.data.tasks.length, 1);

    const moved = await request(`/api/groups/${groupId}/tasks/${taskId}`, {
      method: "PATCH",
      body: { status: "progress" },
      jar: memberJar,
    });
    assert.equal(moved.status, 200);
    assert.equal(moved.data.task.status, "progress");

    const withSubtasks = await request(`/api/groups/${groupId}/tasks/${taskId}`, {
      method: "PATCH",
      body: {
        subtasks: [
          { id: moved.data.task.subtasks[0].id, title: "Draft cases", done: true },
          { id: moved.data.task.subtasks[1].id, title: "Run suite", done: false },
        ],
      },
      jar: memberJar,
    });
    assert.equal(withSubtasks.status, 200);
    assert.equal(withSubtasks.data.task.subtasks[0].done, true);

    const detail = await request(`/api/groups/${groupId}/tasks/${taskId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.task.status, "progress");
    assert.equal(detail.data.task.subtasks.filter((s) => s.done).length, 1);

    const deleted = await request(`/api/groups/${groupId}/tasks/${taskId}`, {
      method: "DELETE",
    });
    assert.equal(deleted.status, 200);
    const empty = await request(`/api/groups/${groupId}/tasks`);
    assert.equal(empty.data.tasks.length, 0);
  });
});

test("invalid assignee is rejected", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId } = await createGroupWithMember(request, cookieJar);
    const outsiderJar = cookieJar();
    const outsider = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Outsider",
        email: `out_${Date.now()}@example.com`,
        password: "password123",
      },
      jar: outsiderJar,
    });

    const bad = await request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      body: {
        title: "Bad assignee",
        dueDate: "2026-10-25",
        assignee: outsider.data.user.id,
      },
    });
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /assignee|member/i);
  });
});

test("unauthenticated task access is rejected", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId } = await createGroupWithMember(request, cookieJar);
    const anon = cookieJar();
    const listed = await request(`/api/groups/${groupId}/tasks`, { jar: anon });
    assert.equal(listed.status, 401);

    const created = await request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      body: { title: "Nope", dueDate: "2026-10-25" },
      jar: anon,
    });
    assert.equal(created.status, 401);
  });
});

test("cross-group task access by id is denied", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const first = await createGroupWithMember(request, cookieJar);
    const created = await request(`/api/groups/${first.groupId}/tasks`, {
      method: "POST",
      body: { title: "Secret task", dueDate: "2026-10-25", status: "todo" },
    });
    assert.equal(created.status, 201);
    const taskId = created.data.task.id;

    const otherJar = cookieJar();
    await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Other Owner",
        email: `other_${Date.now()}@example.com`,
        password: "password123",
      },
      jar: otherJar,
    });
    const otherGroup = await request("/api/groups", {
      method: "POST",
      body: { name: "Other Group" },
      jar: otherJar,
    });
    assert.equal(otherGroup.status, 201);

    const leak = await request(`/api/groups/${otherGroup.data.group.id}/tasks/${taskId}`, {
      jar: otherJar,
    });
    assert.equal(leak.status, 404);

    const outsiderJar = cookieJar();
    await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Stranger",
        email: `stranger_${Date.now()}@example.com`,
        password: "password123",
      },
      jar: outsiderJar,
    });
    const forbidden = await request(`/api/groups/${first.groupId}/tasks/${taskId}`, {
      jar: outsiderJar,
    });
    assert.equal(forbidden.status, 403);
  });
});
