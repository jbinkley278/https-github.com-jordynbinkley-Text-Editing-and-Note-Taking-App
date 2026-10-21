import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { withServer } from "./helpers.mjs";

async function johnMarkGroup(request, cookieJar) {
  const john = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "John Unread",
      email: `john_un_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`,
      password: "password123",
    },
  });
  assert.equal(john.status, 201);
  const group = await request("/api/groups", {
    method: "POST",
    body: { name: "Unread Lab" },
  });
  assert.equal(group.status, 201);
  const invite = await request(`/api/groups/${group.data.group.id}/invitations`, {
    method: "POST",
    body: {},
  });
  const markJar = cookieJar();
  const mark = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "Mark Unread",
      email: `mark_un_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`,
      password: "password123",
    },
    jar: markJar,
  });
  assert.equal(mark.status, 201);
  await request("/api/groups/join", {
    method: "POST",
    body: { code: invite.data.invitation.code },
    jar: markJar,
  });
  return {
    groupId: group.data.group.id,
    johnId: john.data.user.id,
    markId: mark.data.user.id,
    markJar,
  };
}

test("own messages are excluded from unread; others increase until marked read", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId, markJar } = await johnMarkGroup(request, cookieJar);

    const fromJohn = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "Hello Mark" },
    });
    assert.equal(fromJohn.status, 201);

    const johnUnread = await request(`/api/groups/${groupId}/messages/unread`);
    assert.equal(johnUnread.status, 200);
    assert.equal(johnUnread.data.unreadCount, 0, "own messages must not count as unread");

    const markUnread = await request(`/api/groups/${groupId}/messages/unread`, { jar: markJar });
    assert.equal(markUnread.status, 200);
    assert.equal(markUnread.data.unreadCount, 1);

    const marked = await request(`/api/groups/${groupId}/messages/read`, {
      method: "POST",
      body: { upToMessageId: fromJohn.data.message.id },
      jar: markJar,
    });
    assert.equal(marked.status, 200);
    assert.equal(marked.data.unreadCount, 0);
    assert.equal(marked.data.lastReadMessageId, fromJohn.data.message.id);

    const stillClear = await request(`/api/groups/${groupId}/messages/unread`, { jar: markJar });
    assert.equal(stillClear.data.unreadCount, 0);
  });
});

test("read cursor advances only through upToMessageId and ignores stale older requests", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId, markJar } = await johnMarkGroup(request, cookieJar);

    const first = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "one" },
    });
    const second = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "two" },
    });
    const third = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "three" },
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(third.status, 201);

    // Mark only through the second displayed message — third stays unread.
    const partial = await request(`/api/groups/${groupId}/messages/read`, {
      method: "POST",
      body: { upToMessageId: second.data.message.id },
      jar: markJar,
    });
    assert.equal(partial.status, 200);
    assert.equal(partial.data.unreadCount, 1);
    assert.equal(partial.data.lastReadMessageId, second.data.message.id);

    // Stale request with an older upTo must not move the cursor backward.
    const stale = await request(`/api/groups/${groupId}/messages/read`, {
      method: "POST",
      body: { upToMessageId: first.data.message.id },
      jar: markJar,
    });
    assert.equal(stale.status, 200);
    assert.equal(stale.data.lastReadMessageId, second.data.message.id);
    assert.equal(stale.data.unreadCount, 1);

    const again = await request(`/api/groups/${groupId}/messages/unread`, { jar: markJar });
    assert.equal(again.data.unreadCount, 1);
  });
});

test("read positions are isolated by user and group and persist in MongoDB", async () => {
  await withServer(async ({ request, cookieJar, db }) => {
    const { groupId, markJar } = await johnMarkGroup(request, cookieJar);

    const msg = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "shared note" },
    });
    assert.equal(msg.status, 201);

    await request(`/api/groups/${groupId}/messages/read`, {
      method: "POST",
      body: { upToMessageId: msg.data.message.id },
      jar: markJar,
    });

    const johnStillUnread = await request(`/api/groups/${groupId}/messages/unread`);
    // John's own message does not count; no unread for John.
    assert.equal(johnStillUnread.data.unreadCount, 0);

    const markClear = await request(`/api/groups/${groupId}/messages/unread`, { jar: markJar });
    assert.equal(markClear.data.unreadCount, 0);

    const stored = await db.collection("chat_read_positions").find({}).toArray();
    assert.equal(stored.length, 1);
    assert.equal(String(stored[0].lastReadMessageId), msg.data.message.id);

    // Second group: Mark's read state there starts fresh.
    const other = await request("/api/groups", {
      method: "POST",
      body: { name: "Other unread group" },
      jar: markJar,
    });
    const otherInvite = await request(`/api/groups/${other.data.group.id}/invitations`, {
      method: "POST",
      body: {},
      jar: markJar,
    });
    await request("/api/groups/join", {
      method: "POST",
      body: { code: otherInvite.data.invitation.code },
    });
    const otherMsg = await request(`/api/groups/${other.data.group.id}/messages`, {
      method: "POST",
      body: { text: "in other group" },
      jar: markJar,
    });
    const johnOther = await request(`/api/groups/${other.data.group.id}/messages/unread`);
    assert.equal(johnOther.data.unreadCount, 1);
    const markOther = await request(`/api/groups/${other.data.group.id}/messages/unread`, { jar: markJar });
    assert.equal(markOther.data.unreadCount, 0);

    // Original group still clear for Mark.
    const markOriginal = await request(`/api/groups/${groupId}/messages/unread`, { jar: markJar });
    assert.equal(markOriginal.data.unreadCount, 0);
  });
});

test("unread endpoints require auth/membership; reading does not create activity", async () => {
  await withServer(async ({ request, cookieJar, db }) => {
    const { groupId, markJar } = await johnMarkGroup(request, cookieJar);
    const msg = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "activity check" },
    });
    const before = await db.collection("activity").countDocuments({});

    const anon = cookieJar();
    const unauth = await request(`/api/groups/${groupId}/messages/unread`, { jar: anon });
    assert.equal(unauth.status, 401);

    const outsiderJar = cookieJar();
    await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Outsider Unread",
        email: `out_un_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`,
        password: "password123",
      },
      jar: outsiderJar,
    });
    const denied = await request(`/api/groups/${groupId}/messages/unread`, { jar: outsiderJar });
    assert.equal(denied.status, 403);
    const deniedRead = await request(`/api/groups/${groupId}/messages/read`, {
      method: "POST",
      body: { upToMessageId: msg.data.message.id },
      jar: outsiderJar,
    });
    assert.equal(deniedRead.status, 403);

    await request(`/api/groups/${groupId}/messages/read`, {
      method: "POST",
      body: { upToMessageId: msg.data.message.id },
      jar: markJar,
    });
    const after = await db.collection("activity").countDocuments({});
    assert.equal(after, before);
  });
});

test("existing history counts as unread until displayed; new messages after cursor stay unread", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId, markJar } = await johnMarkGroup(request, cookieJar);

    const older = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "history" },
    });
    assert.equal(older.status, 201);

    // No read position yet → historical others' messages are unread.
    const initial = await request(`/api/groups/${groupId}/messages/unread`, { jar: markJar });
    assert.equal(initial.data.unreadCount, 1);

    await request(`/api/groups/${groupId}/messages/read`, {
      method: "POST",
      body: { upToMessageId: older.data.message.id },
      jar: markJar,
    });

    const newer = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "after catch-up" },
    });
    const after = await request(`/api/groups/${groupId}/messages/unread`, { jar: markJar });
    assert.equal(after.data.unreadCount, 1);
    assert.equal(after.data.lastReadMessageId, older.data.message.id);

    // Marking only the older id again must not clear the newer unread.
    await request(`/api/groups/${groupId}/messages/read`, {
      method: "POST",
      body: { upToMessageId: older.data.message.id },
      jar: markJar,
    });
    const still = await request(`/api/groups/${groupId}/messages/unread`, { jar: markJar });
    assert.equal(still.data.unreadCount, 1);
    assert.ok(still.data.unreadCount === 1 && newer.data.message.id);
  });
});

test("identical createdAt timestamps break ties by ObjectId; stale reads stay monotonic", async () => {
  await withServer(async ({ request, cookieJar, db }) => {
    const { groupId, johnId, markJar } = await johnMarkGroup(request, cookieJar);
    assert.equal(db.databaseName.endsWith("_test"), true);

    const groupOid = new ObjectId(groupId);
    const johnOid = new ObjectId(johnId);
    const stamped = new Date("2026-10-20T15:30:00.000Z");
    const idA = ObjectId.createFromHexString("aaaaaaaaaaaaaaaaaaaaaaaa");
    const idB = ObjectId.createFromHexString("bbbbbbbbbbbbbbbbbbbbbbbb");
    const idC = ObjectId.createFromHexString("cccccccccccccccccccccccc");

    await db.collection("messages").insertMany([
      { _id: idA, groupId: groupOid, senderId: johnOid, text: "tie-a", createdAt: stamped },
      { _id: idB, groupId: groupOid, senderId: johnOid, text: "tie-b", createdAt: stamped },
      { _id: idC, groupId: groupOid, senderId: johnOid, text: "tie-c", createdAt: stamped },
    ]);

    const listed = await request(`/api/groups/${groupId}/messages`, { jar: markJar });
    assert.equal(listed.status, 200);
    const tieIds = listed.data.messages.map((m) => m.id);
    assert.deepEqual(tieIds, [String(idA), String(idB), String(idC)], "list order is (createdAt, _id)");

    const initial = await request(`/api/groups/${groupId}/messages/unread`, { jar: markJar });
    assert.equal(initial.data.unreadCount, 3);

    // Advance through the middle tied message.
    const mid = await request(`/api/groups/${groupId}/messages/read`, {
      method: "POST",
      body: { upToMessageId: String(idB) },
      jar: markJar,
    });
    assert.equal(mid.status, 200);
    assert.equal(mid.data.lastReadMessageId, String(idB));
    assert.equal(mid.data.unreadCount, 1, "only later ObjectId at same timestamp remains unread");

    // Stale update with earlier tied id must not move the cursor backward.
    const stale = await request(`/api/groups/${groupId}/messages/read`, {
      method: "POST",
      body: { upToMessageId: String(idA) },
      jar: markJar,
    });
    assert.equal(stale.status, 200);
    assert.equal(stale.data.lastReadMessageId, String(idB));
    assert.equal(stale.data.unreadCount, 1);

    // A newer distinct timestamp stays unread until marked.
    const newerId = ObjectId.createFromHexString("dddddddddddddddddddddddd");
    await db.collection("messages").insertOne({
      _id: newerId,
      groupId: groupOid,
      senderId: johnOid,
      text: "after-ties",
      createdAt: new Date("2026-10-20T15:30:01.000Z"),
    });
    const withNewer = await request(`/api/groups/${groupId}/messages/unread`, { jar: markJar });
    assert.equal(withNewer.data.unreadCount, 2);
    assert.equal(withNewer.data.lastReadMessageId, String(idB));

    const catchUp = await request(`/api/groups/${groupId}/messages/read`, {
      method: "POST",
      body: { upToMessageId: String(idC) },
      jar: markJar,
    });
    assert.equal(catchUp.data.lastReadMessageId, String(idC));
    assert.equal(catchUp.data.unreadCount, 1);

    // John (sender) still has zero unread — own messages excluded.
    const johnUnread = await request(`/api/groups/${groupId}/messages/unread`);
    assert.equal(johnUnread.data.unreadCount, 0);
  });
});
