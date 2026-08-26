/**
 * @fileoverview Syncs the active profile's NIP-65 relay list with the network.
 *
 * Runs once NDK is initialized: fetches the profile's own `kind:10002`, ingests
 * it into the relay-list store, and seeds the pool with those relays. If no
 * list exists yet, it first-run-publishes the default bootstrap set as the
 * user's `kind:10002` so followers/outbox-aware clients can discover them.
 *
 * Ingest-before-publish: defaults are only published when the network has NO
 * existing list — an existing list is never clobbered. Deferred via setTimeout
 * (not `runAfterInteractions`, which can stall behind the splash morph, per the
 * NDK provider's note) so it never competes with init.
 */
import { useEffect } from 'react';

import { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';
import type NDK from '@nostr-dev-kit/ndk-mobile';

import { nostrLog } from '@/shared/lib/logger';
import { publishEvent } from '@/shared/lib/nostr/publish';
import { DEFAULT_RELAYS } from '@/shared/lib/nostr/outbox/defaults';
import {
  RELAY_LIST_KIND,
  parseRelayList,
  serializeRelayList,
} from '@/shared/lib/nostr/outbox/nip65';
import { useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';
import { seedPool } from '@/shared/lib/nostr/outbox/seedPool';

const SYNC_DEFER_MS = 1_500;

async function syncOwnRelayList(
  ndk: NDK,
  pubkey: string,
  isCancelled: () => boolean
): Promise<void> {
  try {
    const event = await ndk.fetchEvent({ kinds: [RELAY_LIST_KIND], authors: [pubkey] });
    if (isCancelled()) return;

    if (event) {
      const entries = parseRelayList({ tags: event.tags });
      useRelayListStore.getState().setFromRelay(entries, event.created_at ?? 0);
      seedPool(
        ndk,
        entries.map((e) => e.url)
      );
      return;
    }

    // No list anywhere — first-run-publish the defaults (never clobbers).
    if (useRelayListStore.getState().hasPublished) return;
    const created = Math.floor(Date.now() / 1000);
    const list = new NDKEvent(ndk);
    list.kind = RELAY_LIST_KIND;
    list.created_at = created;
    list.tags = serializeRelayList(DEFAULT_RELAYS.map((url) => ({ url, read: true, write: true })));
    const result = await publishEvent({
      ndk,
      event: list,
      relays: [...DEFAULT_RELAYS],
      resolveOn: 'all-settled',
    });
    if (!isCancelled() && result.isOk()) {
      useRelayListStore.getState().markPublished(created);
      nostrLog.info('nostr.relays.first_run_published');
    }
  } catch (error) {
    nostrLog.warn('nostr.relays.sync_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * @param pubkey  Active profile hex pubkey.
 * @param enabled Gate on NDK readiness (`isInitialized`).
 */
export function useOwnRelayListSync(pubkey: string | undefined, enabled: boolean): void {
  const { ndk } = useNDK();

  useEffect(() => {
    if (!enabled || !ndk || !pubkey) return;
    let cancelled = false;

    const timer = setTimeout(() => {
      void syncOwnRelayList(ndk, pubkey, () => cancelled);
    }, SYNC_DEFER_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, ndk, pubkey]);
}
