import { useSyncExternalStore } from 'react';
import { aiLog } from '@/shared/lib/logger';

/**
 * Module-level buffer for in-flight assistant streams. Lets the bubble of the
 * currently-streaming message subscribe directly to the live token stream
 * WITHOUT round-tripping through `routstrStore` on every chunk — which would
 * persist a JSON snapshot of the entire conversation to AsyncStorage on every
 * single token (the source of the visible "sudden reveal" lag we saw before).
 *
 * Three live channels share one subscriber set:
 *
 *   - `streamingText`       — the assistant's reply tokens, accumulated.
 *   - `streamingReasoning`  — the model's thinking / reasoning tokens
 *                             (DeepSeek R1, o-series, etc.), accumulated.
 *   - `streamingStartedAtMs`— the wall-clock instant the request was fired,
 *                             used by the bubble to render a live
 *                             "Thinking for X seconds" counter that ticks
 *                             without piping per-second updates through
 *                             Zustand.
 *
 * Each `useStreaming*` hook reads only its own channel; `useSyncExternalStore`
 * skips the re-render when the relevant primitive didn't change. So a
 * reasoning-only chunk re-renders the reasoning text view but not the body
 * text view, and the elapsed-seconds tick (a setInterval inside the bubble)
 * doesn't even read this buffer.
 *
 * On stream completion, `useAiSend` calls `clearStreaming()` and the persisted
 * `finalizeAssistantMessage` write captures the same content + reasoning +
 * thinking duration that was rendering live, so the bubble seamlessly swaps
 * from the live buffer to the persisted message.
 */

let streamingId: string | null = null;
let streamingText = '';
let streamingReasoning = '';
let streamingStartedAtMs: number | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Mark `id` as the currently streaming message and reset all live channels
 * to their pristine state. Call this once per send, BEFORE any content or
 * reasoning chunks land — `Date.now()` is captured here so the bubble's
 * live counter can render "Thinking for N seconds" off a stable origin.
 */
export function startStreaming(id: string): void {
  streamingId = id;
  streamingText = '';
  streamingReasoning = '';
  streamingStartedAtMs = Date.now();
  notify();
}

/** Push the latest aggregated body text. No-op if a different id is active —
 *  prevents a stale producer from clobbering a fresh stream's state. */
export function setStreamingText(id: string, text: string): void {
  if (streamingId !== id) return;
  streamingText = text;
  notify();
}

/** Push the latest aggregated reasoning text. Same id-guard rules as
 *  `setStreamingText`. Reasoning channels stream independently of body
 *  text — many models emit reasoning tokens before the first body token. */
export function setStreamingReasoning(id: string, reasoning: string): void {
  if (streamingId !== id) return;
  streamingReasoning = reasoning;
  notify();
}

export function clearStreaming(): void {
  streamingId = null;
  streamingText = '';
  streamingReasoning = '';
  streamingStartedAtMs = null;
  notify();
}

function getStreamingTextFor(messageId: string): string | null {
  return streamingId === messageId ? streamingText : null;
}

function getStreamingReasoningFor(messageId: string): string | null {
  return streamingId === messageId ? streamingReasoning : null;
}

function getStreamingStartedAtFor(messageId: string): number | null {
  return streamingId === messageId ? streamingStartedAtMs : null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Subscribers should be ≤ a small handful (the streaming bubble plus its
  // reasoning/timer subscribers). A growing count over multiple sends
  // signals a leaked fiber that didn't unsubscribe.
  aiLog.debug('ai.stream.buffer.subscribe', { listeners: listeners.size });
  return () => {
    listeners.delete(listener);
    aiLog.debug('ai.stream.buffer.unsubscribe', { listeners: listeners.size });
  };
}

/** Live body text for `messageId`, or `null` if `messageId` is not the
 *  active stream. */
export function useStreamingContent(messageId: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => getStreamingTextFor(messageId),
    () => null
  );
}

/** Live reasoning text for `messageId`, or `null` if `messageId` is not
 *  the active stream. Empty-string while the model hasn't emitted any
 *  reasoning tokens yet. */
export function useStreamingReasoning(messageId: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => getStreamingReasoningFor(messageId),
    () => null
  );
}

/** Wall-clock `Date.now()` value at which the active stream began, or
 *  `null` when this bubble isn't the active stream. The bubble computes
 *  `Math.floor((Date.now() - this) / 1000)` for the "Thinking for X
 *  seconds" header, ticking on a local `setInterval` rather than churning
 *  the buffer with per-tick notifications. */
export function useStreamingStartedAt(messageId: string): number | null {
  return useSyncExternalStore(
    subscribe,
    () => getStreamingStartedAtFor(messageId),
    () => null
  );
}
