import assert from "node:assert/strict";
import test from "node:test";
import { withServer } from "./helpers.mjs";

async function twoMemberGroup(request, cookieJar) {
  const john = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "John Chat",
      email: `john_chat_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`,
      password: "password123",
    },
  });
  assert.equal(john.status, 201);

  const group = await request("/api/groups", {
    method: "POST",
    body: { name: "Chat Lab" },
  });
  assert.equal(group.status, 201);
  const groupId = group.data.group.id;

  const invite = await request(`/api/groups/${groupId}/invitations`, {
    method: "POST",
    body: {},
  });
  assert.equal(invite.status, 201);

  const markJar = cookieJar();
  const mark = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "Mark Chat",
      email: `mark_chat_${Date.now()}_${Math.random().toString(16).slice(2)}@example.com`,
      password: "password123",
    },
    jar: markJar,
  });
  assert.equal(mark.status, 201);
  const joined = await request("/api/groups/join", {
    method: "POST",
    body: { code: invite.data.invitation.code },
    jar: markJar,
  });
  assert.equal(joined.status, 200);

  return {
    groupId,
    johnId: john.data.user.id,
    markId: mark.data.user.id,
    markJar,
  };
}

test("messages persist with sender identity and chronological order", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId, johnId, markId, markJar } = await twoMemberGroup(request, cookieJar);

    const first = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "Hello from John" },
    });
    assert.equal(first.status, 201);
    assert.equal(first.data.message.senderId, johnId);
    assert.equal(first.data.message.senderName, "John Chat");
    assert.equal(first.data.message.text, "Hello from John");
    assert.ok(first.data.message.createdAt);

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "Hi John — Mark here" },
      jar: markJar,
    });
    assert.equal(second.status, 201);
    assert.equal(second.data.message.senderId, markId);
    assert.equal(second.data.message.senderName, "Mark Chat");

    const listed = await request(`/api/groups/${groupId}/messages`, { jar: markJar });
    assert.equal(listed.status, 200);
    assert.equal(listed.data.messages.length, 2);
    assert.equal(listed.data.messages[0].text, "Hello from John");
    assert.equal(listed.data.messages[1].text, "Hi John — Mark here");
    assert.ok(listed.data.messages[0].createdAt <= listed.data.messages[1].createdAt);
    assert.equal(listed.data.messages[0].senderId, johnId);
    assert.equal(listed.data.messages[1].senderId, markId);
  });
});

test("blank and invalid messages are rejected", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId } = await twoMemberGroup(request, cookieJar);

    const blank = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "   " },
    });
    assert.equal(blank.status, 400);

    const wrongType = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: 12345 },
    });
    assert.equal(wrongType.status, 400);

    const tooLong = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "x".repeat(501) },
    });
    assert.equal(tooLong.status, 400);

    const empty = await request(`/api/groups/${groupId}/messages`);
    assert.equal(empty.status, 200);
    assert.equal(empty.data.messages.length, 0);
  });
});

test("unauthenticated chat access is rejected", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId } = await twoMemberGroup(request, cookieJar);
    const anon = cookieJar();
    const listed = await request(`/api/groups/${groupId}/messages`, { jar: anon });
    assert.equal(listed.status, 401);
    const sent = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "nope" },
      jar: anon,
    });
    assert.equal(sent.status, 401);
  });
});

test("cross-group chat isolation is enforced", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId } = await twoMemberGroup(request, cookieJar);
    await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "Private to Chat Lab" },
    });

    const otherJar = cookieJar();
    await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Other Owner",
        email: `other_chat_${Date.now()}@example.com`,
        password: "password123",
      },
      jar: otherJar,
    });
    const otherGroup = await request("/api/groups", {
      method: "POST",
      body: { name: "Other Chat Group" },
      jar: otherJar,
    });
    assert.equal(otherGroup.status, 201);

    const otherList = await request(`/api/groups/${otherGroup.data.group.id}/messages`, {
      jar: otherJar,
    });
    assert.equal(otherList.status, 200);
    assert.equal(otherList.data.messages.length, 0);

    const outsiderJar = cookieJar();
    await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Stranger",
        email: `stranger_chat_${Date.now()}@example.com`,
        password: "password123",
      },
      jar: outsiderJar,
    });
    const forbidden = await request(`/api/groups/${groupId}/messages`, { jar: outsiderJar });
    assert.equal(forbidden.status, 403);
  });
});

test("client cannot impersonate another sender via request body", async () => {
  await withServer(async ({ request, cookieJar }) => {
    const { groupId, johnId, markId, markJar } = await twoMemberGroup(request, cookieJar);
    const forged = await request(`/api/groups/${groupId}/messages`, {
      method: "POST",
      body: { text: "Forged as John", senderId: johnId, senderName: "John Chat" },
      jar: markJar,
    });
    assert.equal(forged.status, 201);
    assert.equal(forged.data.message.senderId, markId);
    assert.equal(forged.data.message.senderName, "Mark Chat");
    assert.notEqual(forged.data.message.senderId, johnId);
  });
});
