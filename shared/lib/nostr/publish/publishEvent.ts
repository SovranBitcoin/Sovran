/**
 * @fileoverview `publishEvent` — the single seam every Nostr write routes
 * through.
 *
 * Replaces scattered `await ndkEvent.publish()` calls. Publishes to each target
 * relay individually (so failures are per-relay, not all-or-nothing), retries
 * only the relays that failed with exponential backoff, dedupes concurrent
 * publishes of the same signed event, and reports a structured
 * {@link PublishResult}.
 *
 * Per-relay semantics follow the NIP-46 transport's verified NDK facts:
 * `relay.publish(event, timeoutMs)` resolves on the relay's OK frame and
 * rejects on error/timeout. Unlike `NDKRelaySet.publish`, this gives genuine
 * per-relay outcomes and resolve-on-first-accept.
 */
import NDK, { NDKEvent, NDKRelaySet, normalizeRelayUrl } from '@nostr-dev-kit/ndk-mobile';
import type { NDKRelay } from '@nostr-dev-kit/ndk-mobile';
import { ResultAsync, err, ok, type Result } from 'neverthrow';

import { nostrLog } from '@/shared/lib/logger';
import {
  DEFAULT_RETRY_POLICY,
  PUBLISH_TIMEOUT_MS,
  backoffDelayMs,
} from '@/shared/lib/nostr/publish/constants';
import type {
  PublishError,
  PublishOptions,
  PublishRelayResult,
  PublishResult,
  RetryPolicy,
} from '@/shared/lib/nostr/publish/types';

/** In-flight publishes keyed by signed event id — joins duplicate calls. */
const inFlight = new Map<string, Promise<Result<PublishResult, PublishError>>>();

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves the target {@link NDKRelay} objects. With an explicit url set, builds
 * a relay set (connecting as needed); otherwise uses the pool's current relays
 * — the same reach `NDKEvent.publish()` has today.
 */
function targetRelays(ndk: NDK, relays?: readonly string[]): NDKRelay[] {
  if (relays && relays.length > 0) {
    const normalized = new Set<string>();
    for (const url of relays) {
      try {
        normalized.add(normalizeRelayUrl(url));
      } catch {
        nostrLog.warn('nostr.publish.relay_url_invalid', { urlLength: url.length });
      }
    }
    if (normalized.size === 0) return [];
    return [...NDKRelaySet.fromRelayUrls([...normalized], ndk).relays];
  }
  return [...ndk.pool.relays.values()];
}

/** Publishes to one relay once, mapping accept/timeout/error to a result. */
async function publishOne(
  relay: NDKRelay,
  event: NDKEvent,
  timeoutMs: number
): Promise<PublishRelayResult> {
  const start = Date.now();
  try {
    await relay.publish(event, timeoutMs);
    return { url: relay.url, ok: true, durationMs: Date.now() - start };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason: 'timeout' | 'error' = /timeout|timed out/i.test(message) ? 'timeout' : 'error';
    return { url: relay.url, ok: false, reason, message, durationMs: Date.now() - start };
  }
}

/**
 * Publishes to every relay, retrying only the failed ones with exponential
 * backoff. `first-ok` short-circuits the retry loop once any relay accepts.
 */
async function publishToRelays(
  relays: NDKRelay[],
  event: NDKEvent,
  timeoutMs: number,
  policy: RetryPolicy,
  resolveOn: 'first-ok' | 'all-settled',
  onRelayResult?: (result: PublishRelayResult) => void
): Promise<PublishRelayResult[]> {
  const finalByUrl = new Map<string, PublishRelayResult>();
  let pending = relays;

  for (let attempt = 0; attempt <= policy.attempts; attempt += 1) {
    if (pending.length === 0) break;

    const settled = await Promise.all(pending.map((relay) => publishOne(relay, event, timeoutMs)));
    const nextPending: NDKRelay[] = [];

    settled.forEach((result, i) => {
      if (result.ok) {
        finalByUrl.set(result.url, result);
        onRelayResult?.(result);
        return;
      }
      // Record the latest failure; retry unless this was the last round.
      finalByUrl.set(result.url, result);
      if (attempt < policy.attempts) {
        nextPending.push(pending[i]);
      } else {
        onRelayResult?.(result);
      }
    });

    if (resolveOn === 'first-ok' && [...finalByUrl.values()].some((r) => r.ok)) break;

    pending = nextPending;
    if (pending.length > 0) await delay(backoffDelayMs(attempt, policy));
  }

  return [...finalByUrl.values()];
}

async function runPublish(opts: PublishOptions): Promise<Result<PublishResult, PublishError>> {
  const { ndk, event } = opts;
  const timeoutMs = opts.timeoutMs ?? PUBLISH_TIMEOUT_MS;
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...opts.retry };
  const resolveOn = opts.resolveOn ?? 'all-settled';

  // Sign if needed — the event id is only known after signing.
  if (!event.sig) {
    if (!ndk.signer) return err({ type: 'no-signer' });
    try {
      await event.sign();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nostrLog.error('nostr.publish.sign_failed', { kind: event.kind });
      return err({ type: 'sign-failed', message });
    }
  }

  const eventId = event.id;

  // Single-flight: a second publish of the same signed event joins the first.
  const existing = inFlight.get(eventId);
  if (existing) return existing;

  const run = (async (): Promise<Result<PublishResult, PublishError>> => {
    const relays = targetRelays(ndk, opts.relays);
    if (relays.length === 0) {
      nostrLog.warn('nostr.publish.no_relays', { kind: event.kind });
      return err({ type: 'no-relays' });
    }

    const relayResults = await publishToRelays(
      relays,
      event,
      timeoutMs,
      policy,
      resolveOn,
      opts.onRelayResult
    );
    const accepted = relayResults.filter(
      (r): r is Extract<PublishRelayResult, { ok: true }> => r.ok
    );
    const failed = relayResults.filter(
      (r): r is Extract<PublishRelayResult, { ok: false }> => !r.ok
    );

    if (accepted.length === 0) {
      nostrLog.error('nostr.publish.all_failed', {
        kind: event.kind,
        relayCount: relayResults.length,
      });
      return err({ type: 'all-failed', relayResults });
    }

    nostrLog.info('nostr.publish.ok', {
      kind: event.kind,
      accepted: accepted.length,
      failed: failed.length,
    });
    return ok({ eventId, relayResults, accepted, failed, anyAccepted: true });
  })();

  inFlight.set(eventId, run);
  try {
    return await run;
  } finally {
    inFlight.delete(eventId);
  }
}

/**
 * Publishes a Nostr event through the central seam. See {@link PublishOptions}.
 *
 * @example
 * const result = await publishEvent({ ndk, event, resolveOn: 'first-ok' });
 * if (result.isErr()) rollbackOptimisticState();
 */
export function publishEvent(opts: PublishOptions): ResultAsync<PublishResult, PublishError> {
  return new ResultAsync(runPublish(opts));
}
