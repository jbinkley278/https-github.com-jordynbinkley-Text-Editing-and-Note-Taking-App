import assert from "node:assert/strict";
import test from "node:test";
import {
  STORAGE_KEY, addDays, addMessage, addTask, deleteTask, itemsByDate, loadState, progress, saveState, seedState,
  unreadCount, updateTask, upcoming, validateTask,
} from "../src/store.js";

const TODAY = "2026-10-14";

function emptyState() {
  const state = seedState(TODAY);
  state.tasks = [];
  state.events = [];
  state.messages = [];
  return state;
}

function memoryStorage() {
  const values = new Map();
  return { values, getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
}

test("addDays handles month boundaries", () => {
  assert.equal(addDays("2026-10-30", 3), "2026-11-02");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("validateTask requires a title and due date", () => {
  assert.deepEqual(Object.keys(validateTask({ title: "  ", dueDate: "" })).sort(), ["dueDate", "title"]);
  assert.deepEqual(validateTask({ title: "Write SRS", dueDate: TODAY, status: "todo", priority: "high" }), {});
  assert.ok(validateTask({ title: "x", dueDate: TODAY, status: "blocked" }).status);
});

test("creating a task stores all SRS fields and logs activity", () => {
  const state = emptyState();
  const task = addTask(state, { title: " Calendar page ", description: "month view", assignee: "tobi", priority: "high", dueDate: TODAY }, "brandon");
  assert.equal(task.title, "Calendar page");
  assert.equal(task.status, "todo");
  assert.equal(task.createdBy, "brandon");
  assert.equal(state.activity[0].type, "task-created");
});

test("moving and reassigning a task are recorded in activity history", () => {
  const state = emptyState();
  const task = addTask(state, { title: "Chat UI", dueDate: TODAY, assignee: "sandesh" });
  updateTask(state, task.id, { status: "progress" }, "sandesh");
  updateTask(state, task.id, { assignee: "jordyn" }, "tobi");
  assert.equal(task.status, "progress");
  assert.equal(task.assignee, "jordyn");
  assert.match(state.activity[1].text, /to In Progress/);
  assert.match(state.activity[0].text, /to Jordyn Binkley/);
});

test("saving an unchanged status does not add activity", () => {
  const state = emptyState();
  const task = addTask(state, { title: "Login", dueDate: TODAY });
  const before = state.activity.length;
  updateTask(state, task.id, { status: "todo", title: "Login page" });
  assert.equal(state.activity.length, before);
  assert.equal(task.title, "Login page");
});

test("deleting a task removes it", () => {
  const state = emptyState();
  const task = addTask(state, { title: "Temp", dueDate: TODAY });
  assert.equal(deleteTask(state, task.id), true);
  assert.equal(state.tasks.length, 0);
  assert.equal(deleteTask(state, "missing"), false);
});

test("progress is the share of done tasks", () => {
  const state = emptyState();
  assert.equal(progress(state).percent, 0);
  ["todo", "progress", "done", "done"].forEach((status, i) => addTask(state, { title: `t${i}`, dueDate: TODAY, status }));
  const result = progress(state);
  assert.equal(result.percent, 50);
  assert.deepEqual(result.counts, { todo: 1, progress: 1, done: 2 });
});

test("upcoming includes overdue and near tasks but skips done and far ones", () => {
  const state = emptyState();
  addTask(state, { title: "late", dueDate: addDays(TODAY, -2) });
  addTask(state, { title: "soon", dueDate: addDays(TODAY, 3) });
  addTask(state, { title: "far", dueDate: addDays(TODAY, 30) });
  addTask(state, { title: "finished", dueDate: TODAY, status: "done" });
  state.events.push({ id: "e1", title: "demo", date: addDays(TODAY, 1) });
  const items = upcoming(state, TODAY, 7);
  assert.deepEqual(items.map((i) => i.title), ["late", "demo", "soon"]);
  assert.equal(items[0].overdue, true);
});

test("itemsByDate groups tasks and events for one month", () => {
  const state = emptyState();
  addTask(state, { title: "a", dueDate: "2026-10-20" });
  addTask(state, { title: "b", dueDate: "2026-11-01" });
  state.events.push({ id: "e", title: "demo", date: "2026-10-20" });
  const map = itemsByDate(state, "2026-10");
  assert.equal(map.size, 1);
  assert.equal(map.get("2026-10-20").length, 2);
});

test("messages ignore blank text and count as unread for other members", () => {
  const state = emptyState();
  assert.equal(addMessage(state, "   "), null);
  addMessage(state, "hello", "tobi");
  addMessage(state, "my own message", state.currentUserId);
  assert.equal(unreadCount(state), 1);
  state.lastReadChat = new Date(Date.now() + 1000).toISOString();
  assert.equal(unreadCount(state), 0);
});

test("state survives a save/load round trip and bad JSON falls back to seed data", () => {
  const storage = memoryStorage();
  const state = emptyState();
  addTask(state, { title: "persist me", dueDate: TODAY, status: "done" });
  saveState(state, storage);
  assert.equal(loadState(storage).tasks[0].status, "done");
  storage.values.set(STORAGE_KEY, "{not json");
  assert.ok(loadState(storage).tasks.length > 0);
});
