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
  | 'pending'
  | 'redeeming'
  | 'redeemed'
  | 'spent'
  | 'untrusted-mint'
  | 'failed';

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
}

interface NutDropRedeemQueueState {
  byTokenHash: Record<string, NutDropRedeemEntry>;
}

interface NutDropRedeemQueueActions {
  /** Idempotent on token hash — mesh re-delivery never duplicates an entry. */
  enqueue: (
    tokenHash: string,
    entry: Pick<NutDropRedeemEntry, 'token' | 'mintUrl' | 'amount' | 'unit' | 'senderPeerID'>
  ) => boolean;
  markStatus: (tokenHash: string, status: NutDropRedeemStatus, error?: string) => void;
  scheduleRetry: (tokenHash: string, error: string) => void;
  prune: () => void;
}

type NutDropRedeemQueueStore = NutDropRedeemQueueState & NutDropRedeemQueueActions;

const ENTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
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

const PersistedNutDropRedeemQueueStore = z.object({
  byTokenHash: z
    .record(
      z.string().max(64),
      z.looseObject({
        token: z.string().min(1).max(60_000),
        mintUrl: z.string().min(1).max(2048),
        amount: z.number().int().nonnegative(),
        unit: z.string().max(16),
        status: z.enum(STATUS_VALUES),
        attempts: z.number().int().nonnegative(),
        nextAttemptAt: z.number().int().nonnegative(),
        receivedAt: z.number().int().nonnegative(),
        lastError: z.string().max(500).optional(),
        senderPeerID: z.string().max(128).optional(),
      })
    )
    .default({}),
});

function isTerminal(status: NutDropRedeemStatus): boolean {
  return status === 'redeemed' || status === 'spent' || status === 'failed';
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
        set((state) => ({
          byTokenHash: {
            ...state.byTokenHash,
            [tokenHash]: {
              ...existing,
              status: 'pending',
              attempts,
              nextAttemptAt: Date.now() + backoff,
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
              const ttl = isTerminal(entry.status) ? TERMINAL_TTL_MS : ENTRY_TTL_MS;
              return entry.receivedAt >= now - ttl;
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
