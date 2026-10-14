import {
  addEvent, addMessage, addTask, deleteTask, loadState, saveState, toDateKey, unreadCount, updateTask, validateTask,
} from "./store.js";
import {
  boardView, calendarView, chatView, dashboardView, initials, membersView, notFoundView, progressView,
} from "./views.js";

const main = document.querySelector("#main");
const taskDialog = document.querySelector("#task-dialog");
const taskForm = document.querySelector("#task-form");
const eventDialog = document.querySelector("#event-dialog");
const eventForm = document.querySelector("#event-form");
const toast = document.querySelector("#toast");

let state = loadState();
saveState(state); // keeps the seed data stable across reloads
let editingId = null;
let boardFilter = "all";
const now = new Date();
let calMonth = { year: now.getFullYear(), month: now.getMonth() };

function today() { return toDateKey(new Date()); }

function save(message) {
  saveState(state);
  if (message) showToast(message);
}

let toastTimer;
function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}

function currentRoute() {
  const [, page = "dashboard", param] = location.hash.split("/");
  return { page, param };
}

function render({ focus = false } = {}) {
  const { page, param } = currentRoute();
  const views = {
    dashboard: () => dashboardView(state, today()),
    tasks: () => boardView(state, today(), boardFilter),
    calendar: () => calendarView(state, today(), calMonth.year, calMonth.month),
    chat: () => chatView(state),
    progress: () => progressView(state),
    members: () => membersView(state, param),
  };
  if (page === "chat" && unreadCount(state) > 0) {
    state.lastReadChat = new Date().toISOString();
    saveState(state);
  }
  main.innerHTML = (views[page] ?? notFoundView)();

  document.querySelectorAll("[data-route]").forEach((link) => {
    if (link.dataset.route === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const unread = unreadCount(state);
  const badge = document.querySelector("#chat-badge");
  badge.hidden = unread === 0;
  badge.textContent = unread;
  badge.setAttribute("aria-label", `${unread} unread`);

  if (page === "chat") {
    const list = document.querySelector("#messages");
    list.scrollTop = list.scrollHeight;
  }
  if (focus) {
    const heading = page === "dashboard" ? "Dashboard" : main.querySelector("h1")?.textContent;
    document.title = `${heading ?? "GroupFlow"} · GroupFlow`;
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

// ---- task dialog ----

function fillAssignees(selected) {
  const select = document.querySelector("#assignee-select");
  select.innerHTML = `<option value="">Unassigned</option>` +
    state.members.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
  select.value = selected ?? "";
}

function clearErrors(form) {
  form.querySelectorAll(".field-error").forEach((el) => { el.textContent = ""; });
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
}

function openTaskDialog(id = null) {
  editingId = id;
  const task = state.tasks.find((t) => t.id === id);
  clearErrors(taskForm);
  taskForm.reset();
  fillAssignees(task ? task.assignee : state.currentUserId);
  document.querySelector("#task-dialog-title").textContent = task ? "Task detail" : "New task";
  document.querySelector("#delete-task").hidden = !task;
  if (task) {
    for (const field of ["title", "description", "dueDate", "status", "priority"]) taskForm.elements[field].value = task[field];
  } else {
    taskForm.elements.dueDate.value = today();
    taskForm.elements.priority.value = "medium";
  }
  taskDialog.showModal();
  taskForm.elements.title.focus();
}

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(taskForm));
  const errors = validateTask(fields);
  clearErrors(taskForm);
  if (Object.keys(errors).length) {
    for (const [name, text] of Object.entries(errors)) {
      const slot = taskForm.querySelector(`[data-error="${name}"]`);
      if (slot) slot.textContent = text;
      taskForm.elements[name]?.setAttribute("aria-invalid", "true");
    }
    taskForm.querySelector("[aria-invalid]")?.focus();
    return;
  }
  fields.assignee ||= null;
  if (editingId) {
    updateTask(state, editingId, fields);
    save("Task updated");
  } else {
    addTask(state, fields);
    save("Task created");
  }
  taskDialog.close();
  render();
});

document.querySelector("#delete-task").addEventListener("click", () => {
  const task = state.tasks.find((t) => t.id === editingId);
  if (!task || !confirm(`Delete “${task.title}”? This can't be undone.`)) return;
  deleteTask(state, editingId);
  save("Task deleted");
  taskDialog.close();
  render();
});

// ---- event dialog ----

eventForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(eventForm));
  const error = eventForm.querySelector('[data-error="event"]');
  if (!fields.title.trim() || !fields.date) {
    error.textContent = "Title and date are required.";
    return;
  }
  addEvent(state, fields);
  save("Event added");
  eventDialog.close();
  render();
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

// ---- page interactions (delegated since views re-render) ----

main.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;
  if (action === "new-task") openTaskDialog();
  if (action === "edit-task") openTaskDialog(id);
  if (action === "move" && target.dataset.to) {
    updateTask(state, id, { status: target.dataset.to });
    save("Task moved");
    render();
    // keep keyboard users on the card they just moved
    main.querySelector(`[data-task="${id}"] [data-action="move"]:not([disabled])`)?.focus();
  }
  if (action === "month") {
    const step = Number(target.dataset.step);
    const d = new Date(calMonth.year, calMonth.month + step, 1);
    calMonth = { year: d.getFullYear(), month: d.getMonth() };
    render();
    main.querySelector(`[data-step="${step}"]`)?.focus();
  }
  if (action === "new-event") {
    eventForm.reset();
    eventForm.querySelector('[data-error="event"]').textContent = "";
    eventForm.elements.date.value = today();
    eventDialog.showModal();
  }
});

main.addEventListener("change", (event) => {
  if (event.target.id === "board-filter") {
    boardFilter = event.target.value;
    render();
    main.querySelector("#board-filter").focus();
  }
});

main.addEventListener("submit", (event) => {
  if (event.target.id !== "chat-form") return;
  event.preventDefault();
  const input = event.target.elements.text;
  if (!addMessage(state, input.value)) return;
  save();
  render();
  main.querySelector("#chat-input").focus();
});

// drag and drop on the board (the arrow buttons cover keyboard users)
main.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-task]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.task);
  card.classList.add("dragging");
});
main.addEventListener("dragend", (event) => event.target.closest?.("[data-task]")?.classList.remove("dragging"));
main.addEventListener("dragover", (event) => {
  const column = event.target.closest(".column");
  if (!column) return;
  event.preventDefault();
  main.querySelectorAll(".column.drop-target").forEach((c) => c !== column && c.classList.remove("drop-target"));
  column.classList.add("drop-target");
});
main.addEventListener("drop", (event) => {
  const column = event.target.closest(".column");
  if (!column) return;
  event.preventDefault();
  const id = event.dataTransfer.getData("text/plain");
  const task = state.tasks.find((t) => t.id === id);
  if (task && task.status !== column.dataset.status) {
    updateTask(state, id, { status: column.dataset.status });
    save("Task moved");
  }
  render();
});

// ---- boot ----

const me = state.members.find((m) => m.id === state.currentUserId);
document.querySelector("#group-name").textContent = state.group.name;
const avatar = document.querySelector("#current-user");
avatar.textContent = initials(me.name);
avatar.href = `#/members/${me.id}`;
avatar.setAttribute("aria-label", `Your profile (${me.name})`);

// another tab changed the data
window.addEventListener("storage", () => { state = loadState(); render(); });
window.addEventListener("hashchange", () => render({ focus: true }));
if (!location.hash) history.replaceState(null, "", "#/dashboard");
render();
