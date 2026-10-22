import assert from "node:assert/strict";
import test from "node:test";
import { withServer } from "./helpers.mjs";

async function memberGroup(request, cookieJar) {
  const owner = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "John Calendar",
      email: `john_cal_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`,
      password: "password123",
    },
  });
  assert.equal(owner.status, 201);
  const group = await request("/api/groups", {
    method: "POST",
    body: { name: "Calendar Lab" },
  });
  assert.equal(group.status, 201);
  const invite = await request(`/api/groups/${group.data.group.id}/invitations`, {
    method: "POST",
    body: {},
  });
  const markJar = cookieJar();
  await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "Mark Calendar",
      email: `mark_cal_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`,
      password: "password123",
    },
    jar: markJar,
  });
  await request("/api/groups/join", {
    method: "POST",
    body: { code: invite.data.invitation.code },
    jar: markJar,
  });
  return { groupId: group.data.group.id, markJar };
}

test("event CRUD persists meetings with date and optional timed timezone", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId, markJar } = await memberGroup(request, cookieJar);

    const created = await request(`/api/groups/${groupId}/events`, {
      method: "POST",
      body: {
        title: "Sprint planning",
        date: "2026-10-28",
        startTime: "14:30",
        timeZone: "America/Chicago",
        description: "Bring status notes",
      },
    });
    assert.equal(created.status, 201, created.data.error);
    assert.equal(created.data.event.title, "Sprint planning");
    assert.equal(created.data.event.date, "2026-10-28");
    assert.equal(created.data.event.startTime, "14:30");
    assert.equal(created.data.event.timeZone, "America/Chicago");

    const listed = await request(`/api/groups/${groupId}/events`, { jar: markJar });
    assert.equal(listed.status, 200);
    assert.equal(listed.data.events.length, 1);

    const eventId = created.data.event.id;
    const updated = await request(`/api/groups/${groupId}/events/${eventId}`, {
      method: "PATCH",
      body: { title: "Sprint planning (moved)", startTime: null },
      jar: markJar,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.event.title, "Sprint planning (moved)");
    assert.equal(updated.data.event.startTime, null);
    assert.equal(updated.data.event.date, "2026-10-28");

    const deleted = await request(`/api/groups/${groupId}/events/${eventId}`, {
      method: "DELETE",
    });
    assert.equal(deleted.status, 200);
    const empty = await request(`/api/groups/${groupId}/events`);
    assert.equal(empty.data.events.length, 0);
  });
});

test("event validation rejects blank title and bad dates/times", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId } = await memberGroup(request, cookieJar);
    const blank = await request(`/api/groups/${groupId}/events`, {
      method: "POST",
      body: { title: "  ", date: "2026-10-28" },
    });
    assert.equal(blank.status, 400);

    const badDate = await request(`/api/groups/${groupId}/events`, {
      method: "POST",
      body: { title: "Bad date", date: "10/28/2026" },
    });
    assert.equal(badDate.status, 400);

    const badTime = await request(`/api/groups/${groupId}/events`, {
      method: "POST",
      body: { title: "Bad time", date: "2026-10-28", startTime: "25:99" },
    });
    assert.equal(badTime.status, 400);
  });
});

test("date-only events and task due dates stay YYYY-MM-DD without timezone conversion", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId, markJar } = await memberGroup(request, cookieJar);
    const event = await request(`/api/groups/${groupId}/events`, {
      method: "POST",
      body: { title: "Demo day", date: "2026-11-01", startTime: null, timeZone: "UTC" },
    });
    assert.equal(event.status, 201);
    assert.equal(event.data.event.date, "2026-11-01");

    const task = await request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      body: { title: "Ship notes", dueDate: "2026-11-01", status: "todo" },
    });
    assert.equal(task.status, 201);
    assert.equal(task.data.task.dueDate, "2026-11-01");

    const moved = await request(`/api/groups/${groupId}/tasks/${task.data.task.id}`, {
      method: "PATCH",
      body: { dueDate: "2026-11-03" },
      jar: markJar,
    });
    assert.equal(moved.status, 200);
    assert.equal(moved.data.task.dueDate, "2026-11-03");
  });
});

test("cross-group event access by id is denied", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId } = await memberGroup(request, cookieJar);
    const created = await request(`/api/groups/${groupId}/events`, {
      method: "POST",
      body: { title: "Private meeting", date: "2026-10-30" },
    });
    assert.equal(created.status, 201);
    const eventId = created.data.event.id;

    const otherJar = cookieJar();
    await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Other Cal",
        email: `other_cal_${Date.now()}@example.com`,
        password: "password123",
      },
      jar: otherJar,
    });
    const otherGroup = await request("/api/groups", {
      method: "POST",
      body: { name: "Other Cal Group" },
      jar: otherJar,
    });

    const leak = await request(`/api/groups/${otherGroup.data.group.id}/events/${eventId}`, {
      jar: otherJar,
    });
    assert.equal(leak.status, 404);

    const outsiderJar = cookieJar();
    await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Stranger Cal",
        email: `stranger_cal_${Date.now()}@example.com`,
        password: "password123",
      },
      jar: outsiderJar,
    });
    const forbidden = await request(`/api/groups/${groupId}/events/${eventId}`, {
      jar: outsiderJar,
    });
    assert.equal(forbidden.status, 403);
  });
});
