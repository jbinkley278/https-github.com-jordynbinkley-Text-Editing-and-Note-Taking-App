import {
  STATUSES, STATUS_LABELS, contributions, itemsByDate, memberName, progress, toDateKey, unreadCount, upcoming,
} from "./store.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function initials(name) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export function shortDate(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function timeAgo(iso) {
  const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} hr ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function deadlineList(items) {
  if (!items.length) return `<p class="muted">Nothing due this week.</p>`;
  return `<ul class="deadline-list">${items.map((item) => `
    <li class="${item.overdue ? "overdue" : ""}">
      <span>${item.kind === "event" ? "📅 " : ""}${esc(item.title)}</span>
      <span class="date">${item.overdue ? "Overdue · " : ""}${shortDate(item.date)}</span>
    </li>`).join("")}</ul>`;
}

export function dashboardView(state, today) {
  const me = state.members.find((m) => m.id === state.currentUserId);
  const mine = state.tasks.filter((t) => t.assignee === me.id && t.status !== "done");
  const soon = upcoming(state, today, 7);
  const { percent } = progress(state);
  const activity = state.activity.slice(0, 6);
  return `
    <h1>Welcome back, ${esc(me.name.split(" ")[0])}</h1>
    <p class="muted">${esc(state.group.name)}</p>
    <div class="stats">
      <a class="stat stat-blue" href="#/tasks"><strong>${mine.length}</strong><span>Your open tasks</span></a>
      <a class="stat stat-yellow" href="#/calendar"><strong>${soon.length}</strong><span>Due this week</span></a>
      <a class="stat stat-green" href="#/progress"><strong>${percent}%</strong><span>Group progress</span></a>
      <a class="stat stat-purple" href="#/chat"><strong>${unreadCount(state)}</strong><span>New messages</span></a>
    </div>
    <div class="two-col">
      <section class="card">
        <h2>Upcoming deadlines</h2>
        ${deadlineList(soon)}
      </section>
      <section class="card">
        <h2>Recent activity</h2>
        ${activity.length ? `<ul class="activity">${activity.map((a) => `
          <li><b>${esc(memberName(state, a.userId).split(" ")[0])}</b> ${esc(a.text)} <span class="muted">${timeAgo(a.timestamp)}</span></li>`).join("")}</ul>`
          : `<p class="muted">No activity yet. Changes to tasks will show up here.</p>`}
      </section>
    </div>`;
}

function taskCard(state, task, today) {
  const index = STATUSES.indexOf(task.status);
  const overdue = task.status !== "done" && task.dueDate < today;
  return `
    <li class="task-card priority-${task.priority}" draggable="true" data-task="${task.id}">
      <button class="task-open" data-action="edit-task" data-id="${task.id}">
        <span class="task-title">${esc(task.title)}</span>
        <span class="task-meta">${esc(memberName(state, task.assignee))}</span>
        <span class="task-meta ${overdue ? "overdue" : ""}">${overdue ? "Overdue · " : "Due "}${shortDate(task.dueDate)} · ${task.priority}</span>
      </button>
      <div class="move-buttons">
        <button data-action="move" data-id="${task.id}" data-to="${STATUSES[index - 1] ?? ""}" ${index === 0 ? "disabled" : ""}
          aria-label="Move ${esc(task.title)} to ${STATUS_LABELS[STATUSES[index - 1]] ?? ""}">←</button>
        <button data-action="move" data-id="${task.id}" data-to="${STATUSES[index + 1] ?? ""}" ${index === STATUSES.length - 1 ? "disabled" : ""}
          aria-label="Move ${esc(task.title)} to ${STATUS_LABELS[STATUSES[index + 1]] ?? ""}">→</button>
      </div>
    </li>`;
}

export function boardView(state, today, filter) {
  const tasks = filter === "mine" ? state.tasks.filter((t) => t.assignee === state.currentUserId) : state.tasks;
  return `
    <div class="page-head">
      <h1>Task Board</h1>
      <label class="inline-select">Show
        <select id="board-filter">
          <option value="all" ${filter !== "mine" ? "selected" : ""}>All tasks</option>
          <option value="mine" ${filter === "mine" ? "selected" : ""}>My tasks</option>
        </select>
      </label>
      <button class="btn-primary" data-action="new-task">+ Add task</button>
    </div>
    <div class="board">
      ${STATUSES.map((status) => {
        const column = tasks.filter((t) => t.status === status).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        return `
        <section class="column" data-status="${status}" aria-labelledby="col-${status}">
          <h2 id="col-${status}" class="pill pill-${status}">${STATUS_LABELS[status]} <span>${column.length}</span></h2>
          <ul class="task-list">
            ${column.map((task) => taskCard(state, task, today)).join("") || `<li class="empty">No tasks</li>`}
          </ul>
        </section>`;
      }).join("")}
    </div>`;
}

export function calendarView(state, today, year, month) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prefix = toDateKey(first).slice(0, 7);
  const items = itemsByDate(state, prefix);
  const blanks = Array.from({ length: first.getDay() }, () => `<li class="blank" aria-hidden="true"></li>`);
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const key = `${prefix}-${String(i + 1).padStart(2, "0")}`;
    const list = items.get(key) ?? [];
    return `
      <li class="day ${key === today ? "today" : ""} ${list.length ? "has-items" : ""}">
        <span class="day-num">${i + 1}${key === today ? `<span class="sr-only"> (today)</span>` : ""}</span>
        ${list.map((item) => `<span class="cal-item ${item.kind}${item.done ? " done" : ""}">${item.kind === "event" ? "📅 " : ""}${esc(item.title)}</span>`).join("")}
      </li>`;
  });
  const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return `
    <div class="page-head">
      <h1>Calendar</h1>
      <button class="btn-primary" data-action="new-event">+ Event</button>
    </div>
    <div class="calendar-wrap">
      <section class="card calendar">
        <div class="month-nav">
          <button class="btn-secondary" data-action="month" data-step="-1" aria-label="Previous month">‹</button>
          <h2 aria-live="polite">${monthLabel}</h2>
          <button class="btn-secondary" data-action="month" data-step="1" aria-label="Next month">›</button>
        </div>
        <ol class="weekdays" aria-hidden="true">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<li>${d}</li>`).join("")}</ol>
        <ol class="days">${blanks.join("")}${days.join("")}</ol>
      </section>
      <section class="card">
        <h2>Next two weeks</h2>
        ${deadlineList(upcoming(state, today, 14))}
      </section>
    </div>`;
}

export function chatView(state) {
  return `
    <h1>Group Chat</h1>
    <p class="muted">${state.members.length} members</p>
    <ol class="messages" id="messages" aria-live="polite">
      ${state.messages.map((m) => {
        const name = memberName(state, m.senderId);
        const mine = m.senderId === state.currentUserId;
        return `
        <li class="message ${mine ? "mine" : ""}">
          <span class="avatar small" aria-hidden="true">${initials(name)}</span>
          <div class="bubble">
            <div class="message-head"><b>${esc(name)}</b> <time datetime="${m.timestamp}">${timeAgo(m.timestamp)}</time></div>
            <p>${esc(m.text)}</p>
          </div>
        </li>`;
      }).join("")}
    </ol>
    <form class="composer" id="chat-form">
      <label class="sr-only" for="chat-input">Message</label>
      <input id="chat-input" name="text" placeholder="Type a message…" autocomplete="off" maxlength="500" />
      <button class="btn-primary" type="submit">Send</button>
    </form>`;
}

export function progressView(state) {
  const { percent, counts, total } = progress(state);
  const rows = contributions(state);
  const max = Math.max(1, ...rows.map((r) => r.done + r.active));
  return `
    <h1>Progress</h1>
    <section class="card">
      <h2>Overall completion</h2>
      <div class="bar big" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Overall completion">
        <span style="width:${percent}%"></span><b>${percent}%</b>
      </div>
      <p class="muted">${counts.done} of ${total} tasks done</p>
    </section>
    <section class="card">
      <h2>Status breakdown</h2>
      <div class="pills">${STATUSES.map((s) => `<span class="pill pill-${s}">${counts[s]} ${STATUS_LABELS[s]}</span>`).join("")}</div>
    </section>
    <section class="card">
      <h2>Team contributions</h2>
      <ul class="contrib">
        ${rows.map(({ member, done, active }) => `
          <li>
            <a href="#/members/${member.id}">${esc(member.name.split(" ")[0])}</a>
            <div class="bar" aria-hidden="true"><span style="width:${((done + active) / max) * 100}%"></span></div>
            <span class="muted">${done} done · ${active} active</span>
          </li>`).join("")}
      </ul>
    </section>`;
}

export function membersView(state, selectedId) {
  const member = state.members.find((m) => m.id === selectedId);
  if (!member) {
    return `
      <h1>Members</h1>
      <ul class="member-grid">
        ${state.members.map((m) => `
          <li><a class="card member-link" href="#/members/${m.id}">
            <span class="avatar" aria-hidden="true">${initials(m.name)}</span>
            <span><b>${esc(m.name)}</b><br /><span class="muted">${esc(m.role)}</span></span>
          </a></li>`).join("")}
      </ul>`;
  }
  const tasks = state.tasks.filter((t) => t.assignee === member.id);
  const history = state.activity.filter((a) => a.userId === member.id).slice(0, 15);
  return `
    <a href="#/members" class="back-link">← All members</a>
    <div class="profile-head">
      <span class="avatar large" aria-hidden="true">${initials(member.name)}</span>
      <div><h1>${esc(member.name)}</h1><p class="muted">${esc(member.role)}</p></div>
    </div>
    <section class="card">
      <h2>Assigned tasks</h2>
      ${tasks.length ? `<ul class="deadline-list">${tasks.map((t) => `
        <li><span>${esc(t.title)}</span><span class="pill pill-${t.status}">${STATUS_LABELS[t.status]}</span></li>`).join("")}</ul>`
        : `<p class="muted">No tasks assigned.</p>`}
    </section>
    <section class="card">
      <h2>Contribution history</h2>
      ${history.length ? `<ul class="activity">${history.map((a) => `<li>${esc(a.text)} <span class="muted">${timeAgo(a.timestamp)}</span></li>`).join("")}</ul>`
        : `<p class="muted">No recorded activity yet.</p>`}
    </section>`;
}

export function notFoundView() {
  return `<h1>Page not found</h1><p><a href="#/dashboard">Back to the dashboard</a></p>`;
}
