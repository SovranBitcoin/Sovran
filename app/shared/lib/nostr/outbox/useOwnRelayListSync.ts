/**
 * @fileoverview Syncs the active profile's NIP-65 relay list with the network.
 *
 * Runs once NDK is initialized: reads the profile's own `kind:10002`, ingests
 * it into the relay-list store, and seeds the pool with those relays. If the
 * relays answer that no list exists yet, it first-run-publishes the default
 * bootstrap set as the user's `kind:10002` so followers/outbox-aware clients
 * can discover them.
 *
 * Either answer marks the account's list as discovered for this session, which
 * is what lets the follow worker read and publish (`getKnownOwnWriteRelays`).
 * A read nobody answered marks nothing and is tried again on returning to the
 * foreground, when the network comes back and when a relay connects.
 *
 * Ingest-before-publish: defaults are only published when the network has NO
 * existing list — an existing list is never clobbered. Deferred via setTimeout
 * (not `runAfterInteractions`, which can stall behind the splash morph, per the
 * NDK provider's note) so it never competes with init.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

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
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';

const SYNC_DEFER_MS = 1_500;
const READ_TIMEOUT_MS = 10_000;

/** What the relays said: a list, that there is none (they answered), or nothing. */
type RelayListRead =
  { status: 'found'; event: NDKEvent } | { status: 'none' } | { status: 'unanswered' };

/**
 * The newest relay list in the pool. Only an end-of-stored-events answer says
 * there is none; a read that times out without a list, or fails, is unanswered.
 */
function readOwnRelayList(ndk: NDK, pubkey: string): Promise<RelayListRead> {
  return new Promise((resolve) => {
    let newest: NDKEvent | undefined;
    let settled = false;
    const subscription = ndk.subscribe(
      { kinds: [RELAY_LIST_KIND], authors: [pubkey] },
      { closeOnEose: true },
      undefined,
      false
    );
    const finish = (answered: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.stop();
      if (newest) resolve({ status: 'found', event: newest });
      else resolve(answered ? { status: 'none' } : { status: 'unanswered' });
    };
    const timer = setTimeout(() => finish(false), READ_TIMEOUT_MS);
    subscription.on('event', (event: NDKEvent) => {
      if (!newest || (newest.created_at ?? 0) < (event.created_at ?? 0)) newest = event;
    });
    subscription.on('eose', () => finish(true));
    Promise.resolve(subscription.start()).catch(() => {
      newest = undefined;
      finish(false);
    });
  });
}

/** Whether this session's discovery for the account finished, or must be tried again. */
async function syncOwnRelayList(
  ndk: NDK,
  pubkey: string,
  isCancelled: () => boolean
): Promise<'discovered' | 'unanswered'> {
  try {
    const read = await readOwnRelayList(ndk, pubkey);
    if (isCancelled()) return 'unanswered';
    if (read.status === 'unanswered') {
      nostrLog.warn('nostr.relays.sync_unanswered');
      return 'unanswered';
    }

    if (read.status === 'found') {
      const { event } = read;
      const entries = parseRelayList({ tags: event.tags });
      useRelayListStore.getState().setFromRelay(entries, event.created_at ?? 0);
      useRelayListStore.getState().markDiscovered(pubkey);
      seedPool(
        ndk,
        entries.map((e) => e.url)
      );
      return 'discovered';
    }

    // The relays hold no list: the defaults are the account's list.
    // First-run-publish them (never clobbers).
    useRelayListStore.getState().markDiscovered(pubkey);
    if (useRelayListStore.getState().hasPublished) return 'discovered';
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
    return 'discovered';
  } catch (error) {
    nostrLog.warn('nostr.relays.sync_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // A failure after the answer (the first-run publish) leaves it discovered.
    return useRelayListStore.getState().discoveredFor === pubkey ? 'discovered' : 'unanswered';
  }
}

/**
 * @param pubkey  Active profile hex pubkey.
 * @param enabled Gate on NDK readiness (`isInitialized`).
 */
export function useOwnRelayListSync(pubkey: string | undefined, enabled: boolean): void {
  const { ndk } = useNDK();
  const { isOffline } = useOfflineStatus();
  const retry = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!enabled || !ndk || !pubkey) return;
    let cancelled = false;
    let phase: 'waiting' | 'reading' | 'unanswered' | 'discovered' = 'waiting';
    const run = async () => {
      phase = 'reading';
      phase = await syncOwnRelayList(ndk, pubkey, () => cancelled);
    };
    const again = () => {
      if (!cancelled && phase === 'unanswered') void run();
    };

    const timer = setTimeout(() => void run(), SYNC_DEFER_MS);
    const onRelayConnect = () => again();
    ndk.pool.on('relay:connect', onRelayConnect);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') again();
    });
    retry.current = again;

    return () => {
      cancelled = true;
      clearTimeout(timer);
      subscription.remove();
      ndk.pool.off('relay:connect', onRelayConnect);
      retry.current = () => undefined;
    };
  }, [enabled, ndk, pubkey]);

  useEffect(() => {
    if (!isOffline) retry.current();
  }, [isOffline]);
}
