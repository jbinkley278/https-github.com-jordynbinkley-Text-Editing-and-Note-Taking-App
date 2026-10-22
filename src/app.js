import {
  createGroup as createGroupRequest,
  createInvitation,
  createTask as createTaskRequest,
  deleteTask as deleteTaskRequest,
  fetchActivitySummary,
  fetchCurrentUser,
  fetchGroup,
  fetchGroupMembers,
  fetchMemberProfile,
  fetchUnreadCount,
  joinGroup,
  createEvent as createEventRequest,
  deleteEvent as deleteEventRequest,
  listActivity,
  listEvents,
  listGroups,
  listMessages,
  listTasks,
  loginUser,
  logoutUser,
  markMessagesRead as markMessagesReadRequest,
  previewInvitation,
  registerUser,
  revokeInvitation,
  sendMessage,
  updateEvent as updateEventRequest,
  updateTask as updateTaskRequest,
} from "./api.js";
import {
  ACTIVE_GROUP_KEY,
  emptyWorkspaceState, toDateKey, validateTask,
} from "./store.js";
import {
  authView, boardView, calendarView, chatView, createGroupView, dashboardView, groupMembersView,
  groupsHomeView, initials, inviteView, joinGroupView, notFoundView, progressView,
} from "./views.js";
import { populateAssigneeSelect } from "./assigneeSelect.js";
import {
  chatObserverRoot,
  contiguousVisibleUpToId,
  initialScrollMessageId,
  isNearBottom,
} from "./chatReadPolicy.js";

/** Poll interval while Group Chat is open (simple HTTP refresh; expected delay up to this). */
const CHAT_POLL_MS = 3000;
/** Same modest interval for dashboard/sidebar unread counts. */
const UNREAD_POLL_MS = CHAT_POLL_MS;
/** Debounce viewport → read-cursor POSTs while scrolling. */
const MARK_READ_DEBOUNCE_MS = 120;

const main = document.querySelector("#main");
const taskDialog = document.querySelector("#task-dialog");
const taskForm = document.querySelector("#task-form");
const eventDialog = document.querySelector("#event-dialog");
const eventForm = document.querySelector("#event-form");
const toast = document.querySelector("#toast");
const logoutButton = document.querySelector("#logout-btn");
const userNameEl = document.querySelector("#user-name");
const avatar = document.querySelector("#current-user");
const groupNameEl = document.querySelector("#group-name");

/** @type {{ id: string, name: string, email: string } | null} */
let sessionUser = null;
/** @type {{ id: string, name: string, description?: string, role: string, roleLabel: string } | null} */
let activeGroup = null;
/** @type {Array<{ id: string, name: string, email: string, role: string, roleLabel: string }>} */
let groupMembers = [];
/** @type {ReturnType<typeof emptyWorkspaceState> | null} */
let state = null;
/** @type {{ id: string, code: string, expiresAt: string } | null} */
let latestInvite = null;
let tasksLoading = false;
let tasksError = "";
let chatLoading = false;
let chatError = "";
let chatSendError = "";
let chatSending = false;
let chatDraft = "";
/** @type {ReturnType<typeof setInterval> | null} */
let chatPollTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let unreadPollTimer = null;
/** @type {number | null} */
let unreadCount = null;
let unreadLoading = false;
let unreadError = "";
/** Server-backed per-user/per-group read cursor id (from unread/read APIs). */
let lastReadMessageId = null;
/** @type {IntersectionObserver | null} */
let chatReadObserver = null;
/** Message ids currently intersecting the chat viewport. */
let visibleMessageIds = new Set();
/** @type {ReturnType<typeof setTimeout> | null} */
let markReadTimer = null;
/** After sending, pin the transcript to the bottom on the next chat paint. */
let chatForceScrollBottom = false;
let eventsLoading = false;
let eventsError = "";
/** @type {Array<object>} */
let activityFeed = [];
/** @type {object | null} */
let activitySummary = null;
let activityLoading = false;
let activityError = "";
/** @type {object | null} */
let memberProfile = null;
let profileLoading = false;
let profileError = "";
/** @type {string | null} */
let loadedProfileId = null;
let membersLoading = false;
let membersError = "";
let selectedDate = toDateKey(new Date());
let editingEventId = null;
/** @type {Array<{ id?: string, title: string, done: boolean }>} */
let draftSubtasks = [];

let editingId = null;
let boardFilter = "all";
const now = new Date();
let calMonth = { year: now.getFullYear(), month: now.getMonth() };
let groupsCache = [];

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function today() { return toDateKey(new Date()); }

function syncMembersIntoState() {
  if (!state) return;
  state.members = groupMembers.map((m) => ({
    id: m.id,
    name: m.name,
    role: m.roleLabel,
  }));
}

let toastTimer;
function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}

function currentRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  const [page = "dashboard", param, extra] = parts;
  return { page, param, extra };
}

function isAuthRoute(page) {
  return page === "login" || page === "register";
}

function stopChatPolling() {
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
}

function stopUnreadPolling() {
  if (unreadPollTimer) {
    clearInterval(unreadPollTimer);
    unreadPollTimer = null;
  }
}

function stopChatReadObserver() {
  if (markReadTimer) {
    clearTimeout(markReadTimer);
    markReadTimer = null;
  }
  if (chatReadObserver) {
    chatReadObserver.disconnect();
    chatReadObserver = null;
  }
  visibleMessageIds = new Set();
}

function clearGroupState() {
  stopChatPolling();
  stopUnreadPolling();
  stopChatReadObserver();
  activeGroup = null;
  groupMembers = [];
  state = null;
  latestInvite = null;
  tasksLoading = false;
  tasksError = "";
  chatLoading = false;
  chatError = "";
  chatSendError = "";
  chatSending = false;
  chatDraft = "";
  chatForceScrollBottom = false;
  unreadCount = null;
  unreadLoading = false;
  unreadError = "";
  lastReadMessageId = null;
  eventsLoading = false;
  eventsError = "";
  activityFeed = [];
  activitySummary = null;
  activityLoading = false;
  activityError = "";
  memberProfile = null;
  profileLoading = false;
  profileError = "";
  loadedProfileId = null;
  membersLoading = false;
  membersError = "";
  selectedDate = toDateKey(new Date());
  editingEventId = null;
  draftSubtasks = [];
  boardFilter = "all";
  editingId = null;
  sessionStorage.removeItem(ACTIVE_GROUP_KEY);
  groupNameEl.textContent = "";
  updateChatBadge();
}

function applyWorkspaceState() {
  if (!activeGroup || !sessionUser) {
    state = null;
    return;
  }
  state = emptyWorkspaceState(activeGroup, sessionUser.id);
  syncMembersIntoState();
}

async function loadTasks({ quiet = false } = {}) {
  if (!activeGroup || !state) return { ok: false };
  if (!quiet) {
    tasksLoading = true;
    tasksError = "";
  }
  const result = await listTasks(activeGroup.id);
  tasksLoading = false;
  if (!result.ok) {
    tasksError = result.data.error ?? "Could not load tasks.";
    state.tasks = [];
    return result;
  }
  tasksError = "";
  state.tasks = result.data.tasks ?? [];
  syncMembersIntoState();
  return result;
}

async function loadActivity({ quiet = false } = {}) {
  if (!activeGroup || !state) return { ok: false };
  if (!quiet) {
    activityLoading = true;
    activityError = "";
  }
  const [feedResult, summaryResult] = await Promise.all([
    listActivity(activeGroup.id, { limit: 50 }),
    fetchActivitySummary(activeGroup.id),
  ]);
  if (!quiet) activityLoading = false;
  if (!feedResult.ok || !summaryResult.ok) {
    activityError = feedResult.data.error ?? summaryResult.data.error ?? "Could not load activity.";
    activityFeed = [];
    activitySummary = null;
    if (state) state.activity = [];
    return { ok: false, feedResult, summaryResult };
  }
  activityError = "";
  activityFeed = feedResult.data.activity ?? [];
  activitySummary = summaryResult.data.summary ?? null;
  if (state) state.activity = activityFeed;
  return { ok: true, feedResult, summaryResult };
}

async function loadMemberProfile(memberId) {
  if (!activeGroup || !memberId) {
    memberProfile = null;
    profileError = "";
    profileLoading = false;
    loadedProfileId = null;
    return { ok: false };
  }
  profileLoading = true;
  profileError = "";
  memberProfile = null;
  const result = await fetchMemberProfile(activeGroup.id, memberId);
  profileLoading = false;
  if (!result.ok) {
    profileError = result.data.error ?? "Could not load member profile.";
    memberProfile = null;
    loadedProfileId = null;
    return result;
  }
  profileError = "";
  memberProfile = result.data.profile ?? null;
  loadedProfileId = memberId;
  return result;
}

function messagesSignature(messages) {
  return (messages ?? []).map((m) => m.id).join(",");
}

function applyMessagesFromServer(messages) {
  // Replace from server (source of truth) to avoid duplicates across refresh/poll cycles.
  const byId = new Map();
  for (const message of messages ?? []) {
    if (message?.id) byId.set(message.id, message);
  }
  state.messages = [...byId.values()].sort((a, b) => {
    const byTime = String(a.createdAt).localeCompare(String(b.createdAt));
    return byTime !== 0 ? byTime : String(a.id).localeCompare(String(b.id));
  });
}

function chatIsVisible() {
  return currentRoute().page === "chat"
    && document.visibilityState === "visible"
    && Boolean(activeGroup);
}

async function loadUnread({ quiet = false } = {}) {
  if (!activeGroup) return { ok: false };
  if (!quiet) {
    unreadLoading = true;
    unreadError = "";
  }
  const result = await fetchUnreadCount(activeGroup.id);
  if (!quiet) unreadLoading = false;
  if (!result.ok) {
    unreadError = result.data.error ?? "Could not load unread messages.";
    unreadCount = null;
    updateChatBadge();
    if (currentRoute().page === "dashboard") renderApp({ focus: false });
    return result;
  }
  unreadError = "";
  unreadCount = Number(result.data.unreadCount) || 0;
  lastReadMessageId = result.data.lastReadMessageId ?? null;
  updateChatBadge();
  if (currentRoute().page === "dashboard") renderApp({ focus: false });
  return result;
}

/**
 * Advance the MongoDB read cursor only through a contiguous visible prefix
 * starting at the first unread message (never skip off-screen history).
 */
async function markVisibleMessagesRead() {
  if (!activeGroup || !state?.messages?.length || !chatIsVisible()) return { ok: false };
  const upToMessageId = contiguousVisibleUpToId(
    state.messages,
    lastReadMessageId,
    visibleMessageIds,
  );
  if (!upToMessageId || upToMessageId === lastReadMessageId) return { ok: false };
  const result = await markMessagesReadRequest(activeGroup.id, upToMessageId);
  if (!result.ok) {
    unreadError = result.data.error ?? "Could not update read position.";
    updateChatBadge();
    return result;
  }
  unreadError = "";
  unreadCount = Number(result.data.unreadCount) || 0;
  lastReadMessageId = result.data.lastReadMessageId ?? upToMessageId;
  updateChatBadge();
  if (currentRoute().page === "dashboard") renderApp({ focus: false });
  return result;
}

function scheduleMarkVisibleRead() {
  if (markReadTimer) clearTimeout(markReadTimer);
  markReadTimer = setTimeout(() => {
    markReadTimer = null;
    markVisibleMessagesRead().catch(() => {});
  }, MARK_READ_DEBOUNCE_MS);
}

function startChatReadObserver() {
  stopChatReadObserver();
  if (!chatIsVisible()) return;
  const list = document.querySelector("#messages");
  if (!list) return;

  const root = chatObserverRoot(list);
  chatReadObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const id = entry.target.getAttribute("data-message-id");
      if (!id) continue;
      if (entry.isIntersecting) visibleMessageIds.add(id);
      else visibleMessageIds.delete(id);
    }
    scheduleMarkVisibleRead();
  }, { root, threshold: 0.5 });

  list.querySelectorAll("[data-message-id]").forEach((el) => {
    chatReadObserver.observe(el);
  });
}

function updateChatBadge() {
  const badge = document.querySelector("#chat-badge");
  if (!badge) return;
  if (unreadError) {
    badge.hidden = false;
    badge.textContent = "!";
    badge.setAttribute("aria-label", "Unread count unavailable");
    return;
  }
  if (unreadCount != null && unreadCount > 0) {
    badge.hidden = false;
    badge.textContent = String(unreadCount);
    badge.setAttribute("aria-label", `${unreadCount} unread messages`);
    return;
  }
  badge.hidden = true;
  badge.textContent = "";
  badge.removeAttribute("aria-label");
}

async function loadMessages({ quiet = false } = {}) {
  if (!activeGroup || !state) return { ok: false };
  if (!quiet) {
    chatLoading = true;
    chatError = "";
  }
  const result = await listMessages(activeGroup.id);
  if (!quiet) chatLoading = false;
  if (!result.ok) {
    if (!quiet) {
      chatError = result.data.error ?? "Could not load messages.";
      state.messages = [];
    }
    return result;
  }
  chatError = "";
  const previous = messagesSignature(state.messages);
  const displayed = result.data.messages ?? [];
  applyMessagesFromServer(displayed);
  const next = messagesSignature(state.messages);
  if (quiet && currentRoute().page === "chat" && previous !== next) {
    const input = document.querySelector("#chat-input");
    chatDraft = input && !chatSending ? input.value : chatDraft;
    renderApp({ focus: false });
    if (document.querySelector("#chat-input")) {
      document.querySelector("#chat-input").value = chatDraft;
      document.querySelector("#chat-input").focus();
      const end = chatDraft.length;
      document.querySelector("#chat-input").setSelectionRange?.(end, end);
    }
  }
  return result;
}

function startChatPolling() {
  stopChatPolling();
  chatPollTimer = setInterval(() => {
    if (currentRoute().page !== "chat" || !activeGroup) {
      stopChatPolling();
      return;
    }
    loadMessages({ quiet: true }).catch(() => {});
  }, CHAT_POLL_MS);
}

function startUnreadPolling() {
  stopUnreadPolling();
  if (!activeGroup) return;
  unreadPollTimer = setInterval(() => {
    if (!activeGroup || !sessionUser) {
      stopUnreadPolling();
      return;
    }
    // Chat view refreshes unread via mark-after-display; still poll when not in chat.
    if (currentRoute().page === "chat" && document.visibilityState === "visible") return;
    loadUnread({ quiet: true }).catch(() => {});
  }, UNREAD_POLL_MS);
}

async function loadEvents({ quiet = false } = {}) {
  if (!activeGroup || !state) return { ok: false };
  if (!quiet) {
    eventsLoading = true;
    eventsError = "";
  }
  const result = await listEvents(activeGroup.id);
  eventsLoading = false;
  if (!result.ok) {
    eventsError = result.data.error ?? "Could not load meetings.";
    state.events = [];
    return result;
  }
  eventsError = "";
  state.events = result.data.events ?? [];
  return result;
}

async function loadCalendarData() {
  await Promise.all([loadTasks({ quiet: true }), loadEvents()]);
}

function setChromeForAuth(user) {
  sessionUser = user;
  document.body.classList.toggle("signed-out", !user);
  document.body.classList.toggle("signed-in", Boolean(user));
  document.body.classList.toggle("no-group", Boolean(user) && !activeGroup);
  if (user) {
    userNameEl.textContent = user.name;
    userNameEl.hidden = false;
    avatar.textContent = initials(user.name);
    avatar.href = "#/members";
    avatar.setAttribute("aria-label", `Your profile (${user.name})`);
    avatar.hidden = false;
    logoutButton.hidden = false;
    groupNameEl.textContent = activeGroup?.name ?? "";
  } else {
    userNameEl.textContent = "";
    userNameEl.hidden = true;
    avatar.hidden = true;
    logoutButton.hidden = true;
    clearGroupState();
  }
}

function updateGroupChrome() {
  document.body.classList.toggle("no-group", Boolean(sessionUser) && !activeGroup);
  groupNameEl.textContent = activeGroup?.name ?? "";
  if (activeGroup) {
    groupNameEl.title = "Switch group";
    groupNameEl.setAttribute("role", "link");
    groupNameEl.tabIndex = 0;
  } else {
    groupNameEl.removeAttribute("role");
    groupNameEl.removeAttribute("tabindex");
    groupNameEl.title = "";
  }
}

async function refreshGroups() {
  const result = await listGroups();
  if (!result.ok) {
    groupsCache = [];
    return result;
  }
  groupsCache = result.data.groups ?? [];
  return result;
}

async function selectGroup(groupId, { navigate = true } = {}) {
  const detail = await fetchGroup(groupId);
  if (!detail.ok) {
    sessionStorage.removeItem(ACTIVE_GROUP_KEY);
    activeGroup = null;
    applyWorkspaceState();
    updateGroupChrome();
    return detail;
  }
  stopChatPolling();
  stopUnreadPolling();
  stopChatReadObserver();
  activeGroup = detail.data.group;
  sessionStorage.setItem(ACTIVE_GROUP_KEY, activeGroup.id);
  latestInvite = null;
  boardFilter = "all";
  tasksError = "";
  chatError = "";
  chatDraft = "";
  chatForceScrollBottom = false;
  unreadCount = null;
  unreadError = "";
  unreadLoading = false;
  lastReadMessageId = null;
  eventsError = "";
  activityError = "";
  activityFeed = [];
  activitySummary = null;
  memberProfile = null;
  profileError = "";
  profileLoading = false;
  loadedProfileId = null;
  membersError = "";
  editingEventId = null;
  selectedDate = today();
  applyWorkspaceState();
  updateChatBadge();
  membersLoading = true;
  const membersResult = await fetchGroupMembers(activeGroup.id);
  membersLoading = false;
  if (!membersResult.ok) {
    membersError = membersResult.data.error ?? "Could not load members.";
    groupMembers = [];
  } else {
    membersError = "";
    groupMembers = membersResult.data.members ?? [];
  }
  syncMembersIntoState();
  updateGroupChrome();
  await Promise.all([
    loadTasks(),
    loadMessages(),
    loadEvents(),
    loadActivity(),
    loadUnread(),
  ]);
  startUnreadPolling();
  if (navigate) {
    location.hash = "#/dashboard";
  }
  return detail;
}

async function restoreActiveGroup() {
  const saved = sessionStorage.getItem(ACTIVE_GROUP_KEY);
  if (!saved) return;
  const result = await selectGroup(saved, { navigate: false });
  if (!result.ok) clearGroupState();
}

function renderAuth(mode, extras = {}) {
  main.innerHTML = authView(mode, extras);
  document.title = `${mode === "register" ? "Register" : "Sign in"} · GroupFlow`;
  main.focus({ preventScroll: true });
  document.querySelector("#auth-form")?.elements?.[mode === "register" ? "name" : "email"]?.focus();
}

async function renderGroupsHome({ error = "" } = {}) {
  const listed = await refreshGroups();
  if (!listed.ok && !error) {
    error = listed.data.error ?? "Could not load groups.";
  }
  main.innerHTML = groupsHomeView(groupsCache, { error });
  document.title = "Your groups · GroupFlow";
  main.focus({ preventScroll: true });
}

function renderCreateGroup(extras = {}) {
  main.innerHTML = createGroupView(extras);
  document.title = "Create group · GroupFlow";
  main.focus({ preventScroll: true });
  document.querySelector("#create-group-form")?.elements?.name?.focus();
}

async function renderJoin(code = "", extras = {}) {
  let preview = extras.preview ?? null;
  let error = extras.error ?? "";
  if (code && !preview && !error) {
    const result = await previewInvitation(code);
    if (result.ok) preview = result.data;
    else error = result.data.error ?? "Invitation is not valid.";
  }
  main.innerHTML = joinGroupView({
    error,
    fields: extras.fields ?? {},
    values: { code, ...(extras.values ?? {}) },
    preview,
  });
  document.title = "Join group · GroupFlow";
  main.focus({ preventScroll: true });
}

function renderInvite(extras = {}) {
  main.innerHTML = inviteView({
    group: activeGroup,
    invitation: latestInvite,
    error: extras.error ?? "",
  });
  document.title = "Invite · GroupFlow";
  main.focus({ preventScroll: true });
}

function renderApp({ focus = false } = {}) {
  if (!activeGroup || !state) return;
  const { page, param } = currentRoute();
  const isCoordinator = activeGroup.role === "coordinator";

  if (page !== "chat") {
    stopChatPolling();
    stopChatReadObserver();
  }

  const priorMessages = page === "chat" ? document.querySelector("#messages") : null;
  const priorScroll = priorMessages
    ? {
      stickToBottom: chatForceScrollBottom || isNearBottom(priorMessages),
      scrollTop: priorMessages.scrollTop,
    }
    : null;

  const views = {
    dashboard: () => dashboardView(state, today(), sessionUser, {
      memberCount: groupMembers.length,
      isCoordinator,
      tasksLoading,
      tasksError,
      activity: activityFeed,
      activityLoading,
      activityError,
      unreadCount,
      unreadLoading,
      unreadError,
    }),
    tasks: () => boardView(state, today(), boardFilter, { loading: tasksLoading, error: tasksError }),
    calendar: () => calendarView(state, today(), calMonth.year, calMonth.month, {
      selectedDate,
      loading: eventsLoading || tasksLoading,
      error: eventsError || (tasksError && currentRoute().page === "calendar" ? tasksError : ""),
    }),
    chat: () => chatView(state, {
      loading: chatLoading,
      error: chatError,
      sendError: chatSendError,
      sending: chatSending,
      draft: chatDraft,
      sessionUserId: sessionUser?.id ?? "",
    }),
    progress: () => progressView(state, {
      summary: activitySummary,
      activityLoading,
      activityError,
      tasksLoading,
      tasksError,
    }),
    members: () => groupMembersView(groupMembers, param, {
      groupName: activeGroup.name,
      isCoordinator,
      profile: memberProfile,
      profileLoading,
      profileError,
      membersLoading,
      membersError,
    }),
    invite: () => inviteView({ group: activeGroup, invitation: latestInvite }),
  };

  main.innerHTML = (views[page] ?? notFoundView)();

  document.querySelectorAll("[data-route]").forEach((link) => {
    if (link.dataset.route === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
    if (link.dataset.route === "invite") {
      link.hidden = !isCoordinator;
    }
  });

  updateChatBadge();

  if (page === "chat") {
    const list = document.querySelector("#messages");
    if (list) {
      if (priorScroll) {
        if (priorScroll.stickToBottom) list.scrollTo(0, list.scrollHeight || 99999);
        else list.scrollTop = priorScroll.scrollTop;
      } else {
        const entryId = initialScrollMessageId(state.messages, lastReadMessageId);
        if (entryId) {
          const target = list.querySelector(`[data-message-id="${CSS.escape(entryId)}"]`);
          if (target) target.scrollIntoView({ block: "start", inline: "nearest" });
          else list.scrollTo(0, 0);
        } else {
          list.scrollTo(0, list.scrollHeight || 99999);
        }
      }
    }
    chatForceScrollBottom = false;
    startChatPolling();
    startChatReadObserver();
    const input = document.querySelector("#chat-input");
    if (input && !chatLoading && !chatSending) {
      input.focus();
      const end = input.value.length;
      input.setSelectionRange?.(end, end);
    }
  }
  if (focus) {
    const heading = page === "dashboard" ? "Dashboard" : main.querySelector("h1")?.textContent;
    document.title = `${heading ?? "GroupFlow"} · GroupFlow`;
    main.focus({ preventScroll: true });
    // Keep Chat's first-unread / preserved scroller position; do not jump the window.
    if (page !== "chat") window.scrollTo(0, 0);
  }
}

async function render({ focus = false } = {}) {
  const { page, param } = currentRoute();

  if (!sessionUser) {
    const mode = page === "register" ? "register" : "login";
    if (!isAuthRoute(page)) history.replaceState(null, "", "#/login");
    renderAuth(mode);
    return;
  }

  if (isAuthRoute(page)) {
    history.replaceState(null, "", activeGroup ? "#/dashboard" : "#/groups");
  }

  const route = currentRoute();

  if (!activeGroup) {
    if (route.page === "groups" && route.param === "new") {
      renderCreateGroup();
      return;
    }
    if (route.page === "join") {
      await renderJoin(route.param ?? "");
      return;
    }
    if (route.page !== "groups") {
      history.replaceState(null, "", "#/groups");
    }
    await renderGroupsHome();
    return;
  }

  if (route.page === "groups" && route.param === "new") {
    renderCreateGroup();
    return;
  }
  if (route.page === "groups") {
    await renderGroupsHome();
    return;
  }
  if (route.page === "join") {
    await renderJoin(route.param ?? "");
    return;
  }
  if (route.page === "invite") {
    if (activeGroup.role !== "coordinator") {
      showToast("Only the Team Coordinator can invite members");
      history.replaceState(null, "", "#/dashboard");
      renderApp({ focus: true });
      return;
    }
    renderInvite();
    return;
  }

  if (route.page === "members" && route.param) {
    if (loadedProfileId !== route.param) {
      profileLoading = true;
      profileError = "";
      memberProfile = null;
      renderApp({ focus });
      await loadMemberProfile(route.param);
      const still = currentRoute();
      if (still.page === "members" && still.param === route.param) {
        renderApp({ focus: false });
      }
      return;
    }
  } else if (loadedProfileId || memberProfile || profileLoading || profileError) {
    memberProfile = null;
    profileError = "";
    profileLoading = false;
    loadedProfileId = null;
  }

  renderApp({ focus });
}

async function handleAuthSubmit(form) {
  const mode = form.dataset.mode;
  const values = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = mode === "register"
      ? await registerUser({ name: values.name, email: values.email, password: values.password })
      : await loginUser({ email: values.email, password: values.password });

    if (!result.ok) {
      renderAuth(mode, {
        error: result.data.error ?? "Something went wrong. Try again.",
        fields: result.data.fields ?? {},
        values: { name: values.name, email: values.email },
      });
      return;
    }

    setChromeForAuth(result.data.user);
    clearGroupState();
    await refreshGroups();
    await restoreActiveGroup();
    showToast(mode === "register" ? "Account created" : "Signed in");
    location.hash = activeGroup ? "#/dashboard" : "#/groups";
    await render({ focus: true });
  } catch {
    renderAuth(mode, {
      error: "Could not reach the server. Is GroupFlow running?",
      values: { name: values.name, email: values.email },
    });
  } finally {
    const liveSubmit = document.querySelector("#auth-form [type='submit']");
    if (liveSubmit) liveSubmit.disabled = false;
  }
}

async function handleCreateGroup(form) {
  const values = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await createGroupRequest({
      name: values.name,
      description: values.description,
    });
    if (!result.ok) {
      renderCreateGroup({
        error: result.data.error ?? "Could not create group.",
        fields: result.data.fields ?? {},
        values,
      });
      return;
    }
    await selectGroup(result.data.group.id);
    showToast("Group created — you are the Team Coordinator");
    await render({ focus: true });
  } finally {
    const live = document.querySelector("#create-group-form [type='submit']");
    if (live) live.disabled = false;
  }
}

async function handleJoinGroup(form) {
  const values = Object.fromEntries(new FormData(form));
  const code = String(values.code ?? "").trim();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await joinGroup(code);
    if (!result.ok) {
      await renderJoin(code, {
        error: result.data.error ?? "Could not join group.",
        fields: result.data.fields ?? {},
      });
      return;
    }
    await selectGroup(result.data.group.id);
    showToast(`Joined ${result.data.group.name}`);
    await render({ focus: true });
  } finally {
    const live = document.querySelector("#join-group-form [type='submit']");
    if (live) live.disabled = false;
  }
}

// ---- task dialog ----

function fillAssignees(selected) {
  const select = document.querySelector("#assignee-select");
  populateAssigneeSelect(select, groupMembers, selected);
}

function clearErrors(form) {
  form.querySelectorAll(".field-error").forEach((el) => { el.textContent = ""; });
  form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  const formError = form.querySelector("#task-form-error");
  if (formError) formError.textContent = "";
}

function escAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function renderSubtaskEditor() {
  const list = document.querySelector("#subtask-list");
  if (!list) return;
  list.innerHTML = draftSubtasks.map((sub, index) => `
    <div class="subtask-row" data-subtask-index="${index}">
      <input type="checkbox" data-sub-done ${sub.done ? "checked" : ""} aria-label="Subtask complete" />
      <input type="text" data-sub-title maxlength="120" value="${escAttr(sub.title)}" placeholder="Subtask title" />
      <button type="button" class="btn-danger" data-action="remove-subtask" data-index="${index}">Remove</button>
    </div>`).join("") || `<p class="muted">No subtasks yet.</p>`;
}

function readSubtasksFromEditor() {
  const rows = [...document.querySelectorAll("#subtask-list .subtask-row")];
  return rows.map((row, index) => ({
    id: draftSubtasks[index]?.id,
    title: row.querySelector("[data-sub-title]")?.value ?? "",
    done: Boolean(row.querySelector("[data-sub-done]")?.checked),
  })).filter((s) => s.title.trim());
}

function openTaskDialog(id = null) {
  if (!state || tasksError) {
    showToast(tasksError || "Tasks are unavailable right now");
    return;
  }
  editingId = id;
  const task = state.tasks.find((t) => t.id === id);
  clearErrors(taskForm);
  taskForm.reset();
  fillAssignees(task ? task.assignee : sessionUser?.id);
  document.querySelector("#task-dialog-title").textContent = task ? "Task detail" : "New task";
  document.querySelector("#delete-task").hidden = !task;
  draftSubtasks = task?.subtasks ? task.subtasks.map((s) => ({ ...s })) : [];
  if (task) {
    for (const field of ["title", "description", "dueDate", "status", "priority"]) {
      taskForm.elements[field].value = task[field];
    }
  } else {
    taskForm.elements.dueDate.value = today();
    taskForm.elements.priority.value = "medium";
    taskForm.elements.status.value = "todo";
  }
  renderSubtaskEditor();
  taskDialog.showModal();
  taskForm.elements.title.focus();
}

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state || !activeGroup) return;
  const fields = Object.fromEntries(new FormData(taskForm));
  fields.subtasks = readSubtasksFromEditor();
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
  fields.assignee = fields.assignee || null;
  const submit = taskForm.querySelector('[type="submit"]');
  submit.disabled = true;
  const payload = {
    title: fields.title,
    description: fields.description,
    assignee: fields.assignee,
    dueDate: fields.dueDate,
    status: fields.status,
    priority: fields.priority,
    subtasks: fields.subtasks,
  };
  try {
    const result = editingId
      ? await updateTaskRequest(activeGroup.id, editingId, payload)
      : await createTaskRequest(activeGroup.id, payload);
    if (!result.ok) {
      const formError = document.querySelector("#task-form-error");
      if (formError) formError.textContent = result.data.error ?? "Could not save task.";
      for (const [name, text] of Object.entries(result.data.fields ?? {})) {
        const slot = taskForm.querySelector(`[data-error="${name}"]`);
        if (slot) slot.textContent = text;
        taskForm.elements[name]?.setAttribute("aria-invalid", "true");
      }
      return;
    }
    const saved = result.data.task;
    if (editingId) {
      state.tasks = state.tasks.map((t) => (t.id === saved.id ? saved : t));
    } else {
      state.tasks = [...state.tasks, saved];
    }
    taskDialog.close();
    showToast(editingId ? "Task updated" : "Task created");
    await loadActivity({ quiet: true });
    render();
  } catch {
    const formError = document.querySelector("#task-form-error");
    if (formError) formError.textContent = "Could not reach the server. Task was not saved.";
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#delete-task").addEventListener("click", async () => {
  if (!state || !activeGroup || !editingId) return;
  const task = state.tasks.find((t) => t.id === editingId);
  if (!task || !confirm(`Delete “${task.title}”? This can't be undone.`)) return;
  const result = await deleteTaskRequest(activeGroup.id, editingId);
  if (!result.ok) {
    showToast(result.data.error ?? "Could not delete task");
    return;
  }
  state.tasks = state.tasks.filter((t) => t.id !== editingId);
  taskDialog.close();
  showToast("Task deleted");
  await loadActivity({ quiet: true });
  render();
});

document.querySelector("#add-subtask").addEventListener("click", () => {
  draftSubtasks = readSubtasksFromEditor();
  draftSubtasks.push({ title: "", done: false });
  renderSubtaskEditor();
  document.querySelector("#subtask-list [data-sub-title]:last-of-type")?.focus();
});

document.querySelector("#subtask-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='remove-subtask']");
  if (!button) return;
  draftSubtasks = readSubtasksFromEditor();
  draftSubtasks.splice(Number(button.dataset.index), 1);
  renderSubtaskEditor();
});

function clearEventFormErrors() {
  eventForm.querySelectorAll(".field-error").forEach((el) => { el.textContent = ""; });
  eventForm.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  const formError = document.querySelector("#event-form-error");
  if (formError) formError.textContent = "";
}

function openEventDialog(id = null) {
  if (!activeGroup || eventsError) {
    showToast(eventsError || "Meetings are unavailable right now");
    return;
  }
  editingEventId = id;
  const existing = state?.events.find((e) => e.id === id);
  clearEventFormErrors();
  eventForm.reset();
  document.querySelector("#event-dialog-title").textContent = existing ? "Edit meeting" : "Add meeting";
  document.querySelector("#delete-event").hidden = !existing;
  eventForm.elements.title.value = existing?.title ?? "";
  eventForm.elements.date.value = existing?.date ?? selectedDate ?? today();
  eventForm.elements.startTime.value = existing?.startTime ?? "";
  eventForm.elements.timeZone.value = existing?.timeZone ?? browserTimeZone();
  eventForm.elements.description.value = existing?.description ?? "";
  eventDialog.showModal();
  eventForm.elements.title.focus();
}

eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state || !activeGroup) return;
  const fields = Object.fromEntries(new FormData(eventForm));
  clearEventFormErrors();
  const payload = {
    title: fields.title,
    date: fields.date,
    startTime: fields.startTime || null,
    timeZone: fields.timeZone || browserTimeZone(),
    description: fields.description,
  };
  const submit = eventForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = editingEventId
      ? await updateEventRequest(activeGroup.id, editingEventId, payload)
      : await createEventRequest(activeGroup.id, payload);
    if (!result.ok) {
      const formError = document.querySelector("#event-form-error");
      if (formError) formError.textContent = result.data.error ?? "Could not save meeting.";
      for (const [name, text] of Object.entries(result.data.fields ?? {})) {
        const slot = eventForm.querySelector(`[data-error="${name}"]`);
        if (slot) slot.textContent = text;
        eventForm.elements[name]?.setAttribute("aria-invalid", "true");
      }
      return;
    }
    const saved = result.data.event;
    if (editingEventId) {
      state.events = state.events.map((e) => (e.id === saved.id ? saved : e));
    } else {
      state.events = [...state.events, saved];
    }
    selectedDate = saved.date;
    eventDialog.close();
    showToast(editingEventId ? "Meeting updated" : "Meeting created");
    await loadActivity({ quiet: true });
    render();
  } catch {
    const formError = document.querySelector("#event-form-error");
    if (formError) formError.textContent = "Could not reach the server. Meeting was not saved.";
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#delete-event").addEventListener("click", async () => {
  if (!activeGroup || !editingEventId) return;
  const existing = state?.events.find((e) => e.id === editingEventId);
  if (!existing || !confirm(`Delete “${existing.title}”? This can't be undone.`)) return;
  const result = await deleteEventRequest(activeGroup.id, editingEventId);
  if (!result.ok) {
    showToast(result.data.error ?? "Could not delete meeting");
    return;
  }
  state.events = state.events.filter((e) => e.id !== editingEventId);
  eventDialog.close();
  showToast("Meeting deleted");
  await loadActivity({ quiet: true });
  render();
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

main.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const { action, id } = target.dataset;

  if (action === "select-group" && id) {
    const result = await selectGroup(id);
    if (!result.ok) {
      showToast(result.data.error ?? "Could not open group");
      await renderGroupsHome({ error: result.data.error });
      return;
    }
    showToast(`Opened ${activeGroup.name}`);
    await render({ focus: true });
    return;
  }

  if (action === "create-invite") {
    if (!activeGroup) return;
    const result = await createInvitation(activeGroup.id);
    if (!result.ok) {
      renderInvite({ error: result.data.error ?? "Could not create invitation." });
      return;
    }
    latestInvite = result.data.invitation;
    showToast("Invitation created");
    renderInvite();
    return;
  }

  if (action === "copy-invite") {
    const link = document.querySelector("#invite-link");
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.value);
      showToast("Invitation link copied");
    } catch {
      link.select();
      showToast("Copy the selected link");
    }
    return;
  }

  if (action === "revoke-invite" && id && activeGroup) {
    const result = await revokeInvitation(activeGroup.id, id);
    if (!result.ok) {
      renderInvite({ error: result.data.error ?? "Could not revoke invitation." });
      return;
    }
    latestInvite = null;
    showToast("Invitation revoked");
    renderInvite();
    return;
  }

  if (action === "reload-tasks") {
    await loadTasks();
    render({ focus: true });
    return;
  }

  if (action === "reload-messages") {
    await loadMessages();
    render({ focus: true });
    return;
  }

  if (action === "reload-calendar") {
    await loadCalendarData();
    render({ focus: true });
    return;
  }

  if (!state) return;
  if (action === "new-task") openTaskDialog();
  if (action === "edit-task") openTaskDialog(id);
  if (action === "move" && target.dataset.to && activeGroup) {
    const previous = state.tasks.find((t) => t.id === id);
    if (!previous) return;
    const nextStatus = target.dataset.to;
    const result = await updateTaskRequest(activeGroup.id, id, { status: nextStatus });
    if (!result.ok) {
      showToast(result.data.error ?? "Could not update status");
      await loadTasks({ quiet: true });
      render();
      return;
    }
    state.tasks = state.tasks.map((t) => (t.id === id ? result.data.task : t));
    showToast("Task moved");
    await loadActivity({ quiet: true });
    render();
    main.querySelector(`[data-task="${id}"] [data-action="move"]:not([disabled])`)?.focus();
  }
  if (action === "month") {
    const step = Number(target.dataset.step);
    const d = new Date(calMonth.year, calMonth.month + step, 1);
    calMonth = { year: d.getFullYear(), month: d.getMonth() };
    const prefix = `${calMonth.year}-${String(calMonth.month + 1).padStart(2, "0")}`;
    if (!selectedDate.startsWith(prefix)) {
      selectedDate = `${prefix}-01`;
    }
    render();
    main.querySelector(`[data-step="${step}"]`)?.focus();
  }
  if (action === "select-date" && target.dataset.date) {
    selectedDate = target.dataset.date;
    render();
    return;
  }
  if (action === "new-event") openEventDialog();
  if (action === "edit-event" && id) openEventDialog(id);
  if (action === "delete-event" && id && activeGroup) {
    const existing = state.events.find((e) => e.id === id);
    if (!existing || !confirm(`Delete “${existing.title}”? This can't be undone.`)) return;
    const result = await deleteEventRequest(activeGroup.id, id);
    if (!result.ok) {
      showToast(result.data.error ?? "Could not delete meeting");
      await loadEvents({ quiet: true });
      render();
      return;
    }
    state.events = state.events.filter((e) => e.id !== id);
    showToast("Meeting deleted");
    await loadActivity({ quiet: true });
    render();
  }
});

main.addEventListener("change", (event) => {
  if (event.target.id === "board-filter") {
    boardFilter = event.target.value;
    render();
    main.querySelector("#board-filter")?.focus();
  }
});

main.addEventListener("submit", async (event) => {
  if (event.target.id === "auth-form") {
    event.preventDefault();
    handleAuthSubmit(event.target);
    return;
  }
  if (event.target.id === "create-group-form") {
    event.preventDefault();
    handleCreateGroup(event.target);
    return;
  }
  if (event.target.id === "join-group-form") {
    event.preventDefault();
    handleJoinGroup(event.target);
    return;
  }
  if (event.target.id !== "chat-form" || !state || !activeGroup) return;
  event.preventDefault();
  const input = event.target.elements.text;
  const text = String(input?.value ?? "");
  chatDraft = text;
  if (!text.trim()) {
    chatSendError = "Message cannot be blank.";
    renderApp();
    return;
  }
  chatSending = true;
  chatSendError = "";
  renderApp();
  try {
    const result = await sendMessage(activeGroup.id, text);
    if (!result.ok) {
      chatDraft = text;
      chatSendError = result.data.fields?.text ?? result.data.error ?? "Could not send message.";
      showToast(result.data.error ?? "Message not sent");
      return;
    }
    chatDraft = "";
    chatSendError = "";
    applyMessagesFromServer([...(state.messages ?? []), result.data.message]);
    showToast("Message sent");
    await loadActivity({ quiet: true });
    chatForceScrollBottom = true;
  } catch {
    chatDraft = text;
    chatSendError = "Could not reach the server. Your text was kept.";
    showToast("Could not reach the server. Message not sent.");
  } finally {
    chatSending = false;
    renderApp();
  }
});

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
main.addEventListener("drop", async (event) => {
  if (!state || !activeGroup) return;
  const column = event.target.closest(".column");
  if (!column) return;
  event.preventDefault();
  const id = event.dataTransfer.getData("text/plain");
  const task = state.tasks.find((t) => t.id === id);
  if (!task || task.status === column.dataset.status) {
    render();
    return;
  }
  const result = await updateTaskRequest(activeGroup.id, id, { status: column.dataset.status });
  if (!result.ok) {
    showToast(result.data.error ?? "Could not update status");
    await loadTasks({ quiet: true });
  } else {
    state.tasks = state.tasks.map((t) => (t.id === id ? result.data.task : t));
    showToast("Task moved");
    await loadActivity({ quiet: true });
  }
  render();
});

groupNameEl.addEventListener("click", () => {
  if (sessionUser) location.hash = "#/groups";
});
groupNameEl.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && sessionUser) {
    event.preventDefault();
    location.hash = "#/groups";
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await logoutUser();
  } finally {
    logoutButton.disabled = false;
    setChromeForAuth(null);
    showToast("Signed out");
    location.hash = "#/login";
    await render({ focus: true });
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (currentRoute().page !== "chat" || !activeGroup) return;
  // Re-observe and mark only what is actually in the chat viewport.
  startChatReadObserver();
  scheduleMarkVisibleRead();
});

async function boot() {
  document.body.classList.add("auth-loading");
  try {
    const me = await fetchCurrentUser();
    if (me.ok && me.data.user) {
      setChromeForAuth(me.data.user);
      await refreshGroups();
      await restoreActiveGroup();
      updateGroupChrome();
    } else {
      setChromeForAuth(null);
    }
  } catch {
    setChromeForAuth(null);
  } finally {
    document.body.classList.remove("auth-loading");
  }

  window.addEventListener("hashchange", () => { render({ focus: true }); });
  if (!location.hash) {
    history.replaceState(null, "", sessionUser ? (activeGroup ? "#/dashboard" : "#/groups") : "#/login");
  }
  await render({ focus: true });
}

boot();
