/**
 * @fileoverview Tunables for the central publish seam.
 *
 * Mirrors the per-relay timeout convention proven in the NIP-46 transport
 * (`features/nostrSigner/lib/nip46Transport.ts`), but for general event
 * publishing the default window is more generous: feed/profile relays are
 * slower and less reliable than a paired signer relay.
 */
import type { RetryPolicy } from '@/shared/lib/nostr/publish/types';

/** Per-relay OK timeout. `relay.publish(event, ms)` rejects after this. */
export const PUBLISH_TIMEOUT_MS = 10_000;

/** Default retry: re-hit only the relays that failed, with exponential backoff. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  attempts: 2,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
};

/** Backoff for the Nth retry (attempt index is 0-based for the first retry). */
export function backoffDelayMs(attemptIndex: number, policy: RetryPolicy): number {
  const raw = policy.baseDelayMs * 2 ** attemptIndex;
  return Math.min(raw, policy.maxDelayMs);
}
