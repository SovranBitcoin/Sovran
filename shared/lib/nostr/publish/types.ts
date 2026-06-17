/**
 * @fileoverview Types for the central publish seam (`publishEvent`).
 *
 * Every Nostr write in the app routes through `publishEvent`, which collects a
 * per-relay outcome rather than the all-or-nothing boolean that
 * `NDKEvent.publish()` returns. Callers get enough detail to drive a
 * "published to N/M relays" UI and a meaningful retry affordance.
 */
import type NDK from '@nostr-dev-kit/ndk-mobile';
import type { NDKEvent } from '@nostr-dev-kit/ndk-mobile';

/** Outcome of publishing one event to one relay. */
export type PublishRelayResult =
  | { url: string; ok: true; durationMs: number }
  | {
      url: string;
      ok: false;
      reason: 'rejected' | 'timeout' | 'error';
      message?: string;
      durationMs: number;
    };

export interface PublishResult {
  /** The signed event's id. */
  eventId: string;
  /** Final per-relay outcomes (one entry per target relay, deduped by url). */
  relayResults: PublishRelayResult[];
  accepted: PublishRelayResult[];
  failed: PublishRelayResult[];
  /** True when at least one relay accepted the event. */
  anyAccepted: boolean;
}

export type PublishError =
  | { type: 'no-signer' }
  | { type: 'sign-failed'; message?: string }
  | { type: 'no-relays' }
  | { type: 'all-failed'; relayResults: PublishRelayResult[] };

export interface RetryPolicy {
  /** Number of retry rounds AFTER the initial attempt. */
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface PublishOptions {
  ndk: NDK;
  /** Signed or unsigned. Unsigned events are signed with `ndk.signer`. */
  event: NDKEvent;
  /**
   * Explicit relay-url set. When omitted, the event publishes to the NDK pool's
   * current relays (preserving `NDKEvent.publish()` reach). Phase 1's
   * `resolveWriteRelays` is the source for outbox-aware sets.
   */
  relays?: readonly string[];
  /** Per-relay timeout (ms). Defaults to {@link PUBLISH_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Retry policy override (merged over the default). */
  retry?: Partial<RetryPolicy>;
  /**
   * `'first-ok'` stops retrying as soon as one relay accepts (latency-sensitive
   * writes like reactions). `'all-settled'` runs the full retry budget so the
   * event lands as widely as possible (replaceable lists, drafts).
   */
  resolveOn?: 'first-ok' | 'all-settled';
  /** Streamed terminal per-relay outcomes — drives live publish progress UI. */
  onRelayResult?: (result: PublishRelayResult) => void;
}
