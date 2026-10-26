import assert from "node:assert/strict";
import test from "node:test";
import { Collection } from "mongodb";
import { withServer } from "./helpers.mjs";

/**
 * Temporarily fail activity inserts (optionally only for specific actions).
 * Restores Collection.prototype.insertOne in finally.
 */
async function withFailingActivityInserts(failActions, run) {
  const original = Collection.prototype.insertOne;
  const attempted = [];
  Collection.prototype.insertOne = async function patchedInsertOne(doc, options) {
    if (this.collectionName === "activity") {
      attempted.push(doc?.action ?? null);
      const shouldFail = failActions === true
        || (Array.isArray(failActions) && failActions.includes(doc?.action));
      if (shouldFail) {
        const err = new Error("simulated activity insert failure");
        err.code = "TEST_ACTIVITY_FAIL";
        throw err;
      }
    }
    return original.call(this, doc, options);
  };
  try {
    return await run({ attempted });
  } finally {
    Collection.prototype.insertOne = original;
  }
}

async function johnMarkGroup(request, cookieJar, register) {
  const john = await register("John Activity");
  const group = await request("/api/groups", {
    method: "POST",
    body: { name: "Activity Lab" },
  });
  assert.equal(group.status, 201);
  const invite = await request(`/api/groups/${group.data.group.id}/invitations`, {
    method: "POST",
    body: {},
  });
  const markJar = cookieJar();
  const mark = await register("Mark Activity", { jar: markJar });
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

test("activity attributes actors from session for successful task mutations", async () => {
  await withServer(async ({ request, cookieJar, register }) => {
    const { groupId, johnId, markId, markJar } = await johnMarkGroup(request, cookieJar, register);

    const created = await request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      body: {
        title: "Shared draft",
        dueDate: "2026-11-05",
        status: "todo",
        priority: "medium",
      },
    });
    assert.equal(created.status, 201, created.data.error);
    const taskId = created.data.task.id;

    const updated = await request(`/api/groups/${groupId}/tasks/${taskId}`, {
      method: "PATCH",
      body: { status: "progress", description: "Mark's edit" },
      jar: markJar,
    });
    assert.equal(updated.status, 200);

    const feed = await request(`/api/groups/${groupId}/activity`);
    assert.equal(feed.status, 200);
    assert.ok(feed.data.activity.length >= 2);

    const createEntry = feed.data.activity.find((a) => a.action === "task.created");
    assert.ok(createEntry);
    assert.equal(createEntry.actorId, johnId);
    assert.equal(createEntry.actorName, "John Activity");
    assert.equal(createEntry.entityTitle, "Shared draft");
    assert.match(createEntry.summary, /John Activity/);

    const statusEntry = feed.data.activity.find((a) => a.action === "task.status_changed");
    assert.ok(statusEntry);
    assert.equal(statusEntry.actorId, markId);
    assert.equal(statusEntry.actorName, "Mark Activity");
    assert.equal(statusEntry.metadata.to, "progress");

    const updateEntry = feed.data.activity.find((a) => a.action === "task.updated");
    assert.ok(updateEntry);
    assert.equal(updateEntry.actorId, markId);
  });
});

test("failed mutations and list reads do not create activity records", async () => {
  await withServer(async ({ request, cookieJar, db, register }) => {
    const { groupId } = await johnMarkGroup(request, cookieJar, register);

    const before = await db.collection("activity").countDocuments({});
    const bad = await request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      body: { title: "  ", dueDate: "2026-11-05" },
    });
    assert.equal(bad.status, 400);

    const listed = await request(`/api/groups/${groupId}/tasks`);
    assert.equal(listed.status, 200);
    const activityList = await request(`/api/groups/${groupId}/activity`);
    assert.equal(activityList.status, 200);

    const after = await db.collection("activity").countDocuments({});
    assert.equal(after, before);
    assert.equal(activityList.data.activity.length, 0);

    const forged = await request(`/api/groups/${groupId}/activity`, {
      method: "POST",
      body: { summary: "I did everything", actorName: "Impostor" },
    });
    assert.equal(forged.status, 405);
    assert.match(forged.data.error, /server-side only/i);
    assert.equal(await db.collection("activity").countDocuments({}), before);
  });
});

test("activity persists after deletes and survives across request cycles", async () => {
  await withServer(async ({ request, cookieJar, db, register }) => {
    const { groupId, markJar } = await johnMarkGroup(request, cookieJar, register);
    const created = await request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      body: { title: "Temp task", dueDate: "2026-11-06", status: "todo", priority: "low" },
    });
    const taskId = created.data.task.id;
    await request(`/api/groups/${groupId}/tasks/${taskId}`, {
      method: "PATCH",
      body: { status: "done" },
      jar: markJar,
    });
    const deleted = await request(`/api/groups/${groupId}/tasks/${taskId}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);

    const feed = await request(`/api/groups/${groupId}/activity`, { jar: markJar });
    assert.equal(feed.status, 200);
    const deleteEntry = feed.data.activity.find((a) => a.action === "task.deleted");
    assert.ok(deleteEntry);
    assert.equal(deleteEntry.entityTitle, "Temp task");
    assert.match(deleteEntry.summary, /Temp task/);

    // Activity rows remain in MongoDB after the task document is gone.
    assert.equal(await db.collection("tasks").countDocuments({}), 0);
    const count = await db.collection("activity").countDocuments({});
    assert.ok(count >= 3, `expected persisted activity, got ${count}`);
    const again = await request(`/api/groups/${groupId}/activity`);
    assert.equal(again.data.activity.length, feed.data.activity.length);
  });
});

test("contribution summary counts actions per member without inventing history", async () => {
  await withServer(async ({ request, cookieJar, register }) => {
    const { groupId, johnId, markId, markJar } = await johnMarkGroup(request, cookieJar, register);

    const empty = await request(`/api/groups/${groupId}/activity/summary`);
    assert.equal(empty.status, 200);
    assert.match(empty.data.summary.measureNote, /not a measure of effort/i);
    assert.match(empty.data.summary.measureNote, /best-effort|may be incomplete/i);
    assert.match(empty.data.summary.trackedSinceNote, /not backfilled/i);
    assert.match(empty.data.summary.trackedSinceNote, /best-effort|not guaranteed/i);
    const johnEmpty = empty.data.summary.members.find((m) => m.userId === johnId);
    assert.equal(johnEmpty.total, 0);

    await request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      body: { title: "A", dueDate: "2026-11-07", status: "todo", priority: "medium" },
    });
    await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "hello team" },
      jar: markJar,
    });
    await request(`/api/groups/${groupId}/events`, {
      method: "POST",
      body: { title: "Sync", date: "2026-11-08", startTime: null, timeZone: "UTC" },
      jar: markJar,
    });

    const summary = await request(`/api/groups/${groupId}/activity/summary`);
    assert.equal(summary.status, 200);
    const john = summary.data.summary.members.find((m) => m.userId === johnId);
    const mark = summary.data.summary.members.find((m) => m.userId === markId);
    assert.equal(john.total, 1);
    assert.equal(john.byAction["task.created"], 1);
    assert.equal(mark.total, 2);
    assert.equal(mark.byAction["message.sent"], 1);
    assert.equal(mark.byAction["event.created"], 1);

    const markOnly = await request(`/api/groups/${groupId}/activity?actorId=${markId}`);
    assert.equal(markOnly.status, 200);
    assert.ok(markOnly.data.activity.every((a) => a.actorId === markId));
    assert.ok(markOnly.data.activity.every((a) => !("text" in (a.metadata ?? {}))));
  });
});

test("activity endpoints enforce auth and cross-group isolation", async () => {
  await withServer(async ({ request, cookieJar, register }) => {
    const { groupId } = await johnMarkGroup(request, cookieJar, register);
    await request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      body: { title: "Private to lab", dueDate: "2026-11-09", status: "todo", priority: "medium" },
    });

    const outsiderJar = cookieJar();
    await register("Outsider", { jar: outsiderJar, email: `out_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com` });
    const otherGroup = await request("/api/groups", {
      method: "POST",
      body: { name: "Other group" },
      jar: outsiderJar,
    });
    assert.equal(otherGroup.status, 201);

    const denied = await request(`/api/groups/${groupId}/activity`, { jar: outsiderJar });
    assert.equal(denied.status, 403);

    const deniedSummary = await request(`/api/groups/${groupId}/activity/summary`, { jar: outsiderJar });
    assert.equal(deniedSummary.status, 403);

    const otherFeed = await request(`/api/groups/${otherGroup.data.group.id}/activity`, { jar: outsiderJar });
    assert.equal(otherFeed.status, 200);
    assert.equal(otherFeed.data.activity.length, 0);

    const anon = cookieJar();
    const unauth = await request(`/api/groups/${groupId}/activity`, { jar: anon });
    assert.equal(unauth.status, 401);
  });
});

test("activity failure after create still returns the saved resource (not 500)", async () => {
  await withServer(async ({ request, cookieJar, db, register }) => {
    const { groupId } = await johnMarkGroup(request, cookieJar, register);
    const before = await db.collection("activity").countDocuments({});

    await withFailingActivityInserts(true, async () => {
      const created = await request(`/api/groups/${groupId}/tasks`, {
        method: "POST",
        body: {
          title: "Saved despite activity outage",
          dueDate: "2026-12-01",
          status: "todo",
          priority: "medium",
        },
      });
      assert.equal(created.status, 201, created.data.error);
      assert.equal(created.data.task.title, "Saved despite activity outage");
      assert.ok(created.data.task.id);

      const listed = await request(`/api/groups/${groupId}/tasks`);
      assert.equal(listed.status, 200);
      assert.ok(listed.data.tasks.some((t) => t.id === created.data.task.id));
    });

    assert.equal(await db.collection("activity").countDocuments({}), before);
  });
});

test("failed primary writes still fail and produce no activity", async () => {
  await withServer(async ({ request, cookieJar, db, register }) => {
    const { groupId } = await johnMarkGroup(request, cookieJar, register);
    const beforeTasks = await db.collection("tasks").countDocuments({});
    const beforeActivity = await db.collection("activity").countDocuments({});

    await withFailingActivityInserts(true, async () => {
      const bad = await request(`/api/groups/${groupId}/tasks`, {
        method: "POST",
        body: { title: "  ", dueDate: "2026-12-02" },
      });
      assert.equal(bad.status, 400);
    });

    assert.equal(await db.collection("tasks").countDocuments({}), beforeTasks);
    assert.equal(await db.collection("activity").countDocuments({}), beforeActivity);
  });
});

test("multi-entry task updates attempt remaining activity entries after one fails", async () => {
  await withServer(async ({ request, cookieJar, db, register }) => {
    const { groupId, markJar } = await johnMarkGroup(request, cookieJar, register);
    const created = await request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      body: {
        title: "Multi activity",
        dueDate: "2026-12-03",
        status: "todo",
        priority: "low",
      },
    });
    assert.equal(created.status, 201);
    const taskId = created.data.task.id;
    const before = await db.collection("activity").countDocuments({});

    await withFailingActivityInserts(["task.status_changed"], async ({ attempted }) => {
      const updated = await request(`/api/groups/${groupId}/tasks/${taskId}`, {
        method: "PATCH",
        body: { status: "progress", description: "also edited" },
        jar: markJar,
      });
      assert.equal(updated.status, 200, updated.data.error);
      assert.equal(updated.data.task.status, "progress");
      assert.equal(updated.data.task.description, "also edited");

      assert.ok(attempted.includes("task.status_changed"));
      assert.ok(attempted.includes("task.updated"));
    });

    const afterFeed = await request(`/api/groups/${groupId}/activity`);
    const statusEntry = afterFeed.data.activity.find(
      (a) => a.action === "task.status_changed" && a.entityId === taskId,
    );
    const updateEntry = afterFeed.data.activity.find(
      (a) => a.action === "task.updated" && a.entityId === taskId,
    );
    assert.equal(statusEntry, undefined, "failed status activity must be absent");
    assert.ok(updateEntry, "task.updated must still be recorded");
    assert.ok(await db.collection("activity").countDocuments({}) > before);
  });
});
