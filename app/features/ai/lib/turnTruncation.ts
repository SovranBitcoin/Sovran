/**
 * Module-level record of which assistant turns ran out of completion budget.
 *
 * An answer that stops because `max_tokens` was reached looks, on screen,
 * exactly like an answer that finished — the stream closes, the bubble
 * finalises, the cost stamps. The user paid for it either way. Capping the
 * budget to stop over-reserving their money is only defensible if the case
 * where the cap bites says so, so this is where the send path leaves that
 * fact and the bubble picks it up.
 *
 * Same shape and lifetime as `turnErrors`, and deliberately NOT in
 * `routstrStore`: a truncation is session state, the persisted message is a
 * migration surface, and a notice that does not survive a relaunch is a
 * smaller loss than a schema change. Kept separate from `turnErrors` because
 * a truncated answer is not a failed one — it has content, actions and a cost,
 * and it renders as itself with a note, not as a pill in place of itself.
 */
import { useSyncExternalStore } from 'react';

interface TurnTruncation {
  /** The `max_tokens` the request carried — the budget that ran out. */
  budgetTokens: number;
}

/** Bounded the same way `turnErrors` is: a long session cannot accumulate one
 *  entry per turn forever. Oldest-first eviction via `Map` insertion order. */
const MAX_ENTRIES = 24;

const truncationByMessageId = new Map<string, TurnTruncation>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Mark `messageId`'s answer as cut off at `budgetTokens`. */
export function recordTurnTruncation(messageId: string, truncation: TurnTruncation): void {
  truncationByMessageId.delete(messageId);
  truncationByMessageId.set(messageId, truncation);
  while (truncationByMessageId.size > MAX_ENTRIES) {
    const oldest = truncationByMessageId.keys().next();
    if (oldest.done) break;
    truncationByMessageId.delete(oldest.value);
  }
  notify();
}

/** Forget it — called when the turn starts streaming again, so a re-used
 *  placeholder never carries the previous attempt's note. */
export function clearTurnTruncation(messageId: string): void {
  if (!truncationByMessageId.delete(messageId)) return;
  notify();
}

/** Test seam: drop every recorded truncation. */
export function resetTurnTruncations(): void {
  if (truncationByMessageId.size === 0) return;
  truncationByMessageId.clear();
  notify();
}

export function getTurnTruncation(messageId: string): TurnTruncation | null {
  return truncationByMessageId.get(messageId) ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The recorded truncation for `messageId`, or `null`. Stable identity between
 * notifications — the stored object is only ever replaced, never mutated.
 */
export function useTurnTruncation(messageId: string): TurnTruncation | null {
  return useSyncExternalStore(
    subscribe,
    () => getTurnTruncation(messageId),
    () => null
  );
}
