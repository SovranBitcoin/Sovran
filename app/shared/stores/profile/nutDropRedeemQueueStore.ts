import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

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
type NutDropRedeemStatus =
  'pending' | 'redeeming' | 'redeemed' | 'spent' | 'untrusted-mint' | 'failed';

interface NutDropRedeemEntry {
  token: string;
  mintUrl: string;
  amount: number;
  unit: string;
  status: NutDropRedeemStatus;
  attempts: number;
  /** UNIX ms — drainer skips entries whose backoff window hasn't elapsed. */
  nextAttemptAt: number;
  receivedAt: number;
  lastError?: string;
  /**
   * 16-hex BLE peer ID of the mesh sender — drives the NearPay lightning
   * effect on that peer's avatar while the entry redeems. Optional:
   * additive field, entries persisted by older builds lack it.
   */
  senderPeerID?: string;
  /**
   * NUT-18 payment id when the token arrived as an in-band mesh payment —
   * lets the drain push the `redeemed` status back to the sender. Absent
   * for public-broadcast drops.
   */
  paymentId?: string;
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
}

interface NutDropRedeemQueueActions {
  /** Idempotent on token hash — mesh re-delivery never duplicates an entry. */
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
    >
  ) => boolean;
  markStatus: (tokenHash: string, status: NutDropRedeemStatus, error?: string) => void;
  scheduleRetry: (tokenHash: string, error: string) => void;
  /**
   * Put a parked entry (`untrusted-mint`, `failed`) back in line with a clean
   * attempt count: its mint has since been trusted, or the person asked to try
   * again. A terminal entry is never requeued.
   */
  requeue: (tokenHash: string) => void;
  prune: () => void;
}

type NutDropRedeemQueueStore = NutDropRedeemQueueState & NutDropRedeemQueueActions;

/** Terminal entries only need to survive long enough to dedupe re-delivery. */
const TERMINAL_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;

const STATUS_VALUES = [
  'pending',
  'redeeming',
  'redeemed',
  'spent',
  'untrusted-mint',
  'failed',
] as const;

/**
 * The stored limits a queued entry must fit. One entry over a limit fails the
 * whole blob's parse on the next launch and takes every other queued token
 * with it, so a writer checks these before it enqueues.
 */
export const NUT_DROP_QUEUE_LIMITS = {
  tokenHash: 64,
  token: 60_000,
  mintUrl: 2048,
  unit: 16,
} as const;

const PersistedNutDropRedeemQueueStore = z.object({
  byTokenHash: z
    .record(
      z.string().max(NUT_DROP_QUEUE_LIMITS.tokenHash),
      z.looseObject({
        token: z.string().min(1).max(NUT_DROP_QUEUE_LIMITS.token),
        mintUrl: z.string().min(1).max(NUT_DROP_QUEUE_LIMITS.mintUrl),
        amount: z.number().int().nonnegative(),
        unit: z.string().max(NUT_DROP_QUEUE_LIMITS.unit),
        // Forward-compatible persisted status: an older build that opens a
        // queue written by a newer build must keep the locked ecash and retry
        // it, not reject the whole profile-scoped blob. Mint redemption is
        // idempotent, so `pending` is the funds-safe fallback.
        status: z.enum(STATUS_VALUES).default('pending').catch('pending'),
        attempts: z.number().int().nonnegative(),
        nextAttemptAt: z.number().int().nonnegative(),
        receivedAt: z.number().int().nonnegative(),
        lastError: z.string().max(500).optional(),
        senderPeerID: z.string().max(128).optional(),
        paymentId: z.string().max(128).optional(),
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
});

function isTerminal(status: NutDropRedeemStatus): boolean {
  return status === 'redeemed' || status === 'spent';
}

export const useNutDropRedeemQueueStore = create<NutDropRedeemQueueStore>()(
  persist(
    (set, get) => ({
      byTokenHash: {},

      enqueue: (tokenHash, entry) => {
        if (get().byTokenHash[tokenHash]) return false;
        storeLog.info('store.nut_drop_queue.enqueue', {
          tokenHash: tokenHash.slice(0, 12),
          mintUrl: entry.mintUrl,
          amount: entry.amount,
        });
        set((state) => ({
          byTokenHash: {
            ...state.byTokenHash,
            [tokenHash]: {
              ...entry,
              status: 'pending',
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
        if (!existing) return;
        storeLog.info('store.nut_drop_queue.status', {
          tokenHash: tokenHash.slice(0, 12),
          status,
          error,
        });
        set((state) => ({
          byTokenHash: {
            ...state.byTokenHash,
            [tokenHash]: { ...existing, status, ...(error ? { lastError: error } : {}) },
          },
        }));
      },

      requeue: (tokenHash) => {
        const existing = get().byTokenHash[tokenHash];
        if (!existing || isTerminal(existing.status)) return;
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

      scheduleRetry: (tokenHash, error) => {
        const existing = get().byTokenHash[tokenHash];
        if (!existing) return;
        const attempts = existing.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          storeLog.warn('store.nut_drop_queue.exhausted', {
            tokenHash: tokenHash.slice(0, 12),
            attempts,
            error,
          });
          set((state) => ({
            byTokenHash: {
              ...state.byTokenHash,
              [tokenHash]: { ...existing, status: 'failed', attempts, lastError: error },
            },
          }));
          return;
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
              lastError: error,
            },
          },
        }));
      },

      prune: () => {
        const now = Date.now();
        set((state) => ({
          byTokenHash: Object.fromEntries(
            Object.entries(state.byTokenHash).filter(([, entry]) => {
              // Retry exhaustion and age do not prove that ecash was spent.
              return !isTerminal(entry.status) || entry.receivedAt >= now - TERMINAL_TTL_MS;
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
      }),
    })
  )
);
