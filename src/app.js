import { createNote, filterNotes, loadNotes, saveNotes, sortNotes } from "./note-store.js";

const elements = {
  list: document.querySelector("#note-list"), count: document.querySelector("#note-count"),
  search: document.querySelector("#search"), title: document.querySelector("#note-title"),
  body: document.querySelector("#note-body"), meta: document.querySelector("#note-meta"),
  status: document.querySelector("#save-status"), pin: document.querySelector("#pin-note"),
  remove: document.querySelector("#delete-note"), editor: document.querySelector("#editor"),
  empty: document.querySelector("#empty-state"),
};

let notes = loadNotes();
if (!notes.length) {
  const welcome = createNote();
  welcome.title = "Welcome to Noteworthy";
  welcome.body = "This is your private writing space. Create a note, search your ideas, or pin something important.";
  notes = [welcome];
  saveNotes(notes);
}
let activeId = sortNotes(notes)[0]?.id ?? null;
let saveTimer;

function activeNote() { return notes.find((note) => note.id === activeId); }
function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function excerpt(note) { return note.body.trim().replace(/\s+/g, " ") || "No additional text"; }

function renderList() {
  const visible = sortNotes(filterNotes(notes, elements.search.value));
  elements.count.textContent = String(notes.length);
  elements.list.replaceChildren(...visible.map((note) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `note-card${note.id === activeId ? " active" : ""}`;
    button.dataset.id = note.id;
    button.innerHTML = `<span class="card-title"></span><span class="card-preview"></span><span class="card-date"></span>`;
    button.querySelector(".card-title").textContent = `${note.pinned ? "★ " : ""}${note.title || "Untitled note"}`;
    button.querySelector(".card-preview").textContent = excerpt(note);
    button.querySelector(".card-date").textContent = formatDate(note.updatedAt);
    return button;
  }));
}

function renderEditor() {
  const note = activeNote();
  elements.editor.hidden = !note;
  elements.empty.hidden = Boolean(note);
  if (!note) return;
  elements.title.value = note.title;
  elements.body.value = note.body;
  elements.meta.textContent = `Last edited ${formatDate(note.updatedAt)}`;
  elements.pin.textContent = note.pinned ? "★" : "☆";
  elements.pin.setAttribute("aria-label", note.pinned ? "Unpin note" : "Pin note");
}

function render() { renderList(); renderEditor(); }
function persist() {
  saveNotes(notes);
  elements.status.textContent = "Saved";
  renderList();
}
function updateActive(field, value) {
  const note = activeNote();
  if (!note) return;
  note[field] = value;
  note.updatedAt = new Date().toISOString();
  elements.status.textContent = "Saving…";
  elements.meta.textContent = `Last edited ${formatDate(note.updatedAt)}`;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 300);
}
function addNote() {
  const note = createNote();
  notes.push(note); activeId = note.id; elements.search.value = "";
  persist(); renderEditor(); elements.title.select();
}

document.querySelectorAll("#new-note, #empty-new-note").forEach((button) => button.addEventListener("click", addNote));
elements.search.addEventListener("input", renderList);
elements.list.addEventListener("click", (event) => {
  const card = event.target.closest("[data-id]");
  if (card) { activeId = card.dataset.id; render(); }
});
elements.title.addEventListener("input", (event) => updateActive("title", event.target.value));
elements.body.addEventListener("input", (event) => updateActive("body", event.target.value));
elements.pin.addEventListener("click", () => { const note = activeNote(); if (note) { note.pinned = !note.pinned; note.updatedAt = new Date().toISOString(); persist(); render(); } });
elements.remove.addEventListener("click", () => {
  const note = activeNote();
  if (!note || !confirm(`Delete “${note.title || "Untitled note"}”?`)) return;
  notes = notes.filter(({ id }) => id !== note.id); activeId = sortNotes(notes)[0]?.id ?? null; persist(); render();
});

render();
