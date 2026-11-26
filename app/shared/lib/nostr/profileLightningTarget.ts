/**
 * @fileoverview The Lightning target a Nostr profile published, read from what
 * the caller already holds first and the shared entity cache second.
 *
 * Tapping Send right after opening a profile can beat the kind-0 fetch; a
 * caller that falls back to npub.cash on that miss would silently ignore an
 * address the person did publish. `resolveProfileLightningTarget` can wait a
 * short, bounded time for the cache to fill before reporting "none".
 */
import { extractLightningTarget } from 'wallet';

import { peekNostrDataLayer } from '@/shared/lib/nostr/dataLayerRegistry';

interface LightningFields {
  lud16?: string | null;
  lud06?: string | null;
}

/** The Lightning target already in the entity cache for `pubkey`, or null. */
export function peekCachedLightningTarget(pubkey: string): string | null {
  const record = peekNostrDataLayer()?.cache?.profiles.peek(pubkey);
  return record ? extractLightningTarget(record) : null;
}

/**
 * `known` fields win; otherwise the cache; otherwise, when `waitMs > 0`, wait up
 * to that long for the profile record to arrive. Returns null when the profile
 * published nothing usable.
 */
export async function resolveProfileLightningTarget(
  pubkey: string,
  known: LightningFields | null | undefined,
  waitMs = 0
): Promise<string | null> {
  const direct =
    (known ? extractLightningTarget(known) : null) ?? peekCachedLightningTarget(pubkey);
  if (direct || waitMs <= 0) return direct;
  const store = peekNostrDataLayer()?.cache?.profiles;
  if (!store) return null;
  return new Promise<string | null>((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => {};
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const timer = setTimeout(() => finish(peekCachedLightningTarget(pubkey)), waitMs);
    unsubscribe = store.subscribeKey(pubkey, () => {
      const target = peekCachedLightningTarget(pubkey);
      if (target) finish(target);
    });
  });
}
