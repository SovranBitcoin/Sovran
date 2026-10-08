/**
 * @fileoverview Redeems ecash that arrives as a Nostr direct message.
 *
 * Mounted once per account, with no screen attached. On mount and on every
 * return to the foreground it runs one pass:
 *
 *  1. bring parked entries up to date (`reconcileParkedMessageEcash`);
 *  2. drain whatever the queue already holds, before touching the network
 *     inbox, so a token queued earlier is never held hostage to a relay;
 *  3. read the message inbox, one page per unit of work, hand each message
 *     to `intakeDmEcash`, and drain after every page that queued something.
 *
 * Live arrivals between passes go through step 3 for their one envelope.
 *
 * Nothing here decides how a token is redeemed. Mint trust, retry and the
 * receive itself belong to the queue's orchestrator, shared with Nut Drop: a
 * token from an untrusted mint is parked there, and surfaces on the wallet
 * home for the person to review (`ParkedMessageEcash`).
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { drainNutDropRedeemQueue } from '@/features/nearPay/lib/nutDropAutoRedeem';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { getActiveProfilePubkey } from '@/shared/lib/cashu/profileScopedStorage';
import { paymentLog, redactError } from '@/shared/lib/logger';
import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { nip04Cache } from '@/shared/lib/nostr/nip04Cache';
import { cashuP2pkPubkeyFromNostrHex } from '@/shared/lib/protocolIds';
import { isTokenSpent } from '@/shared/lib/routstr/spentProbe';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

import { decryptDmEnvelopes } from '../data/dmDecryptPipeline';
import { fetchDmEnvelopes, subscribeDmEnvelopesLive } from '../data/dmEnvelopeClient';
import type { DmEnvelopePage } from '../data/dmEnvelopeTypes';
import { createDmEnvelopeCursor, type DmEnvelopeCursor } from '../data/dmPagination';
import { intakeDmEcash, type DmEcashQueuePort } from '../lib/dmEcashIntake';
import { reconcileParkedMessageEcash } from '../lib/dmEcashRecovery';
import {
  hasDrainableMessageEcash,
  hasDueMessageEcash,
  nextMessageEcashRetryAt,
} from '../lib/parkedMessageEcash';

/** NIP-04 and NIP-17 gift wraps: the kinds the conversation list reads. */
const DM_KINDS = [4, 1059];
const PAGE_LIMIT = 50;
/**
 * Upper bound on pages read in one pass, so a pathological inbox is not read
 * without end. Hitting it is logged: an unread tail is never silent.
 */
const MAX_PAGES_PER_PASS = 40;
/** Past the recorded retry time by a hair, so the orchestrator sees it as due. */
const RETRY_SLACK_MS = 250;
/** How soon to look again after a drain left due work: quickly a few times, then slowly. */
const FOLLOW_UP_MS = 2_000;
const MAX_FOLLOW_UPS = 3;
const SLOW_FOLLOW_UP_MS = 30_000;
/**
 * NIP-59 dates a gift wrap up to two days in the past, and the inbox is
 * ordered by that date, so a wrap delivered a minute ago can sit below
 * messages already read. A walk therefore always reads back through this
 * window before a page of known messages is allowed to end it.
 */
const BACKDATING_WINDOW_SEC = 2 * 24 * 60 * 60 + 60 * 60;

const queuePort: DmEcashQueuePort = {
  has: (tokenHash) => tokenHash in useNutDropRedeemQueueStore.getState().byTokenHash,
  enqueue: (tokenHash, entry) => useNutDropRedeemQueueStore.getState().enqueue(tokenHash, entry),
  markSpent: (tokenHash) => useNutDropRedeemQueueStore.getState().markStatus(tokenHash, 'spent'),
  park: (tokenHash) =>
    useNutDropRedeemQueueStore.getState().markStatus(tokenHash, 'untrusted-mint'),
};

/** `null` when the wallet cannot be asked yet. */
async function probeTrusted(mintUrl: string): Promise<boolean | null> {
  if (!CocoManager.isInitialized()) return null;
  return CocoManager.getInstance().mint.isTrustedMint(mintUrl);
}

/** `null` when the wallet cannot be asked yet; the token is queued regardless. */
async function probeSpent(token: string): Promise<boolean | null> {
  if (!CocoManager.isInitialized()) return null;
  return isTokenSpent(CocoManager.getInstance(), token);
}

const restoreSettled = (status: string) => status === 'complete' || status === 'not-needed';

/**
 * True once the queue has been read from storage for the active profile.
 * Until then the store holds an empty default: a token queued into it would
 * be written over what is on disk, then dropped when the stored map loads.
 */
function useQueueHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const offStart = useNutDropRedeemQueueStore.persist.onHydrate(onChange);
      const offEnd = useNutDropRedeemQueueStore.persist.onFinishHydration(onChange);
      return () => {
        offStart();
        offEnd();
      };
    },
    () => useNutDropRedeemQueueStore.persist.hasHydrated(),
    () => false
  );
}

const queueEntries = () => useNutDropRedeemQueueStore.getState().byTokenHash;

function useDmEcashAutoRedeem(): void {
  const { keys } = useNostrKeysContext();
  const mockMode = useSettingsStore((s) => s.mockMode);
  // The live subscription is bound to the data layer it was opened on. A tier
  // switched on or off in Network settings builds a new layer, so the effect
  // re-runs and subscribes on that one.
  const tiers = useSettingsStore(
    (s) => `${s.naggTierEnabled}|${s.primalTierEnabled}|${s.relayTierEnabled}`
  );
  const pubkey = keys?.pubkey;
  const privateKey = keys?.privateKey;
  const queueReady = useQueueHydrated();
  const { isOffline } = useOfflineStatus();
  const wasOffline = useRef(isOffline);

  // Back online: a redeem that failed for want of a network is due again.
  useEffect(() => {
    const cameBack = wasOffline.current && !isOffline;
    wasOffline.current = isOffline;
    if (!cameBack || !queueReady || !hasDrainableMessageEcash(queueEntries())) return;
    drainNutDropRedeemQueue().catch((error: unknown) => {
      paymentLog.warn('payment.dm_ecash.pass_failed', {
        label: 'online',
        error: redactError(error),
      });
    });
  }, [isOffline, queueReady]);

  useEffect(() => {
    if (mockMode || !pubkey || !privateKey || !queueReady) return;
    const myPubkey33 = cashuP2pkPubkeyFromNostrHex(pubkey);
    let disposed = false;
    // Not only "still mounted": Delete All clears the profiles while this
    // provider can stay mounted with the keys it had, and a write then would
    // land in unscoped storage and bring the wiped tokens back. The queue is
    // only this wallet's while the stores are scoped to this profile.
    const stillCurrent = () => !disposed && getActiveProfilePubkey() === pubkey;
    // Envelope ids already handed to intake this session. Once one walk has
    // read the whole inbox, a later walk stops at the first page that holds
    // nothing new and lies past the backdating window, instead of rereading
    // all history on every foreground. Until then no page is skipped: an
    // earlier walk may have failed partway.
    const examined = new Set<string>();
    let walkedToEnd = false;
    let walking = false;
    // One unit of work at a time, and a unit is at most one page: a live
    // arrival waits for the page in hand, never for the rest of the history.
    let chain: Promise<void> = Promise.resolve();

    /** Returns how many tokens the page added to the queue. */
    const ingest = async (page: DmEnvelopePage): Promise<number> => {
      let queued = 0;
      for (const dm of decryptDmEnvelopes(page.envelopes, pubkey, privateKey)) {
        if (disposed) return queued;
        // One message at a time, each on its own: what a message holds is the
        // sender's choice, and a token naming a malformed mint must not stop
        // the messages after it, or the pages behind it, from being read.
        const outcome = await intakeDmEcash(dm, {
          myPubkey33,
          queue: queuePort,
          isTrustedMint: probeTrusted,
          isSpent: probeSpent,
          stillCurrent,
        }).catch((error: unknown) => {
          paymentLog.warn('payment.dm_ecash.intake_failed', { error: redactError(error) });
          return 'failed' as const;
        });
        if (outcome === 'queued') queued += 1;
      }
      return queued;
    };

    // A failed redeem is given a time to try again, and nothing else wakes
    // for it while the app stays open: this timer does.
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // The drainer runs one drain at a time and returns at once to a second
    // caller, whose token the running drain may never have seen. So when a
    // drain leaves a token that was due, look again shortly, a few times.
    let followUps = 0;
    const armRetry = () => {
      clearTimeout(retryTimer);
      if (disposed) return;
      const entries = queueEntries();
      if (hasDueMessageEcash(entries, Date.now())) {
        // A few quick looks, then a slow one for as long as work is due: the
        // drain in the way may be a long one, and going quiet would leave the
        // token waiting on the next message or foreground.
        const delay = followUps < MAX_FOLLOW_UPS ? FOLLOW_UP_MS : SLOW_FOLLOW_UP_MS;
        // Counted when it fires: arming twice before one fires is one look.
        retryTimer = setTimeout(() => {
          followUps += 1;
          run('follow-up', () => drainIfNeeded(false));
        }, delay);
        return;
      }
      followUps = 0;
      const dueAt = nextMessageEcashRetryAt(entries);
      if (dueAt === null) return;
      retryTimer = setTimeout(
        () => run('retry', () => drainIfNeeded(false)),
        Math.max(0, dueAt - Date.now()) + RETRY_SLACK_MS
      );
    };

    const drainIfNeeded = async (force: boolean) => {
      if (disposed) return;
      if (force || hasDrainableMessageEcash(queueEntries())) await drainNutDropRedeemQueue();
      armRetry();
    };

    const ingestAndDrain = async (page: DmEnvelopePage) => {
      const queued = await ingest(page);
      if (queued > 0) paymentLog.info('payment.dm_ecash.queued', { queued });
      await drainIfNeeded(queued > 0);
    };

    const run = (label: string, work: () => Promise<void>) => {
      chain = chain.then(work).catch((error: unknown) => {
        // The next pass or live arrival is the retry; queued tokens persist.
        paymentLog.warn('payment.dm_ecash.pass_failed', { label, error: redactError(error) });
      });
    };

    /** One page of the walk. Resolves true when another page should follow. */
    const readPage = async (cursor: DmEnvelopeCursor, pageIndex: number): Promise<boolean> => {
      const page = await fetchDmEnvelopes({
        viewer: pubkey,
        kinds: DM_KINDS,
        limit: PAGE_LIMIT,
        refresh: pageIndex === 0,
        ...(pageIndex > 0 ? { until: cursor.nextUntil() } : {}),
      });
      const unexamined = page.envelopes.filter((envelope) => !examined.has(envelope.id));
      // Redeem what this page brought before asking for the next one: a
      // later page failing must not hold back money already in hand.
      await ingestAndDrain(page);
      if (disposed) return false;
      for (const envelope of page.envelopes) examined.add(envelope.id);
      // A page that repeats the walk so far is a transport that ignores the
      // cursor (the relay tier returns the whole inbox every time).
      const advanced = cursor.track(page) > 0;

      if (!page.hasNextPage || !advanced || cursor.nextUntil() === undefined) {
        walkedToEnd = true;
        return false;
      }
      const pastBackdating = (cursor.nextUntil() ?? 0) < Date.now() / 1000 - BACKDATING_WINDOW_SEC;
      if (walkedToEnd && unexamined.length === 0 && pastBackdating) return false;
      if (pageIndex + 1 >= MAX_PAGES_PER_PASS) {
        // Treated as a full walk so later ones can stop early; the tail past
        // the cap is not read by this build.
        walkedToEnd = true;
        paymentLog.warn('payment.dm_ecash.backfill_capped', { pages: MAX_PAGES_PER_PASS });
        return false;
      }
      return true;
    };

    /** Each page is its own unit of work, queued behind whatever arrived live. */
    const walk = (cursor: DmEnvelopeCursor, pageIndex: number) => {
      walking = true;
      const page = async () => {
        if (disposed) return false;
        if (pageIndex === 0) {
          await Promise.all([giftWrapCache.cache.hydrate(pubkey), nip04Cache.hydrate(pubkey)]);
        }
        return readPage(cursor, pageIndex);
      };
      run('inbox', () =>
        page().then(
          (more) => {
            if (more) walk(cursor, pageIndex + 1);
            else walking = false;
          },
          (error: unknown) => {
            // The walk ends here; the next pass starts a new one.
            walking = false;
            throw error;
          }
        )
      );
    };

    const pass = () => {
      // Steps 1 and 2 are their own link in the chain: a relay that cannot be
      // reached fails step 3 only, after the durable queue has been served.
      run('recover', async () => {
        const requeued = await reconcileParkedMessageEcash(pubkey, stillCurrent);
        await drainIfNeeded(requeued);
      });
      // A walk in flight already starts from the newest message; the paging
      // boundary belongs to one walk, so each new walk gets its own cursor.
      if (!walking) walk(createDmEnvelopeCursor(), 0);
    };

    pass();
    const unsubscribe = subscribeDmEnvelopesLive(pubkey, (page) =>
      run('live', async () => {
        await ingestAndDrain(page);
        if (!disposed) for (const envelope of page.envelopes) examined.add(envelope.id);
      })
    );
    // The drainer does nothing while a wallet restore is pending, and this
    // hook mounts before the restore gate. Serve the queue when it settles.
    const unsubscribeRestore = useWalletLifecycleStore.subscribe((state, previous) => {
      if (restoreSettled(state.restoreStatus) && !restoreSettled(previous.restoreStatus)) {
        run('restored', () => drainIfNeeded(false));
      }
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') pass();
    });

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      unsubscribe();
      unsubscribeRestore();
      appState.remove();
    };
  }, [mockMode, pubkey, privateKey, tiers, queueReady]);
}

/** Account-scoped mount point; renders its children unchanged. */
export function DmEcashAutoRedeemProvider({ children }: { children: React.ReactNode }) {
  useDmEcashAutoRedeem();
  return children;
}
