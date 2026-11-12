import { defineStore as create } from '@/shared/lib/persist/defineStore';
import { persist } from 'zustand/middleware';
import {
  canMeshRedeemMove,
  isMeshRedeemSettled,
  MESH_REDEEM_MAX_ATTEMPTS,
  MESH_REDEEM_STATUSES,
  meshRedeemPhase,
  type MeshRedeemArrival,
  type MeshRedeemEntry,
  type MeshRedeemMove,
  type MeshRedeemStatus,
} from 'wallet/redeemEntry';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { activePubkey } from '@/shared/stores/global/profileStore';

/**
 * Persisted queue of P2PK-locked Nut Drop tokens awaiting redemption.
 *
 * Tokens are enqueued the moment a locked-to-me mesh message arrives (before
 * any network call) so a backgrounded/killed app can never lose a drop — the
 * drainer retries on foreground, on connectivity, and after manager init.
 * Profile-scoped: a drop locked to profile A must never be redeemed while
 * profile B is active (it couldn't sign anyway — A's key is not in B's coco
 * keyring — but the queue must not bleed either).
 *
 * Tokens here are P2PK-locked, so a leaked store file is not spendable by
 * anyone but this profile's key — still treated as wallet-adjacent data.
 */
interface NutDropRedeemEntry extends MeshRedeemEntry {
  /**
   * How the token reached us. Absent means `ble` (every entry written before
   * this field existed came over the mesh). A `nostr` entry arrived as a
   * direct message while online, so it is received like any pasted token: the
   * mint's swap is the verification, and the offline-proof requirement that
   * guards mesh drops does not apply.
   */
  source?: RedeemSource;
  /** Hex pubkey of the Nostr sender, for the history row's counterparty. */
  senderPubkey?: string;
}

const REDEEM_SOURCES = ['ble', 'nostr'] as const;
type RedeemSource = (typeof REDEEM_SOURCES)[number];

interface NutDropRedeemQueueState {
  byTokenHash: Record<string, NutDropRedeemEntry>;
  /** Which set-aside copy of this queue was last merged back in, if any. */
  recoveredCopy: string | null;
}

interface NutDropRedeemQueueActions {
  /**
   * Adds a new entry, as `status` (in line unless the caller already knows
   * better). Idempotent on token hash: re-delivery never duplicates an entry,
   * and a token already queued keeps its entry, status and all. True only
   * when this call created the entry.
   */
  enqueue: (
    tokenHash: string,
    entry: Pick<
      NutDropRedeemEntry,
      | 'token'
      | 'mintUrl'
      | 'amount'
      | 'unit'
      | 'senderPeerID'
      | 'paymentId'
      | 'source'
      | 'senderPubkey'
    >,
    status?: MeshRedeemArrival
  ) => boolean;
  /**
   * True when recorded. Refused, and logged, when the entry's status is not
   * one the move may start from.
   */
  markStatus: (
    tokenHash: string,
    status: Exclude<MeshRedeemStatus, 'pending'>,
    error?: string
  ) => boolean;
  /** The status recorded (in line again, or failed once out of attempts), or null when refused. */
  scheduleRetry: (tokenHash: string, error: string) => 'pending' | 'failed' | null;
  /**
   * Put a parked entry (`untrusted-mint`, `failed`) back in line with a clean
   * attempt count: its mint has since been trusted, or the person asked to try
   * again. Any other entry is left as it is.
   */
  requeue: (tokenHash: string) => void;
  /**
   * Close a held entry (`untrusted-mint`, `failed`) whose token was found
   * spent. Any other entry is left as it is: one back in line is the drain's.
   */
  markHeldSpent: (tokenHash: string) => void;
  prune: () => void;
}

type NutDropRedeemQueueStore = NutDropRedeemQueueState & NutDropRedeemQueueActions;

/** Terminal entries only need to survive long enough to dedupe re-delivery. */
const TERMINAL_TTL_MS = 24 * 60 * 60 * 1000;
const BASE_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;

/**
 * The limits a new entry must fit before it is queued. They hold for writes
 * only: the reader takes a token, mint address and unit of any length, since
 * 0.1.3's Bluetooth listener queued them unchecked and they are money.
 */
export const NUT_DROP_QUEUE_LIMITS = {
  tokenHash: 64,
  token: 60_000,
  mintUrl: 2048,
  unit: 16,
  lastError: 500,
} as const;

/**
 * Whether a new entry fits the limits. The one check every writer makes before
 * it enqueues, and `enqueue` makes again: an entry the reader of an older
 * release could not hold would fail that release's whole queue.
 */
export function fitsNutDropQueue(
  tokenHash: string,
  entry: { token: string; mintUrl: string; unit: string; amount: number }
): boolean {
  return (
    tokenHash.length <= NUT_DROP_QUEUE_LIMITS.tokenHash &&
    entry.token.length <= NUT_DROP_QUEUE_LIMITS.token &&
    entry.mintUrl.length <= NUT_DROP_QUEUE_LIMITS.mintUrl &&
    entry.unit.length <= NUT_DROP_QUEUE_LIMITS.unit &&
    Number.isSafeInteger(entry.amount) &&
    entry.amount >= 0
  );
}

/** An error as the queue stores it. A mint or proxy can answer with a whole
 *  page, and one entry past its limit fails the stored queue on next launch. */
const clipError = (error: string) => error.slice(0, NUT_DROP_QUEUE_LIMITS.lastError);

/**
 * The reader. Every entry that holds a token loads, byte for byte: `token`,
 * `mintUrl` and `unit` have no length limit here (0.1.3's Bluetooth listener
 * saved them unchecked), and an error, peer id or payment id over its limit or
 * of the wrong type reads as absent for that entry alone; none is needed to
 * redeem.
 *
 * There is deliberately no per-entry tolerance that drops an entry. An entry
 * with no usable token or mint address, or with a broken amount, attempt count
 * or time (only this store's own code writes those), still fails the whole
 * blob, which is then kept whole at `<name>:unreadable` until a release that
 * can read it folds it back in (`recoverUnreadable` below). Dropping it
 * instead would lose, without trace, whatever it still held.
 */
const PersistedNutDropRedeemQueueStore = z.object({
  byTokenHash: z
    .record(
      z.string().max(NUT_DROP_QUEUE_LIMITS.tokenHash),
      z.looseObject({
        token: z.string().min(1),
        mintUrl: z.string().min(1),
        amount: z.number().int().nonnegative(),
        unit: z.string(),
        // Forward-compatible persisted status: an older build that opens a
        // queue written by a newer build must keep the locked ecash and retry
        // it, not reject the whole profile-scoped blob. Mint redemption is
        // idempotent, so `pending` is the funds-safe fallback.
        status: z.enum(MESH_REDEEM_STATUSES).default('pending').catch('pending'),
        attempts: z.number().int().nonnegative(),
        nextAttemptAt: z.number().int().nonnegative(),
        receivedAt: z.number().int().nonnegative(),
        lastError: z.string().max(NUT_DROP_QUEUE_LIMITS.lastError).optional().catch(undefined),
        senderPeerID: z.string().max(128).optional().catch(undefined),
        paymentId: z.string().max(128).optional().catch(undefined),
        // Additive and tolerant: an unknown source from a newer build reads as
        // absent (the mesh default, the stricter path), never a rejected blob.
        source: z.enum(REDEEM_SOURCES).optional().catch(undefined),
        senderPubkey: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional()
          .catch(undefined),
      })
    )
    .default({}),
  // Additive: absent on every released blob. Says which set-aside copy has
  // been merged, so it is never merged twice.
  recoveredCopy: z.string().max(128).nullable().default(null).catch(null),
});

const isSettled = (entry: NutDropRedeemEntry) => isMeshRedeemSettled(meshRedeemPhase(entry));

/** Whether `move` may start from the entry's status; a refusal is logged. */
function allowsMove(tokenHash: string, entry: NutDropRedeemEntry, move: MeshRedeemMove): boolean {
  if (canMeshRedeemMove(entry.status, move)) return true;
  storeLog.warn('store.nut_drop_queue.move_refused', {
    tokenHash: tokenHash.slice(0, 12),
    from: entry.status,
    move,
  });
  return false;
}

export const useNutDropRedeemQueueStore = create<NutDropRedeemQueueStore>({
  name: 'nut-drop-redeem-queue',
  scope: 'profile',
})(
  persist(
    (set, get) => ({
      byTokenHash: {},
      recoveredCopy: null,

      enqueue: (tokenHash, entry, status = 'pending') => {
        if (get().byTokenHash[tokenHash]) return false;
        if (!fitsNutDropQueue(tokenHash, entry)) {
          storeLog.warn('store.nut_drop_queue.enqueue_refused', {
            tokenHash: tokenHash.slice(0, 12),
            reason: 'over_limit',
          });
          return false;
        }
        storeLog.info('store.nut_drop_queue.enqueue', {
          tokenHash: tokenHash.slice(0, 12),
          mintUrl: entry.mintUrl,
          amount: entry.amount,
          status,
        });
        set((state) => ({
          byTokenHash: {
            ...state.byTokenHash,
            [tokenHash]: {
              ...entry,
              status,
              attempts: 0,
              nextAttemptAt: 0,
              receivedAt: Date.now(),
            },
          },
        }));
        return true;
      },

      markStatus: (tokenHash, status, error) => {
        const existing = get().byTokenHash[tokenHash];
        if (!existing || !allowsMove(tokenHash, existing, status)) return false;
        storeLog.info('store.nut_drop_queue.status', {
          tokenHash: tokenHash.slice(0, 12),
          status,
          error,
        });
        // A received token keeps no error from an attempt before it; any
        // other keeps what it has, as saved, unless this move brings one.
        const { lastError: _lastError, ...withoutError } = existing;
        const kept = status === 'redeemed' ? withoutError : existing;
        set((state) => ({
          byTokenHash: {
            ...state.byTokenHash,
            [tokenHash]: { ...kept, status, ...(error ? { lastError: clipError(error) } : {}) },
          },
        }));
        return true;
      },

      requeue: (tokenHash) => {
        const existing = get().byTokenHash[tokenHash];
        if (!existing || !allowsMove(tokenHash, existing, 'requeue')) return;
        storeLog.info('store.nut_drop_queue.requeue', {
          tokenHash: tokenHash.slice(0, 12),
          from: existing.status,
        });
        const { lastError: _lastError, ...rest } = existing;
        set((state) => ({
          byTokenHash: {
            ...state.byTokenHash,
            [tokenHash]: { ...rest, status: 'pending', attempts: 0, nextAttemptAt: 0 },
          },
        }));
      },

      markHeldSpent: (tokenHash) => {
        const existing = get().byTokenHash[tokenHash];
        if (!existing || !allowsMove(tokenHash, existing, 'held-spent')) return;
        storeLog.info('store.nut_drop_queue.status', {
          tokenHash: tokenHash.slice(0, 12),
          status: 'spent',
          from: existing.status,
        });
        set((state) => ({
          byTokenHash: { ...state.byTokenHash, [tokenHash]: { ...existing, status: 'spent' } },
        }));
      },

      scheduleRetry: (tokenHash, error) => {
        const existing = get().byTokenHash[tokenHash];
        if (!existing || !allowsMove(tokenHash, existing, 'retry')) return null;
        const attempts = existing.attempts + 1;
        if (attempts >= MESH_REDEEM_MAX_ATTEMPTS) {
          storeLog.warn('store.nut_drop_queue.exhausted', {
            tokenHash: tokenHash.slice(0, 12),
            attempts,
            error,
          });
          set((state) => ({
            byTokenHash: {
              ...state.byTokenHash,
              [tokenHash]: { ...existing, status: 'failed', attempts, lastError: clipError(error) },
            },
          }));
          return 'failed';
        }
        const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
        const nextAttemptAt = Date.now() + backoff;
        storeLog.info('store.nut_drop_queue.retry_scheduled', {
          tokenHash: tokenHash.slice(0, 12),
          attempts,
          backoffMs: backoff,
          nextAttemptAt,
          error,
        });
        set((state) => ({
          byTokenHash: {
            ...state.byTokenHash,
            [tokenHash]: {
              ...existing,
              status: 'pending',
              attempts,
              nextAttemptAt,
              lastError: clipError(error),
            },
          },
        }));
        return 'pending';
      },

      prune: () => {
        const now = Date.now();
        set((state) => ({
          byTokenHash: Object.fromEntries(
            Object.entries(state.byTokenHash).filter(([, entry]) => {
              // Retry exhaustion and age do not prove that ecash was spent.
              return !isSettled(entry) || entry.receivedAt >= now - TERMINAL_TTL_MS;
            })
          ),
        }));
      },
    }),
    persistConfig({
      name: 'nut-drop-redeem-queue',
      storage: createProfileScopedStorage(),
      schema: PersistedNutDropRedeemQueueStore,
      logKey: 'nut_drop_queue',
      partialize: (state) => ({
        byTokenHash: state.byTokenHash,
        recoveredCopy: state.recoveredCopy,
      }),
      // A queue an earlier build set aside (one entry over its read limits)
      // holds tokens waiting to be redeemed. Folded back in by token hash; an
      // entry already queued wins, so its status is never rolled back.
      recoverUnreadable: {
        owner: activePubkey,
        merge: (recovered, copyId): NutDropRedeemQueueStore => {
          const state = useNutDropRedeemQueueStore.getState();
          return {
            ...state,
            byTokenHash: { ...recovered.byTokenHash, ...state.byTokenHash },
            recoveredCopy: copyId,
          };
        },
        apply: (recovered, copyId) => {
          useNutDropRedeemQueueStore.setState((state: NutDropRedeemQueueState) => ({
            byTokenHash: { ...recovered.byTokenHash, ...state.byTokenHash },
            recoveredCopy: copyId,
          }));
        },
        merged: (saved, copyId) => saved.recoveredCopy === copyId,
        // A redeemed or spent entry holds no money, and `prune` may already
        // have removed it; every other one must be saved before the copy goes.
        holds: (saved, recovered, copyId) =>
          saved.recoveredCopy === copyId &&
          Object.entries(recovered.byTokenHash).every(
            ([hash, entry]) => isSettled(entry) || saved.byTokenHash[hash]?.token === entry.token
          ),
      },
    })
  )
);
