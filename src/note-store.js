export const STORAGE_KEY = "noteworthy.notes.v1";

export function createNote(now = new Date()) {
  const timestamp = now.toISOString();
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    title: "Untitled note",
    body: "",
    pinned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function sortNotes(notes) {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

export function filterNotes(notes, query) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return notes;
  return notes.filter(({ title, body }) => `${title} ${body}`.toLocaleLowerCase().includes(normalized));
}

export function loadNotes(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveNotes(notes, storage = globalThis.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(notes));
}
