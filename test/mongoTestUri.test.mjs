import assert from "node:assert/strict";
import test from "node:test";
import {
  APPLICATION_DATABASE_NAMES,
  assertSafeTestMongoUri,
  parseMongoUri,
} from "./mongoTestUri.mjs";

/** These tests must not import helpers.mjs, server/db.js, or connect to MongoDB. */

test("parseMongoUri normalizes host, default port, and database name", () => {
  const parsed = parseMongoUri("mongodb://127.0.0.1/groupflow_test");
  assert.equal(parsed.database, "groupflow_test");
  assert.equal(parsed.host, "127.0.0.1");
  assert.equal(parsed.port, "27017");
  assert.equal(parsed.normalizedTarget, "127.0.0.1:27017/groupflow_test");
});

test("parseMongoUri treats explicit port as part of the normalized target", () => {
  const a = parseMongoUri("mongodb://LocalHost:27017/groupflow_test");
  const b = parseMongoUri("mongodb://localhost/groupflow_test");
  assert.equal(a.normalizedTarget, b.normalizedTarget);
});

test("missing MONGODB_URI_TEST is rejected before any connection", () => {
  assert.throws(() => assertSafeTestMongoUri(undefined), { code: "MONGO_TEST_URI_REQUIRED" });
  assert.throws(() => assertSafeTestMongoUri(""), { code: "MONGO_TEST_URI_REQUIRED" });
  assert.throws(() => assertSafeTestMongoUri("   "), { code: "MONGO_TEST_URI_REQUIRED" });
});

test("URI without a database name is rejected", () => {
  assert.throws(
    () => assertSafeTestMongoUri("mongodb://127.0.0.1:27017/"),
    { code: "MONGO_TEST_DB_MISSING" },
  );
  assert.throws(
    () => assertSafeTestMongoUri("mongodb://127.0.0.1:27017"),
    { code: "MONGO_TEST_DB_MISSING" },
  );
});

test("application database names are rejected", () => {
  for (const name of APPLICATION_DATABASE_NAMES) {
    assert.throws(
      () => assertSafeTestMongoUri(`mongodb://127.0.0.1:27017/${name}`),
      { code: "MONGO_TEST_DB_APPLICATION" },
    );
  }
});

test("system databases admin/local/config are rejected", () => {
  for (const name of ["admin", "local", "config"]) {
    assert.throws(
      () => assertSafeTestMongoUri(`mongodb://127.0.0.1:27017/${name}`),
      { code: "MONGO_TEST_DB_SYSTEM" },
    );
  }
});

test("database names that are not clearly test databases are rejected", () => {
  assert.throws(
    () => assertSafeTestMongoUri("mongodb://127.0.0.1:27017/groupflow_prod"),
    { code: "MONGO_TEST_DB_NAME" },
  );
  assert.throws(
    () => assertSafeTestMongoUri("mongodb://127.0.0.1:27017/testdb"),
    { code: "MONGO_TEST_DB_NAME" },
  );
});

test("normalized target equal to the application URI is rejected", () => {
  assert.throws(
    () => assertSafeTestMongoUri(
      "mongodb://127.0.0.1/groupflow_test",
      { appUri: "mongodb://127.0.0.1:27017/groupflow_test" },
    ),
    { code: "MONGO_TEST_DB_SAME_AS_APP" },
  );
});

test("dedicated groupflow_test URI is accepted and distinct from app groupflow", () => {
  const parsed = assertSafeTestMongoUri(
    "mongodb://127.0.0.1:27017/groupflow_test",
    { appUri: "mongodb://127.0.0.1:27017/groupflow" },
  );
  assert.equal(parsed.database, "groupflow_test");
  assert.equal(parsed.normalizedTarget, "127.0.0.1:27017/groupflow_test");
  assert.notEqual(parsed.normalizedTarget, "127.0.0.1:27017/groupflow");
});

test("helpers fallback strings that pointed at app or unset URIs would fail validation", () => {
  // Documents the old unsafe patterns: no silent fallback to MONGODB_URI / groupflow.
  assert.throws(
    () => assertSafeTestMongoUri(undefined, { appUri: "mongodb://127.0.0.1:27017/groupflow" }),
    { code: "MONGO_TEST_URI_REQUIRED" },
  );
  assert.throws(
    () => assertSafeTestMongoUri("mongodb://127.0.0.1:27017/groupflow"),
    { code: "MONGO_TEST_DB_APPLICATION" },
  );
});
