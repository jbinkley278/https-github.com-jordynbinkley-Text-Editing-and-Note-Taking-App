import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { compareObjectIds, isAfterCursor } from "../server/messages/readPosition.js";

test("compareObjectIds uses BSON byte order matching MongoDB $gt", () => {
  const older = ObjectId.createFromHexString("000000000000000000000001");
  const newer = ObjectId.createFromHexString("000000000000000000000002");
  const max = ObjectId.createFromHexString("ffffffffffffffffffffffff");

  assert.ok(compareObjectIds(newer, older) > 0);
  assert.ok(compareObjectIds(older, newer) < 0);
  assert.equal(compareObjectIds(older, older), 0);
  assert.ok(compareObjectIds(max, newer) > 0);

  // Hex strings and ObjectIds compare consistently.
  assert.ok(compareObjectIds(String(newer), older) > 0);
  assert.ok(compareObjectIds(newer, String(older)) > 0);
});

test("isAfterCursor ties on createdAt break with ObjectId order", () => {
  const stamped = new Date("2026-10-20T12:00:00.000Z");
  const idA = ObjectId.createFromHexString("aaaaaaaaaaaaaaaaaaaaaaaa");
  const idB = ObjectId.createFromHexString("bbbbbbbbbbbbbbbbbbbbbbbb");
  const idC = ObjectId.createFromHexString("cccccccccccccccccccccccc");

  const cursorAtB = {
    lastReadAt: stamped,
    lastReadMessageId: idB,
  };

  assert.equal(
    isAfterCursor({ createdAt: stamped, _id: idA }, cursorAtB),
    false,
    "earlier ObjectId at same createdAt is not after cursor",
  );
  assert.equal(
    isAfterCursor({ createdAt: stamped, _id: idB }, cursorAtB),
    false,
    "same ObjectId is not after cursor",
  );
  assert.equal(
    isAfterCursor({ createdAt: stamped, _id: idC }, cursorAtB),
    true,
    "later ObjectId at same createdAt is after cursor",
  );
  assert.equal(
    isAfterCursor({ createdAt: new Date("2026-10-20T12:00:01.000Z"), _id: idA }, cursorAtB),
    true,
    "later createdAt is after cursor regardless of ObjectId",
  );
  assert.equal(
    isAfterCursor({ createdAt: new Date("2026-10-20T11:59:59.000Z"), _id: idC }, cursorAtB),
    false,
    "earlier createdAt is before cursor regardless of ObjectId",
  );
});
