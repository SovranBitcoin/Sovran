/**
 * @fileoverview Syncs the active profile's NIP-65 relay list with the network.
 *
 * Runs once NDK is initialized: reads the profile's own `kind:10002` from each
 * saved write relay and each default relay, ingests the newest into the
 * relay-list store, and seeds the pool with those relays. If every one of them
 * answers that no list exists yet, it first-run-publishes the default
 * bootstrap set as the user's `kind:10002` so followers/outbox-aware clients
 * can discover them (`publishOwnRelayList`), unless the person has an edit of
 * their own waiting to be published.
 *
 * Only an answer from every asked relay marks the account's list as discovered
 * for this session, which is what lets the follow worker read and publish
 * (`getKnownOwnWriteRelays`). The device cache is never asked. A relay that
 * does not answer is read again straight away until it has been silent for
 * `SILENT_READS_BEFORE_LEFT_OUT` reads in a row; the next read goes without it
 * (`readNewestOwnEvent`), so one dead default relay cannot hold a new account
 * back. A read that failed, or that still did not finish, marks nothing and is
 * tried again on returning to the foreground, when the network comes back and
 * when a relay connects. A retry asks every relay an earlier attempt asked as well as
 * the saved ones now: a partial answer is taken into the store, and may have
 * replaced the saved relay that holds the newer list.
 *
 * Ingest-before-publish: defaults are only published when every asked relay
 * says there is NO existing list — an existing list is never clobbered. Deferred via setTimeout
 * (not `runAfterInteractions`, which can stall behind the splash morph, per the
 * NDK provider's note) so it never competes with init.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import type NDK from '@nostr-dev-kit/ndk-mobile';

import { nostrLog } from '@/shared/lib/logger';
import { readNewestOwnEvent, worthReadingAgain } from '@/shared/lib/nostr/ownReplaceableEvent';
import { RELAY_LIST_KIND, parseRelayList } from '@/shared/lib/nostr/outbox/nip65';
import {
  publishOwnRelayList,
  relayListRelays,
  trackRelaysAsked,
} from '@/shared/lib/nostr/outbox/publishOwnRelayList';
import { defaultEntries, useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';
import { seedPool } from '@/shared/lib/nostr/outbox/seedPool';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';

const SYNC_DEFER_MS = 1_500;

/**
 * Whether this session's discovery for the account finished, or must be tried
 * again. `asked` holds every relay this session's attempts have asked, and
 * only grows: each of them must answer the same attempt.
 */
async function syncOwnRelayList(
  ndk: NDK,
  pubkey: string,
  asked: Set<string>,
  isCancelled: () => boolean
): Promise<'discovered' | 'unanswered'> {
  try {
    let read: Awaited<ReturnType<typeof readNewestOwnEvent>>;
    do {
      const current = relayListRelays(pubkey);
      if (!current) return 'unanswered';
      for (const url of current) asked.add(url);
      read = await readNewestOwnEvent(ndk, pubkey, RELAY_LIST_KIND, {
        relays: [...asked],
        leaveOutSilent: true,
      });
      if (isCancelled()) return 'unanswered';

      if (read.newest) {
        // A list any relay returned is taken in, even before the others answered.
        const entries = parseRelayList({ tags: read.newest.tags });
        useRelayListStore.getState().setFromRelay(entries, read.newest.created_at ?? 0);
        seedPool(
          ndk,
          entries.map((e) => e.url)
        );
      }
      // A relay that stays silent is read without after a few reads in a row.
    } while (worthReadingAgain(read));
    const { newest } = read;
    // Only every relay's answer, but those left out as silent, makes the list
    // known, or says there is none.
    if (read.outcome !== 'complete') {
      nostrLog.warn('nostr.relays.sync_unanswered', { outcome: read.outcome });
      return 'unanswered';
    }
    useRelayListStore.getState().markDiscovered(pubkey);
    if (newest) return 'discovered';

    // The relays hold no list: the defaults are the account's list.
    // First-run-publish them (never clobbers), to the relays just read. An
    // edit the person made before this answer is theirs to publish: it is
    // neither replaced by the defaults nor marked published unsent.
    const { hasPublished, source } = useRelayListStore.getState();
    if (hasPublished || source === 'local') return 'discovered';
    const published = await publishOwnRelayList(ndk, pubkey, defaultEntries(), {
      read: { status: 'read', newest: undefined, relays: read.relays, asked: read.asked },
      stillWanted: () => !isCancelled(),
    });
    if (published.isOk()) nostrLog.info('nostr.relays.first_run_published');
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
    const asked = new Set<string>();
    const untrack = trackRelaysAsked(pubkey, asked);
    const run = async () => {
      phase = 'reading';
      phase = await syncOwnRelayList(ndk, pubkey, asked, () => cancelled);
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
      untrack();
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
