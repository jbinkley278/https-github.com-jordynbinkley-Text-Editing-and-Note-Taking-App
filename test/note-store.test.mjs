import assert from "node:assert/strict";
import test from "node:test";
import { createNote, filterNotes, loadNotes, saveNotes, sortNotes, STORAGE_KEY } from "../src/note-store.js";

test("creates a complete note", () => {
  const note = createNote(new Date("2026-09-22T12:00:00Z"));
  assert.equal(note.title, "Untitled note");
  assert.equal(note.createdAt, "2026-09-22T12:00:00.000Z");
});

test("filters case-insensitively across title and body", () => {
  const notes = [{ title: "Project", body: "Roadmap" }, { title: "Shopping", body: "Coffee" }];
  assert.deepEqual(filterNotes(notes, "ROAD"), [notes[0]]);
  assert.deepEqual(filterNotes(notes, "coffee"), [notes[1]]);
});

test("sorts pinned notes before recently updated notes", () => {
  const notes = [{ id: "new", pinned: false, updatedAt: "2026-09-22" }, { id: "pin", pinned: true, updatedAt: "2020-01-01" }];
  assert.deepEqual(sortNotes(notes).map(({ id }) => id), ["pin", "new"]);
});

test("persists notes and tolerates malformed storage", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  saveNotes([{ id: "one" }], storage);
  assert.deepEqual(loadNotes(storage), [{ id: "one" }]);
  values.set(STORAGE_KEY, "not-json");
  assert.deepEqual(loadNotes(storage), []);
});
