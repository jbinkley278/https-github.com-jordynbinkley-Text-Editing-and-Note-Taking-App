import assert from "node:assert/strict";
import test from "node:test";
import {
  chatObserverRoot,
  contiguousVisibleUpToId,
  firstUnreadStartIndex,
  initialScrollMessageId,
  isNearBottom,
  messageIndexById,
} from "../src/chatReadPolicy.js";

function msgs(...ids) {
  return ids.map((id) => ({ id }));
}

// --- Automated policy tests (no browser / no MongoDB) ---

test("opening a long unread conversation targets the first message, not the bottom", () => {
  const list = msgs("m1", "m2", "m3", "m4", "m5");
  assert.equal(firstUnreadStartIndex(list, null), 0);
  assert.equal(initialScrollMessageId(list, null), "m1");
  assert.equal(initialScrollMessageId(list, "m2"), "m3");
});

test("caught-up conversation has no unread entry target (open at bottom)", () => {
  const list = msgs("m1", "m2", "m3");
  assert.equal(firstUnreadStartIndex(list, "m3"), 3);
  assert.equal(initialScrollMessageId(list, "m3"), null);
});

test("scrolling marks only a contiguous visible prefix from the first unread", () => {
  const list = msgs("a", "b", "c", "d", "e");

  // Viewport shows c–e but cursor is before a → cannot skip a/b.
  assert.equal(contiguousVisibleUpToId(list, null, ["c", "d", "e"]), null);

  // First unread a is visible with b → advance through b only (c not visible).
  assert.equal(contiguousVisibleUpToId(list, null, ["a", "b"]), "b");

  // After cursor at b, visible d–e without c → cannot skip c.
  assert.equal(contiguousVisibleUpToId(list, "b", ["d", "e"]), null);

  // Scroll so c–d are visible → advance to d; e stays unread.
  assert.equal(contiguousVisibleUpToId(list, "b", ["c", "d"]), "d");
});

test("hidden / empty visibility never advances the cursor", () => {
  const list = msgs("a", "b", "c");
  assert.equal(contiguousVisibleUpToId(list, null, []), null);
  assert.equal(contiguousVisibleUpToId(list, "a", new Set()), null);
});

test("newly arriving messages after the cursor stay unread until visible", () => {
  const list = msgs("old", "mid", "new");
  // User has read through mid; only old+mid painted in an odd viewport without new.
  assert.equal(contiguousVisibleUpToId(list, "mid", ["old", "mid"]), null);
  // New message becomes visible → may advance.
  assert.equal(contiguousVisibleUpToId(list, "mid", ["mid", "new"]), "new");
});

test("cursor independence: later visible ids do not move a stuck earlier gap", () => {
  const list = msgs("u1", "u2", "u3", "u4");
  // Reader A stuck: u1 not visible, u3+u4 visible — no advance.
  assert.equal(contiguousVisibleUpToId(list, null, ["u3", "u4"]), null);
  // Reader B already at u2 — independent; can advance through visible u3.
  assert.equal(contiguousVisibleUpToId(list, "u2", ["u3"]), "u3");
  assert.notEqual(
    contiguousVisibleUpToId(list, null, ["u3", "u4"]),
    contiguousVisibleUpToId(list, "u2", ["u3"]),
  );
});

test("isNearBottom and chatObserverRoot helpers", () => {
  assert.equal(isNearBottom(null), true);
  assert.equal(
    isNearBottom({ scrollHeight: 500, scrollTop: 400, clientHeight: 100 }),
    true,
  );
  assert.equal(
    isNearBottom({ scrollHeight: 500, scrollTop: 0, clientHeight: 100 }),
    false,
  );

  assert.equal(chatObserverRoot(null), null);
  const overflowing = { scrollHeight: 400, clientHeight: 200 };
  assert.equal(chatObserverRoot(overflowing), overflowing);
  assert.equal(chatObserverRoot({ scrollHeight: 100, clientHeight: 200 }), null);
});

test("messageIndexById looks up positions", () => {
  const list = msgs("a", "b");
  assert.equal(messageIndexById(list, "b"), 1);
  assert.equal(messageIndexById(list, "missing"), -1);
  assert.equal(messageIndexById(list, null), -1);
});

/*
 * Manual browser checks (not automated here):
 * 1. Long unread history → Chat opens at first unread; badge stays > 0 until you scroll.
 * 2. Scroll gradually → unread count drops as messages enter the chat viewport.
 * 3. Switch to another tab/window → read cursor does not jump while hidden.
 * 4. Stay scrolled up while a peer sends messages → scroll position holds; new
 *    messages do not force jump to bottom; unread stays until you scroll to them.
 * 5. Leave Chat / switch group / log out → no further read POSTs for the old view.
 */
