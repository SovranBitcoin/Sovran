import { registerAccountScoped } from '@/shared/lib/account/accountRegistry';
/**
 * Where each AI answer stands, from the moment it is asked until it settles.
 *
 * One turn per answer, keyed by the answer's message id, which is fresh for
 * every send and every regenerate. `useAiSend` moves it through `nextTurn`;
 * the bubble only reads it. Every move names the turn it is about, so a stream
 * that was stopped by a newer one can only settle its own turn.
 *
 * In memory only, never saved. Per-chunk text lives here rather than in
 * `routstrStore`, whose every write saves the whole conversation (the source
 * of the "sudden reveal" lag that per-token writes caused). The saved message
 * gets the answer in one write when it is complete. A saved answer with no
 * turn was asked in an earlier run, or by an older build: `readAnswer` decodes
 * it, an empty one as interrupted.
 *
 * So a turn is kept only while it says more than its saved message: a
 * finished answer is dropped once it settles (the saved message holds it),
 * and of the failed, interrupted and cut-short ones only the latest
 * `MAX_SETTLED_TURNS` are kept; one dropped reads from its saved message.
 */
import { useSyncExternalStore } from 'react';

import type { ErrorId } from '@/shared/lib/errors/catalog';
import type { RoutstrMessage } from '@/shared/stores/profile/routstrStore';

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
 * - `asking`: the request is on its way and nothing has come back yet.
 *   `startedAtMs` drives the live "Thinking for N seconds" counter.
 * - `streaming`: chunks are arriving; the text and reasoning so far.
 * - `done`: the answer is in the saved message. `truncation` says when the
 *   completion budget ran out before the model finished.
 * - `failed`: the request failed, and why.
 * - `interrupted`: it stopped before the answer finished (the screen closed, a
 *   newer stream stopped it, no chunks came) and can be asked again; `text`
 *   is what had arrived, kept in memory only (`''` for none).
 */
export type Turn =
  | { phase: 'asking'; startedAtMs: number }
  | { phase: 'streaming'; startedAtMs: number; text: string; reasoning: string }
  | { phase: 'done'; truncation: { budgetTokens: number } | null }
  | { phase: 'failed'; error: TurnError }
  | { phase: 'interrupted'; text: string };

type TurnEvent =
  | { type: 'asked'; startedAtMs: number }
  | { type: 'streamed'; text: string; reasoning: string }
  | { type: 'answered'; truncation: { budgetTokens: number } | null }
  | { type: 'failed'; error: TurnError }
  | { type: 'interrupted' };

function isTurnLive(turn: Turn | undefined): boolean {
  return turn?.phase === 'asking' || turn?.phase === 'streaming';
}

/**
 * Pure: the turn after `event` (still `undefined` for one never asked that an
 * event needs to have been). A settled turn ignores everything but a new `asked`, so a late event from a stream
 * cannot change an answer that already settled. A request can fail before it
 * is asked (no model to ask).
 */
export function nextTurn(turn: Turn | undefined, event: TurnEvent): Turn | undefined {
  const live = isTurnLive(turn);
  switch (event.type) {
    case 'asked':
      return live ? turn : { phase: 'asking', startedAtMs: event.startedAtMs };
    case 'streamed':
      return turn?.phase === 'asking' || turn?.phase === 'streaming'
        ? {
            phase: 'streaming',
            startedAtMs: turn.startedAtMs,
            text: event.text,
            reasoning: event.reasoning,
          }
        : turn;
    case 'answered':
      return live ? { phase: 'done', truncation: event.truncation } : turn;
    case 'failed':
      return live || turn === undefined ? { phase: 'failed', error: event.error } : turn;
    case 'interrupted':
      if (turn?.phase === 'streaming') return { phase: 'interrupted', text: turn.text };
      return live ? { phase: 'interrupted', text: '' } : turn;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/** How many settled turns that say more than their saved message are kept. */
const MAX_SETTLED_TURNS = 24;

/** In the order they last moved, oldest first. */
const turns = new Map<string, Turn>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Drop the oldest settled turns past `MAX_SETTLED_TURNS`; a live one is never dropped. */
function dropOldestSettled(): void {
  let settled = 0;
  for (const turn of turns.values()) if (!isTurnLive(turn)) settled++;
  for (const [messageId, turn] of turns) {
    if (settled <= MAX_SETTLED_TURNS) return;
    if (isTurnLive(turn)) continue;
    turns.delete(messageId);
    settled--;
  }
}

/** Move `messageId`'s turn by `event`. */
export function dispatchTurn(messageId: string, event: TurnEvent): void {
  const current = turns.get(messageId);
  const next = nextTurn(current, event);
  if (next === current || !next) return;
  turns.delete(messageId);
  if (next.phase !== 'done' || next.truncation !== null) turns.set(messageId, next);
  dropOldestSettled();
  notify();
}

export function getTurn(messageId: string): Turn | undefined {
  return turns.get(messageId);
}

/** Test seam: forget every turn. */
export function resetTurns(): void {
  if (turns.size === 0) return;
  turns.clear();
  notify();
}

function anyTurnLive(): boolean {
  for (const turn of turns.values()) if (isTurnLive(turn)) return true;
  return false;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `messageId`'s turn. Stable identity until it moves: turns are replaced, never mutated. */
export function useTurn(messageId: string): Turn | undefined {
  return useSyncExternalStore(
    subscribe,
    () => turns.get(messageId),
    () => undefined
  );
}

/** Whether any answer is being asked or streamed. */
export function useAnyTurnLive(): boolean {
  return useSyncExternalStore(subscribe, anyTurnLive, () => false);
}

/**
 * Where a saved assistant message's answer stands: its turn, or, for one
 * asked before this run (or by an older build), what the saved message says.
 */
export function readAnswer(message: RoutstrMessage, turn: Turn | undefined): Turn {
  if (turn) return turn;
  return message.content || message.reasoningContent
    ? { phase: 'done', truncation: null }
    : { phase: 'interrupted', text: '' };
}

registerAccountScoped(
  'ai.turns',
  () => {
    resetTurns();
  },
  () => turns.size === 0
);
