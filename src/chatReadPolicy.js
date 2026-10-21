/**
 * Client chat read policy (pairs with server/messages/readPosition.js).
 *
 * Server cursor is monotonic: marking upTo message M marks every earlier message
 * read. The client must therefore never propose an upTo that skips unread
 * messages still above the chat viewport.
 *
 * Rules:
 * - Advance only through a contiguous run of viewport-visible messages that
 *   starts at the first message after the stored cursor.
 * - If that next message is not visible, do not mark anything.
 * - Opening Chat with unread history scrolls to the first unread message
 *   (not the bottom). Fully-caught-up chats still open at the bottom.
 */

export function messageIndexById(messages, messageId) {
  if (!messageId) return -1;
  return (messages ?? []).findIndex((m) => m.id === messageId);
}

/** Index of the first message strictly after the read cursor (0 if none). */
export function firstUnreadStartIndex(messages, lastReadMessageId) {
  const list = messages ?? [];
  if (!lastReadMessageId) return 0;
  const idx = messageIndexById(list, lastReadMessageId);
  if (idx < 0) return 0;
  return idx + 1;
}

/**
 * Furthest message id that may be marked read given current visibility.
 * @param {Array<{ id: string }>} messages
 * @param {string | null | undefined} lastReadMessageId
 * @param {Iterable<string> | Set<string>} visibleIds
 * @returns {string | null}
 */
export function contiguousVisibleUpToId(messages, lastReadMessageId, visibleIds) {
  const list = messages ?? [];
  const start = firstUnreadStartIndex(list, lastReadMessageId);
  if (start >= list.length) return null;

  const visible = visibleIds instanceof Set ? visibleIds : new Set(visibleIds);
  if (!visible.has(list[start].id)) return null;

  let lastId = list[start].id;
  for (let i = start + 1; i < list.length; i += 1) {
    if (!visible.has(list[i].id)) break;
    lastId = list[i].id;
  }
  return lastId;
}

/**
 * Message id to scroll into view when entering Chat, or null to pin to bottom.
 */
export function initialScrollMessageId(messages, lastReadMessageId) {
  const list = messages ?? [];
  if (!list.length) return null;
  const start = firstUnreadStartIndex(list, lastReadMessageId);
  if (start >= list.length) return null;
  return list[start].id;
}

/** Whether the chat scroller is pinned near the bottom (for poll re-renders). */
export function isNearBottom(el, thresholdPx = 80) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
}

/**
 * Choose IntersectionObserver root: the messages scroller when it overflows,
 * otherwise the browser viewport (e.g. mobile layout with max-height: none).
 */
export function chatObserverRoot(listEl) {
  if (!listEl) return null;
  if (listEl.scrollHeight > listEl.clientHeight + 1) return listEl;
  return null;
}
