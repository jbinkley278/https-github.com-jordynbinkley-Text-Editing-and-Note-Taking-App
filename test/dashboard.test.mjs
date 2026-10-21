import assert from "node:assert/strict";
import test from "node:test";
import { seedState } from "../src/store.js";
import { dashboardView } from "../src/views.js";

const TODAY = "2026-10-14";

test("dashboard greeting uses the authenticated session name, not the demo currentUserId", () => {
  const state = seedState(TODAY);
  assert.equal(state.currentUserId, "brandon");
  assert.equal(state.members.find((m) => m.id === "brandon")?.name, "Brandon Clair");

  const html = dashboardView(state, TODAY, {
    id: "auth-user-1",
    name: "John Smith",
    email: "john@example.com",
  }, { memberCount: 1, isCoordinator: true });

  assert.match(html, /Welcome back, John/);
  assert.doesNotMatch(html, /Welcome back, Brandon/);
});

test("dashboard greeting rejects a missing authenticated name (no demo fallback)", () => {
  const state = seedState(TODAY);
  assert.throws(
    () => dashboardView(state, TODAY, null),
    /authenticated user's name/i,
  );
  assert.throws(
    () => dashboardView(state, TODAY, { id: "x", name: "   ", email: "x@example.com" }),
    /authenticated user's name/i,
  );
});
