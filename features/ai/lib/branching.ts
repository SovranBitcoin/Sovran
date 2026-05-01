import type { RoutstrMessage } from '@/shared/stores/profile/routstrStore';

/**
 * ChatGPT-style branching support over the flat `RoutstrMessage[]` we
 * already persist. Each message carries a `parentId` (synthesised from
 * insertion order for legacy messages that pre-date the field), and the
 * conversation forms a tree: every `parentId → children` set with more
 * than one entry is a branch point.
 *
 * The on-disk shape stays a flat array — the tree is *derived* on every
 * render. That keeps backwards compatibility free (shallow merge during
 * Zustand rehydration cannot lose tree structure that doesn't exist in
 * persisted state) and lets the existing session/anonymous-mode plumbing
 * keep working without a migration.
 *
 * Active-path semantics:
 *   - At each branch point, `activeChildren[parentId]` names the visible
 *     child. When unset, we fall back to the most recently created child
 *     (largest `timestamp`) so old sessions render exactly as before.
 *   - Walking the active path from root to leaf yields the linear sequence
 *     the chat list renders.
 *   - When the user retries an assistant message we add a sibling under
 *     the same `parentId`, then write `activeChildren[parentId] = newId`
 *     so the active path swings to the new branch immediately.
 */

export interface BranchInfo {
  /** All siblings (including this message), ordered by timestamp. */
  siblings: RoutstrMessage[];
  /** 1-based index of `messageId` within `siblings` — for "2 / 3" UI. */
  index: number;
  /** Total siblings (== `siblings.length`), kept here so callers don't
   *  have to peek into the array shape. */
  total: number;
}

/**
 * Synthesise `parentId` for legacy messages. Old persisted messages have
 * no `parentId` field; treating each one's predecessor in the array as
 * its parent makes them a single linear chain — which is exactly how
 * they used to render.
 *
 * Returns a NEW array only when at least one message needed rewriting,
 * so React identity is preserved for already-normalised history.
 */
export function withSynthesisedParents(messages: RoutstrMessage[]): RoutstrMessage[] {
  let needsRewrite = false;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].parentId === undefined) {
      needsRewrite = true;
      break;
    }
  }
  if (!needsRewrite) return messages;
  const out: RoutstrMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.parentId !== undefined) {
      out.push(m);
    } else {
      out.push({ ...m, parentId: i === 0 ? null : messages[i - 1].id });
    }
  }
  return out;
}

interface ChildIndex {
  childrenByParent: Map<string | null, RoutstrMessage[]>;
  byId: Map<string, RoutstrMessage>;
}

function indexChildren(messages: RoutstrMessage[]): ChildIndex {
  const childrenByParent = new Map<string | null, RoutstrMessage[]>();
  const byId = new Map<string, RoutstrMessage>();
  for (const m of messages) {
    byId.set(m.id, m);
    const key = m.parentId ?? null;
    const list = childrenByParent.get(key);
    if (list) list.push(m);
    else childrenByParent.set(key, [m]);
  }
  // Stable sort within each parent: timestamp ascending. Older sibling first
  // so nav arrows read left-to-right as `older → newer`.
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.timestamp - b.timestamp);
  }
  return { childrenByParent, byId };
}

/**
 * Walk root → leaf via `activeChildren` (or "newest child" fallback) and
 * return the linear sequence of messages the chat list should render.
 *
 * When the input array is empty, returns an empty array.
 */
export function deriveActivePath(
  rawMessages: RoutstrMessage[],
  activeChildren: Record<string, string>
): RoutstrMessage[] {
  if (rawMessages.length === 0) return [];
  const messages = withSynthesisedParents(rawMessages);
  const { childrenByParent, byId } = indexChildren(messages);

  // Pick a root. Prefer parentId === null; if none exist (corrupt or
  // mid-migration data) fall back to the earliest message overall.
  const roots = childrenByParent.get(null) ?? [];
  let cursor: RoutstrMessage | undefined;
  if (roots.length > 0) {
    // Multiple roots: pick the most recent so a brand-new conversation
    // started after a clear takes precedence. (Unusual in practice — we
    // only get here if a session was edited externally.)
    cursor = roots[roots.length - 1];
  } else {
    // Pathological input: no clean root. Use the earliest message.
    cursor = messages.reduce((acc, m) => (m.timestamp < acc.timestamp ? m : acc), messages[0]);
  }

  const path: RoutstrMessage[] = [];
  const guard = new Set<string>(); // protect against accidental cycles
  while (cursor && !guard.has(cursor.id)) {
    guard.add(cursor.id);
    path.push(cursor);
    const kids = childrenByParent.get(cursor.id);
    if (!kids || kids.length === 0) break;
    const pickedId: string | undefined = activeChildren[cursor.id];
    const picked: RoutstrMessage | undefined =
      pickedId != null ? byId.get(pickedId) : undefined;
    const next: RoutstrMessage = picked ?? kids[kids.length - 1];
    cursor = next;
  }
  return path;
}

/**
 * Sibling count + index for a given message id. Used by the bubble's
 * `←  N / M  →` widget. Returns `null` when the message has no siblings
 * (so the widget hides).
 */
export function getSiblingInfo(
  messageId: string,
  rawMessages: RoutstrMessage[]
): BranchInfo | null {
  if (rawMessages.length === 0) return null;
  const messages = withSynthesisedParents(rawMessages);
  const target = messages.find((m) => m.id === messageId);
  if (!target) return null;
  const parentKey: string | null = target.parentId ?? null;
  const { childrenByParent } = indexChildren(messages);
  const siblings = childrenByParent.get(parentKey) ?? [];
  if (siblings.length <= 1) return null;
  const index = siblings.findIndex((m) => m.id === messageId);
  if (index < 0) return null;
  return { siblings, index: index + 1, total: siblings.length };
}

/** Walk parents from `messageId` (exclusive) up to the root, then reverse —
 *  the conversation context that was visible when `messageId` was created.
 *  Used to rebuild the API request payload at retry time. */
export function getAncestorsExclusive(
  messageId: string,
  rawMessages: RoutstrMessage[]
): RoutstrMessage[] {
  const messages = withSynthesisedParents(rawMessages);
  const byId = new Map(messages.map((m) => [m.id, m] as const));
  const target = byId.get(messageId);
  if (!target) return [];
  const stack: RoutstrMessage[] = [];
  const guard = new Set<string>([messageId]);
  let cursor: RoutstrMessage | undefined =
    target.parentId != null ? byId.get(target.parentId) : undefined;
  while (cursor && !guard.has(cursor.id)) {
    guard.add(cursor.id);
    stack.push(cursor);
    cursor = cursor.parentId != null ? byId.get(cursor.parentId) : undefined;
  }
  return stack.reverse();
}
