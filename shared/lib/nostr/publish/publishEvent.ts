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
 *
 * Three resolve modes, one engine: `first-ok` and `all-settled` resolve only
 * once the fan-out is done; `optimistic` resolves the instant the first relay
 * accepts and finishes the fan-out (plus recipient/outbox relays) in the
 * background — see {@link runOptimistic}.
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

/**
 * In-flight publishes keyed by signed event id — joins duplicate calls. For
 * `optimistic` publishes the entry is held until the BACKGROUND fan-out
 * finishes (not just first-accept), so a duplicate during the background window
 * still joins instead of starting a second fan-out.
 */
const inFlight = new Map<string, Promise<Result<PublishResult, PublishError>>>();

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type AcceptResult = Extract<PublishRelayResult, { ok: true }>;

/** Assembles the structured result from a set of per-relay outcomes. */
function buildPublishResult(eventId: string, relayResults: PublishRelayResult[]): PublishResult {
  const accepted = relayResults.filter((r): r is AcceptResult => r.ok);
  const failed = relayResults.filter((r): r is Extract<PublishRelayResult, { ok: false }> => !r.ok);
  return { eventId, relayResults, accepted, failed, anyAccepted: accepted.length > 0 };
}

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
 * Publishes to every relay concurrently, once. `onAccept` fires the instant any
 * relay accepts (before the round settles) — the hook the optimistic mode uses
 * to resolve on the genuine first accept rather than the slowest relay.
 */
async function publishRound(
  relays: NDKRelay[],
  event: NDKEvent,
  timeoutMs: number,
  onAccept?: (result: AcceptResult) => void
): Promise<{ results: PublishRelayResult[]; failed: NDKRelay[] }> {
  const settled = await Promise.all(
    relays.map(async (relay) => {
      const result = await publishOne(relay, event, timeoutMs);
      if (result.ok) onAccept?.(result);
      return { result, relay };
    })
  );
  return {
    results: settled.map((s) => s.result),
    failed: settled.filter((s) => !s.result.ok).map((s) => s.relay),
  };
}

interface FanOutHooks {
  resolveOn: 'first-ok' | 'all-settled';
  onAccept?: (result: AcceptResult) => void;
  onRelayResult?: (result: PublishRelayResult) => void;
  /**
   * Called after each round settles with the 0-based attempt index and whether
   * any relay has accepted so far. Return `true` to stop the fan-out early
   * (the optimistic mode uses this to bail after a fully-failed first round).
   */
  onRoundSettled?: (attempt: number, anyAccepted: boolean) => boolean;
}

/**
 * Runs the full retry budget over `relays`, retrying only the relays that
 * failed, accumulating terminal outcomes into `finalByUrl`. The single engine
 * behind all resolve modes.
 */
async function fanOut(
  relays: NDKRelay[],
  event: NDKEvent,
  timeoutMs: number,
  policy: RetryPolicy,
  finalByUrl: Map<string, PublishRelayResult>,
  hooks: FanOutHooks
): Promise<void> {
  let pending = relays;
  for (let attempt = 0; attempt <= policy.attempts; attempt += 1) {
    if (pending.length === 0) break;

    const { results, failed } = await publishRound(pending, event, timeoutMs, hooks.onAccept);
    const isLast = attempt === policy.attempts;
    for (const result of results) {
      finalByUrl.set(result.url, result);
      // Accepts stream immediately; failures only once they're terminal (last round).
      if (result.ok || isLast) hooks.onRelayResult?.(result);
    }

    const anyAccepted = [...finalByUrl.values()].some((r) => r.ok);
    if (hooks.onRoundSettled?.(attempt, anyAccepted)) return;
    if (hooks.resolveOn === 'first-ok' && anyAccepted) return;

    pending = isLast ? [] : failed;
    if (pending.length > 0) await delay(backoffDelayMs(attempt, policy));
  }
}

interface PublishRun {
  /** Resolves when delivery is assured (or has definitively failed). */
  assured: Promise<Result<PublishResult, PublishError>>;
  /** Resolves when ALL work — including background fan-out — has finished. */
  done: Promise<void>;
}

/**
 * Optimistic publish: resolve `assured` the instant the first relay accepts so
 * the UI can dismiss, then finish the fan-out and the recipient/outbox relays
 * in the background. If the first round over the base relays accepts nowhere,
 * resolve `all-failed` immediately and abandon the rest (the caller keeps the
 * composer open with the draft intact).
 */
function runOptimistic(
  ndk: NDK,
  event: NDKEvent,
  eventId: string,
  timeoutMs: number,
  policy: RetryPolicy,
  opts: PublishOptions
): PublishRun {
  let settle!: (result: Result<PublishResult, PublishError>) => void;
  const assured = new Promise<Result<PublishResult, PublishError>>((resolve) => {
    settle = resolve;
  });
  // Held on an object so TS doesn't narrow it away across the `await` below
  // (it's only ever mutated inside the fan-out callbacks).
  const status = { resolved: false, ok: false };
  const resolveAssured = (result: Result<PublishResult, PublishError>): void => {
    if (status.resolved) return;
    status.resolved = true;
    status.ok = result.isOk();
    settle(result);
  };

  const finalByUrl = new Map<string, PublishRelayResult>();
  const onAccept = (result: AcceptResult): void =>
    resolveAssured(ok(buildPublishResult(eventId, [result])));

  const done = (async (): Promise<void> => {
    const base = targetRelays(ndk, opts.relays);
    if (base.length === 0) {
      nostrLog.warn('nostr.publish.no_relays', { kind: event.kind });
      resolveAssured(err({ type: 'no-relays' }));
      return;
    }

    await fanOut(base, event, timeoutMs, policy, finalByUrl, {
      resolveOn: 'all-settled',
      onAccept,
      onRelayResult: opts.onRelayResult,
      onRoundSettled: (attempt, anyAccepted) => {
        if (attempt === 0 && !anyAccepted) {
          // Nothing accepted on the first attempt: surface the failure now so
          // the user keeps their draft, and don't leave a zombie background
          // publish running for a post they'll likely retry.
          nostrLog.error('nostr.publish.all_failed', {
            kind: event.kind,
            relayCount: finalByUrl.size,
          });
          resolveAssured(err({ type: 'all-failed', relayResults: [...finalByUrl.values()] }));
          return true;
        }
        return false;
      },
    });

    if (!status.ok) return;

    // Recipient (outbox) relays: best-effort reach, off the user's critical
    // path. Failures here never surface — the note is already on the network.
    if (opts.backgroundRelays) {
      const extraUrls = await opts.backgroundRelays.catch(() => [] as readonly string[]);
      const extra = targetRelays(ndk, extraUrls).filter((relay) => !finalByUrl.has(relay.url));
      if (extra.length > 0) {
        await fanOut(extra, event, timeoutMs, policy, finalByUrl, {
          resolveOn: 'all-settled',
          onRelayResult: opts.onRelayResult,
        });
      }
    }

    const accepted = [...finalByUrl.values()].filter((r) => r.ok).length;
    nostrLog.info('nostr.publish.optimistic_settled', {
      kind: event.kind,
      accepted,
      relayCount: finalByUrl.size,
    });
  })();

  return { assured, done };
}

/** Runs `first-ok` / `all-settled`: a single fan-out, resolved once it's done. */
async function runBlocking(
  ndk: NDK,
  event: NDKEvent,
  eventId: string,
  timeoutMs: number,
  policy: RetryPolicy,
  opts: PublishOptions
): Promise<Result<PublishResult, PublishError>> {
  const relays = targetRelays(ndk, opts.relays);
  if (relays.length === 0) {
    nostrLog.warn('nostr.publish.no_relays', { kind: event.kind });
    return err({ type: 'no-relays' });
  }

  const finalByUrl = new Map<string, PublishRelayResult>();
  await fanOut(relays, event, timeoutMs, policy, finalByUrl, {
    resolveOn: opts.resolveOn === 'first-ok' ? 'first-ok' : 'all-settled',
    onRelayResult: opts.onRelayResult,
  });

  const result = buildPublishResult(eventId, [...finalByUrl.values()]);
  if (!result.anyAccepted) {
    nostrLog.error('nostr.publish.all_failed', {
      kind: event.kind,
      relayCount: result.relayResults.length,
    });
    return err({ type: 'all-failed', relayResults: result.relayResults });
  }

  nostrLog.info('nostr.publish.ok', {
    kind: event.kind,
    accepted: result.accepted.length,
    failed: result.failed.length,
  });
  return ok(result);
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

  if (resolveOn === 'optimistic') {
    const { assured, done } = runOptimistic(ndk, event, eventId, timeoutMs, policy, opts);
    inFlight.set(eventId, assured);
    void done
      .catch((error: unknown) =>
        nostrLog.error('nostr.publish.background_failed', {
          kind: event.kind,
          message: error instanceof Error ? error.message : String(error),
        })
      )
      .finally(() => inFlight.delete(eventId));
    return assured;
  }

  const run = runBlocking(ndk, event, eventId, timeoutMs, policy, opts);
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
