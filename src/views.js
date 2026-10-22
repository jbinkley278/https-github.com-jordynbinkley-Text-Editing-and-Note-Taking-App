import {
  STATUSES, STATUS_LABELS, itemsByDate, memberName, progress, toDateKey, upcoming,
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

function formatEventWhen(item) {
  if (item.startTime) return `${item.startTime} ${item.timeZone || "UTC"}`;
  return "Date only (no time zone shift)";
}

function deadlineList(items) {
  if (!items.length) return `<p class="muted">Nothing due this week.</p>`;
  return `<ul class="deadline-list">${items.map((item) => `
    <li class="${item.overdue ? "overdue" : ""}">
      <span>${item.kind === "event" ? "📅 " : ""}${esc(item.title)}${item.kind === "event" && item.startTime ? ` · ${esc(formatEventWhen(item))}` : ""}</span>
      <span class="date">${item.overdue ? "Overdue · " : ""}${shortDate(item.date)}</span>
    </li>`).join("")}</ul>`;
}

function loadingBlock(label = "Loading…") {
  return `<p class="muted loading-line" role="status">${esc(label)}</p>`;
}

function errorBlock(message) {
  return `<div class="notice notice-error" role="alert"><strong>Could not load.</strong> ${esc(message)}</div>`;
}

function activityList(items, { empty = "No recorded activity yet." } = {}) {
  if (!items.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<ul class="activity">${items.map((a) => `
    <li>
      <span>${esc(a.summary)}</span>
      <span class="muted">${timeAgo(a.createdAt)}</span>
    </li>`).join("")}</ul>`;
}

/** sessionUser: authenticated profile from /api/auth/me (required for greeting). */
export function dashboardView(state, today, sessionUser, {
  memberCount = 0,
  isCoordinator = false,
  tasksLoading = false,
  tasksError = "",
  activity = [],
  activityLoading = false,
  activityError = "",
  unreadCount = null,
  unreadLoading = false,
  unreadError = "",
} = {}) {
  const firstName = String(sessionUser?.name ?? "").trim().split(/\s+/).filter(Boolean)[0];
  if (!firstName) {
    throw new Error("dashboardView requires the authenticated user's name");
  }
  const mine = state.tasks.filter((t) => t.assignee === state.currentUserId && t.status !== "done");
  const soonTasks = upcoming(state, today, 7).filter((item) => item.kind === "task");
  const { percent } = progress(state);
  const recent = activity.slice(0, 12);
  let unreadLabel = "Unread messages";
  let unreadDisplay = "…";
  if (unreadError) {
    unreadDisplay = "—";
    unreadLabel = "Unread unavailable";
  } else if (!unreadLoading && unreadCount != null) {
    unreadDisplay = String(unreadCount);
  }
  return `
    <h1>Welcome back, ${esc(firstName)}</h1>
    <p class="muted">${esc(state.group.name)}${state.group.description ? ` · ${esc(state.group.description)}` : ""}</p>
    <p class="muted">Your role: ${esc(isCoordinator ? "Team Coordinator" : "Student Member")} · ${memberCount} member${memberCount === 1 ? "" : "s"}</p>
    ${tasksLoading ? loadingBlock("Loading shared tasks…") : ""}
    ${tasksError ? errorBlock(tasksError) : ""}
    ${unreadError ? errorBlock(unreadError) : ""}
    <div class="stats">
      <a class="stat stat-blue" href="#/tasks"><strong>${tasksLoading ? "…" : mine.length}</strong><span>Your open tasks</span></a>
      <a class="stat stat-yellow" href="#/calendar"><strong>${tasksLoading ? "…" : soonTasks.length}</strong><span>Tasks due this week</span></a>
      <a class="stat stat-green" href="#/progress"><strong>${tasksLoading ? "…" : `${percent}%`}</strong><span>Group progress</span></a>
      <a class="stat stat-purple" href="#/chat"><strong>${esc(unreadDisplay)}</strong><span>${esc(unreadLabel)}</span></a>
    </div>
    <div class="two-col">
      <section class="card">
        <h2>Upcoming task deadlines</h2>
        ${tasksLoading ? loadingBlock() : (tasksError ? `<p class="muted">Task deadlines unavailable.</p>` : deadlineList(soonTasks))}
      </section>
      <section class="card">
        <h2>Recent activity</h2>
        <p class="muted small">Tracking started with this feature — earlier work was not backfilled. Totals count recorded app actions, not effort or quality.</p>
        ${activityLoading ? loadingBlock("Loading activity…") : ""}
        ${activityError ? errorBlock(activityError) : ""}
        ${!activityLoading && !activityError ? activityList(recent, { empty: "No recorded activity yet for this group." }) : ""}
        <p class="muted"><a href="#/progress">View contribution summary</a></p>
      </section>
    </div>
    <section class="card">
      <h2>Group actions</h2>
      <ul class="action-list">
        <li><a href="#/tasks">Open shared task board</a></li>
        <li><a href="#/members">View members</a></li>
        <li><a href="#/groups">Switch group</a></li>
        ${isCoordinator ? `<li><a href="#/invite">Create invitation link</a></li>` : `<li><a href="#/join">Join another group</a></li>`}
      </ul>
    </section>`;
}

function taskCard(state, task, today) {
  const index = STATUSES.indexOf(task.status);
  const overdue = task.status !== "done" && task.dueDate < today;
  const subtasks = task.subtasks ?? [];
  const subDone = subtasks.filter((s) => s.done).length;
  const subMeta = subtasks.length ? ` · ${subDone}/${subtasks.length} subtasks` : "";
  return `
    <li class="task-card priority-${task.priority}" draggable="true" data-task="${task.id}">
      <button class="task-open" data-action="edit-task" data-id="${task.id}">
        <span class="task-title">${esc(task.title)}</span>
        <span class="task-meta">${esc(memberName(state, task.assignee))}</span>
        <span class="task-meta ${overdue ? "overdue" : ""}">${overdue ? "Overdue · " : "Due "}${shortDate(task.dueDate)} · ${task.priority}${subMeta}</span>
      </button>
      <div class="move-buttons">
        <button data-action="move" data-id="${task.id}" data-to="${STATUSES[index - 1] ?? ""}" ${index === 0 ? "disabled" : ""}
          aria-label="Move ${esc(task.title)} to ${STATUS_LABELS[STATUSES[index - 1]] ?? ""}">←</button>
        <button data-action="move" data-id="${task.id}" data-to="${STATUSES[index + 1] ?? ""}" ${index === STATUSES.length - 1 ? "disabled" : ""}
          aria-label="Move ${esc(task.title)} to ${STATUS_LABELS[STATUSES[index + 1]] ?? ""}">→</button>
      </div>
    </li>`;
}

export function boardView(state, today, filter, { loading = false, error = "" } = {}) {
  const tasks = filter === "mine" ? state.tasks.filter((t) => t.assignee === state.currentUserId) : state.tasks;
  return `
    <div class="page-head">
      <h1>Task Board</h1>
      <label class="inline-select">Show
        <select id="board-filter" ${loading ? "disabled" : ""}>
          <option value="all" ${filter !== "mine" ? "selected" : ""}>All tasks</option>
          <option value="mine" ${filter === "mine" ? "selected" : ""}>My tasks</option>
        </select>
      </label>
      <button class="btn-primary" data-action="new-task" ${loading || error ? "disabled" : ""}>+ Add task</button>
    </div>
    <p class="muted">Shared group tasks from MongoDB.</p>
    ${loading ? loadingBlock("Loading tasks…") : ""}
    ${error ? `${errorBlock(error)} <p><button type="button" class="btn-secondary" data-action="reload-tasks">Try again</button></p>` : ""}
    ${!loading && !error ? `
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
    </div>` : ""}`;
}

export function calendarView(state, today, year, month, {
  selectedDate = today,
  loading = false,
  error = "",
} = {}) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prefix = toDateKey(first).slice(0, 7);
  const items = itemsByDate(state, prefix);
  const blanks = Array.from({ length: first.getDay() }, () => `<li class="blank" aria-hidden="true"></li>`);
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const key = `${prefix}-${String(i + 1).padStart(2, "0")}`;
    const list = items.get(key) ?? [];
    return `
      <li class="day ${key === today ? "today" : ""} ${key === selectedDate ? "selected-day" : ""} ${list.length ? "has-items" : ""}">
        <button type="button" class="day-button" data-action="select-date" data-date="${key}">
          <span class="day-num">${i + 1}${key === today ? `<span class="sr-only"> (today)</span>` : ""}</span>
          ${list.map((item) => `<span class="cal-item ${item.kind}${item.done ? " done" : ""}">${item.kind === "event" ? "📅 " : ""}${esc(item.title)}</span>`).join("")}
        </button>
      </li>`;
  });
  const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const dayItems = [
    ...state.tasks
      .filter((t) => t.dueDate === selectedDate)
      .map((t) => ({ kind: "task", id: t.id, title: t.title, done: t.status === "done", date: t.dueDate })),
    ...state.events
      .filter((e) => e.date === selectedDate)
      .map((e) => ({
        kind: "event",
        id: e.id,
        title: e.title,
        date: e.date,
        startTime: e.startTime,
        timeZone: e.timeZone,
        description: e.description,
      })),
  ].sort((a, b) => String(a.startTime || "").localeCompare(String(b.startTime || "")));

  return `
    <div class="page-head">
      <h1>Calendar</h1>
      <button class="btn-primary" data-action="new-event" ${loading || error ? "disabled" : ""}>+ Meeting</button>
    </div>
    <p class="muted">Task due dates come from shared tasks (date-only, no time-zone shift). Meetings are stored separately in MongoDB.</p>
    ${loading ? loadingBlock("Loading calendar…") : ""}
    ${error ? `${errorBlock(error)} <p><button type="button" class="btn-secondary" data-action="reload-calendar">Try again</button></p>` : ""}
    ${!loading && !error ? `
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
      <div class="calendar-side">
        <section class="card">
          <h2>${esc(shortDate(selectedDate))}</h2>
          ${dayItems.length ? `<ul class="deadline-list">${dayItems.map((item) => `
            <li>
              <span>
                ${item.kind === "event" ? "📅 " : ""}${esc(item.title)}
                ${item.kind === "event" ? `<br /><span class="muted">${esc(formatEventWhen(item))}</span>` : `<br /><span class="muted">Task deadline (date only)</span>`}
                ${item.description ? `<br /><span class="muted">${esc(item.description)}</span>` : ""}
              </span>
              ${item.kind === "event"
                ? `<span class="day-actions">
                    <button type="button" class="btn-secondary" data-action="edit-event" data-id="${esc(item.id)}">Edit</button>
                    <button type="button" class="btn-danger" data-action="delete-event" data-id="${esc(item.id)}">Delete</button>
                  </span>`
                : `<a class="muted" href="#/tasks">Open board</a>`}
            </li>`).join("")}</ul>`
            : `<p class="muted">No tasks or meetings on this date.</p>`}
        </section>
        <section class="card">
          <h2>Next two weeks</h2>
          ${deadlineList(upcoming(state, today, 14))}
        </section>
      </div>
    </div>` : ""}`;
}

export function chatView(state, {
  loading = false,
  error = "",
  sendError = "",
  sending = false,
  draft = "",
  sessionUserId = "",
} = {}) {
  const messages = state.messages ?? [];
  return `
    <h1>Group Chat</h1>
    <p class="muted">Shared group messages from MongoDB. New messages appear automatically about every 3 seconds while this page is open.</p>
    ${loading ? loadingBlock("Loading messages…") : ""}
    ${error ? `${errorBlock(error)} <p><button type="button" class="btn-secondary" data-action="reload-messages">Try again</button></p>` : ""}
    ${!loading && !error && !messages.length ? `<p class="muted empty-chat">No messages yet. Say hello to your group.</p>` : ""}
    <ol class="messages" id="messages" aria-live="polite">
      ${(!loading && !error ? messages : []).map((m) => {
        const name = m.senderName || memberName(state, m.senderId);
        const mine = m.senderId === sessionUserId;
        const stamp = m.createdAt || m.timestamp;
        return `
        <li class="message ${mine ? "mine" : ""}" data-message-id="${esc(m.id)}">
          <span class="avatar small" aria-hidden="true">${initials(name)}</span>
          <div class="bubble">
            <div class="message-head"><b>${esc(name)}</b> <time datetime="${esc(stamp)}">${timeAgo(stamp)}</time></div>
            <p>${esc(m.text)}</p>
          </div>
        </li>`;
      }).join("")}
    </ol>
    <form class="composer" id="chat-form">
      <label class="sr-only" for="chat-input">Message</label>
      <input id="chat-input" name="text" placeholder="Type a message…" autocomplete="off" maxlength="500" value="${esc(draft)}" ${sending || loading ? "disabled" : ""} />
      <button class="btn-primary" type="submit" ${sending || loading || error ? "disabled" : ""}>${sending ? "Sending…" : "Send"}</button>
    </form>
    <p class="form-error" id="chat-form-error" role="alert">${esc(sendError)}</p>`;
}

export function progressView(state, {
  summary = null,
  activityLoading = false,
  activityError = "",
  tasksLoading = false,
  tasksError = "",
} = {}) {
  const { percent, counts, total } = progress(state);
  const members = summary?.members ?? [];
  const max = Math.max(1, ...members.map((m) => m.total), 0);
  const measureNote = summary?.measureNote
    ?? "Totals count recorded GroupFlow actions. They are not a measure of effort, quality, or work done outside the app.";
  const trackedNote = summary?.trackedSinceNote
    ?? "Activity tracking began with this feature. Older actions were not backfilled.";
  return `
    <h1>Progress</h1>
    <p class="muted">Task completion is calculated from shared MongoDB tasks. Contribution totals come from the activity log.</p>
    <section class="card">
      <h2>Overall completion</h2>
      ${tasksLoading ? loadingBlock("Loading tasks…") : ""}
      ${tasksError ? errorBlock(tasksError) : ""}
      ${!tasksLoading ? `
        <div class="bar big" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Overall completion">
          <span style="width:${percent}%"></span><b>${percent}%</b>
        </div>
        <p class="muted">${counts.done} of ${total} tasks done</p>` : ""}
    </section>
    <section class="card">
      <h2>Status breakdown</h2>
      <div class="pills">${STATUSES.map((s) => `<span class="pill pill-${s}">${counts[s]} ${STATUS_LABELS[s]}</span>`).join("")}</div>
    </section>
    <section class="card">
      <h2>Team contributions</h2>
      <p class="muted">${esc(measureNote)}</p>
      <p class="muted small">${esc(trackedNote)}</p>
      ${activityLoading ? loadingBlock("Loading contributions…") : ""}
      ${activityError ? errorBlock(activityError) : ""}
      ${!activityLoading && !activityError ? (
        members.length
          ? `<ul class="contrib">
              ${members.map((m) => `
                <li>
                  <a href="#/members/${m.userId}">${esc((m.name || "Member").split(" ")[0])}</a>
                  <div class="bar" aria-hidden="true"><span style="width:${(m.total / max) * 100}%"></span></div>
                  <span class="muted">${m.total} recorded action${m.total === 1 ? "" : "s"}</span>
                </li>`).join("")}
            </ul>`
          : `<p class="muted">No contribution activity recorded yet.</p>`
      ) : ""}
    </section>`;
}

function formatLastActive(iso) {
  if (!iso) return "No recorded activity yet";
  return `Last active ${timeAgo(iso)}`;
}

/** Real MongoDB members / FR14 member profile for the active group. */
export function groupMembersView(members, selectedId, {
  groupName,
  isCoordinator,
  profile = null,
  profileLoading = false,
  profileError = "",
  membersLoading = false,
  membersError = "",
} = {}) {
  if (!selectedId) {
    return `
      <div class="page-head">
        <h1>Members</h1>
        ${isCoordinator ? `<a class="btn-primary" href="#/invite">Invite member</a>` : ""}
      </div>
      <p class="muted">${esc(groupName)} · actual membership from the server</p>
      ${membersLoading ? loadingBlock("Loading members…") : ""}
      ${membersError ? errorBlock(membersError) : ""}
      ${!membersLoading && !membersError ? (
        members.length
          ? `<ul class="member-grid">
              ${members.map((m) => `
                <li><a class="card member-link" href="#/members/${m.id}">
                  <span class="avatar" aria-hidden="true">${initials(m.name)}</span>
                  <span><b>${esc(m.name)}</b><br /><span class="muted">${esc(m.roleLabel)}</span></span>
                </a></li>`).join("")}
            </ul>`
          : `<p class="muted">No members found.</p>`
      ) : ""}`;
  }

  if (profileLoading) {
    return `
      <a href="#/members" class="back-link">← All members</a>
      <h1>Member profile</h1>
      ${loadingBlock("Loading profile…")}`;
  }
  if (profileError) {
    return `
      <a href="#/members" class="back-link">← All members</a>
      <h1>Member profile</h1>
      ${errorBlock(profileError)}`;
  }
  if (!profile) {
    return `
      <a href="#/members" class="back-link">← All members</a>
      <h1>Member profile</h1>
      <p class="muted">This member is not available in this group.</p>`;
  }

  const assignments = profile.assignments ?? { total: 0, done: 0, active: 0, tasks: [], byStatus: {} };
  const contribution = profile.contribution ?? { total: 0, byAction: {}, actionLabels: {} };
  const labels = contribution.actionLabels ?? {};
  const breakdown = Object.entries(contribution.byAction ?? {})
    .filter(([, count]) => count > 0)
    .map(([action, count]) => `${labels[action] ?? action}: ${count}`);
  const assignedTasks = assignments.tasks ?? [];

  return `
    <a href="#/members" class="back-link">← All members</a>
    <div class="profile-head">
      <span class="avatar large" aria-hidden="true">${initials(profile.name)}</span>
      <div>
        <h1>${esc(profile.name)}</h1>
        <p class="muted">${esc(profile.roleLabel)}</p>
        <p class="muted">${esc(profile.email)}</p>
        <p class="muted">${esc(formatLastActive(profile.lastActiveAt))}</p>
      </div>
    </div>
    <section class="card">
      <h2>Assigned tasks</h2>
      <p class="muted">${esc(assignments.note ?? "Assigned-task counts show current board ownership, not contribution.")}</p>
      <p><strong>${assignments.total}</strong> assigned · ${assignments.done} done · ${assignments.active} active</p>
      ${assignedTasks.length
        ? `<ul class="deadline-list">${assignedTasks.map((t) => `
            <li>
              <span>${esc(t.title)}</span>
              <span class="pill pill-${esc(t.status)}">${esc(STATUS_LABELS[t.status] ?? t.status)}</span>
            </li>`).join("")}</ul>`
        : `<p class="muted">No tasks currently assigned to this member.</p>`}
    </section>
    <section class="card">
      <h2>Contribution summary</h2>
      <p class="muted">${esc(contribution.note ?? "Totals count recorded GroupFlow actions, not effort or quality.")}</p>
      <p class="muted small">${esc(contribution.trackedSinceNote ?? "Activity tracking began with this feature. Older actions were not backfilled.")}</p>
      <p><strong>${contribution.total}</strong> recorded action${contribution.total === 1 ? "" : "s"}</p>
      ${breakdown.length
        ? `<ul class="deadline-list">${breakdown.map((line) => `<li><span>${esc(line)}</span></li>`).join("")}</ul>`
        : `<p class="muted">No recorded actions for this member yet.</p>`}
    </section>
    <section class="card">
      <h2>Recent activity</h2>
      ${activityList(profile.recentActivity ?? [], { empty: "No recorded activity for this member yet." })}
    </section>`;
}

/** Legacy localStorage demo members (unused while a MongoDB group is active). */
export function membersView(state, selectedId) {
  const member = state.members.find((m) => m.id === selectedId);
  if (!member) {
    return `
      <h1>Members</h1>
      <p class="muted">Local prototype roster (not a MongoDB group)</p>
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

/** mode: "login" | "register" */
export function authView(mode = "login", { error = "", fields = {}, values = {} } = {}) {
  const isRegister = mode === "register";
  const title = isRegister ? "Create your account" : "Sign in to GroupFlow";
  const subtitle = isRegister
    ? "Register with your name, email, and password."
    : "Use your GroupFlow email and password.";
  const field = (name) => esc(fields[name] ?? "");
  const value = (name) => esc(values[name] ?? "");

  return `
    <div class="auth-panel">
      <section class="card auth-card">
        <h1>${title}</h1>
        <p class="muted">${subtitle}</p>
        <p class="form-error" id="auth-form-error" role="alert">${esc(error)}</p>
        <form id="auth-form" data-mode="${isRegister ? "register" : "login"}" novalidate>
          ${isRegister ? `
            <label>Name
              <input name="name" autocomplete="name" maxlength="80" required value="${value("name")}"${fields.name ? ' aria-invalid="true"' : ""} />
            </label>
            <p class="field-error" data-error="name">${field("name")}</p>
          ` : ""}
          <label>Email
            <input name="email" type="email" autocomplete="email" maxlength="254" required value="${value("email")}"${fields.email ? ' aria-invalid="true"' : ""} />
          </label>
          <p class="field-error" data-error="email">${field("email")}</p>
          <label>Password
            <input name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" required${fields.password ? ' aria-invalid="true"' : ""} />
          </label>
          <p class="field-error" data-error="password">${field("password")}</p>
          <div class="auth-actions">
            <button type="submit" class="btn-primary">${isRegister ? "Create account" : "Sign in"}</button>
          </div>
        </form>
        <p class="auth-switch muted">
          ${isRegister
            ? `Already have an account? <a href="#/login">Sign in</a>`
            : `New here? <a href="#/register">Create an account</a>`}
        </p>
      </section>
    </div>`;
}

export function groupsHomeView(groups, { error = "" } = {}) {
  return `
    <div class="page-head">
      <h1>Your groups</h1>
      <a class="btn-primary" href="#/groups/new">Create group</a>
    </div>
    <p class="muted">Choose a workspace, or join with an invitation code. New accounts are not added to the demo Group 6 roster.</p>
    <p class="form-error" role="alert">${esc(error)}</p>
    ${groups.length ? `
      <ul class="group-list">
        ${groups.map((g) => `
          <li class="card group-card">
            <div>
              <b>${esc(g.name)}</b>
              <p class="muted">${esc(g.roleLabel)}${g.description ? ` · ${esc(g.description)}` : ""}</p>
            </div>
            <button type="button" class="btn-primary" data-action="select-group" data-id="${esc(g.id)}">Open</button>
          </li>`).join("")}
      </ul>` : `
      <section class="card">
        <h2>No groups yet</h2>
        <p class="muted">Create a group to become its Team Coordinator, or join with an invite code from a classmate.</p>
      </section>`}
    <p class="auth-switch"><a href="#/join">Have an invitation code? Join a group</a></p>`;
}

export function createGroupView({ error = "", fields = {}, values = {} } = {}) {
  return `
    <div class="auth-panel">
      <section class="card auth-card">
        <h1>Create a group</h1>
        <p class="muted">You will be the Team Coordinator. No demo members or tasks are copied in.</p>
        <p class="form-error" role="alert">${esc(error)}</p>
        <form id="create-group-form" novalidate>
          <label>Group name
            <input name="name" maxlength="80" required value="${esc(values.name ?? "")}"${fields.name ? ' aria-invalid="true"' : ""} />
          </label>
          <p class="field-error" data-error="name">${esc(fields.name ?? "")}</p>
          <label>Description (optional)
            <textarea name="description" rows="3" maxlength="280">${esc(values.description ?? "")}</textarea>
          </label>
          <p class="field-error" data-error="description">${esc(fields.description ?? "")}</p>
          <div class="auth-actions">
            <button type="submit" class="btn-primary">Create group</button>
          </div>
        </form>
        <p class="auth-switch muted"><a href="#/groups">Back to groups</a></p>
      </section>
    </div>`;
}

export function joinGroupView({ error = "", fields = {}, values = {}, preview = null } = {}) {
  return `
    <div class="auth-panel">
      <section class="card auth-card">
        <h1>Join a group</h1>
        <p class="muted">Paste an invitation code from a Team Coordinator. Email delivery is not used.</p>
        <p class="form-error" role="alert">${esc(error)}</p>
        ${preview ? `<p class="notice"><strong>${esc(preview.group.name)}</strong>${preview.alreadyMember ? " — you are already a member." : ""}</p>` : ""}
        <form id="join-group-form" novalidate>
          <label>Invitation code
            <input name="code" autocomplete="off" spellcheck="false" required value="${esc(values.code ?? "")}"${fields.code ? ' aria-invalid="true"' : ""} />
          </label>
          <p class="field-error" data-error="code">${esc(fields.code ?? "")}</p>
          <div class="auth-actions">
            <button type="submit" class="btn-primary">Join group</button>
          </div>
        </form>
        <p class="auth-switch muted"><a href="#/groups">Back to groups</a></p>
      </section>
    </div>`;
}

export function inviteView({ group, invitation = null, error = "" } = {}) {
  const link = invitation
    ? `${location.origin}${location.pathname}#/join/${encodeURIComponent(invitation.code)}`
    : "";
  return `
    <div class="page-head">
      <h1>Invite members</h1>
      <a class="btn-secondary" href="#/dashboard">Back to dashboard</a>
    </div>
    <p class="muted">${esc(group.name)} · Team Coordinators can create a secure link or code. No email is sent.</p>
    <p class="form-error" role="alert">${esc(error)}</p>
    <section class="card">
      <button type="button" class="btn-primary" data-action="create-invite">Generate invitation</button>
      ${invitation ? `
        <div class="invite-result">
          <label>Invitation code
            <input id="invite-code" readonly value="${esc(invitation.code)}" />
          </label>
          <label>Shareable link
            <input id="invite-link" readonly value="${esc(link)}" />
          </label>
          <p class="muted">Expires ${esc(new Date(invitation.expiresAt).toLocaleString())}</p>
          <div class="dialog-actions">
            <button type="button" class="btn-secondary" data-action="copy-invite">Copy link</button>
            <button type="button" class="btn-danger" data-action="revoke-invite" data-id="${esc(invitation.id)}">Revoke invitation</button>
          </div>
        </div>` : `<p class="muted">Generate a code, then share it out of band (chat, text, etc.).</p>`}
    </section>`;
}
