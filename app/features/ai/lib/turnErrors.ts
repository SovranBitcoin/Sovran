/**
 * Module-level record of which assistant turns failed, and why.
 *
 * A failed turn used to vanish: the send flow deleted its placeholder and a
 * toast said something had gone wrong, somewhere, about nothing the user could
 * still see. The placeholder now stays where it was, and its bubble renders an
 * error pill instead of an empty gap — this is where the bubble looks up what
 * that pill should say.
 *
 * Deliberately NOT in `routstrStore`: the store persists every write to
 * AsyncStorage and its schema is a migration surface. A turn error is session
 * state — true until the user retries, changes model or leaves — and the
 * bubble already knows how to fall back when there is no entry (an empty,
 * non-streaming assistant message is a failure whether or not this module
 * remembers which one). Same shape and lifetime as `streamingBuffer`.
 */
import { useSyncExternalStore } from 'react';

import type { ErrorId } from '@/shared/lib/errors/catalog';

export interface TurnError {
  /** Stable catalogue id — the vocabulary the action mapping branches on. */
  id: ErrorId;
  /** Curated copy from `ERROR_COPY`. Never an upstream message. */
  text: string;
  /**
   * One extra sentence WE computed from structured failure details (e.g. the
   * exact shortfall on a wallet 402). Never upstream prose — the catalogue
   * rule forbids that, and this is our own arithmetic, not their words.
   */
  detail?: string;
}

/**
 * Bounded so a long-lived session can't accumulate one entry per failed turn
 * forever. Oldest-first eviction via `Map`'s insertion order; a pill whose
 * entry aged out still renders, on the generic copy the bubble falls back to.
 */
const MAX_ENTRIES = 24;

const errorsByMessageId = new Map<string, TurnError>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Mark `messageId`'s turn as failed. Overwrites any previous entry, so a
 *  re-failed retry reports its own reason rather than the first one's. */
export function recordTurnError(messageId: string, error: TurnError): void {
  errorsByMessageId.delete(messageId);
  errorsByMessageId.set(messageId, error);
  while (errorsByMessageId.size > MAX_ENTRIES) {
    const oldest = errorsByMessageId.keys().next();
    if (oldest.done) break;
    errorsByMessageId.delete(oldest.value);
  }
  notify();
}

/** Forget `messageId`'s failure — called when its turn starts streaming
 *  again, so a re-used placeholder never shows a stale pill. */
export function clearTurnError(messageId: string): void {
  if (!errorsByMessageId.delete(messageId)) return;
  notify();
}

/** Test seam: drop every recorded failure. */
export function resetTurnErrors(): void {
  if (errorsByMessageId.size === 0) return;
  errorsByMessageId.clear();
  notify();
}

export function getTurnError(messageId: string): TurnError | null {
  return errorsByMessageId.get(messageId) ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The recorded failure for `messageId`, or `null`. Stable identity between
 * notifications — `useSyncExternalStore` compares the snapshot by reference,
 * and the stored object is only ever replaced, never mutated.
 */
export function useTurnError(messageId: string): TurnError | null {
  return useSyncExternalStore(
    subscribe,
    () => getTurnError(messageId),
    () => null
  );
}
