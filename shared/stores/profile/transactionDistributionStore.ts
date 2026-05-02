/**
 * @fileoverview Store for the *outbound* distribution method of a transaction.
 *
 * For transactions where the user generated data and shared it with another
 * party (e.g. a Lightning mint quote where we display an invoice), the scan
 * history store does not apply — there is no incoming "scan" to record. This
 * store captures how the user *distributed* the data: tapped Copy, used the
 * share sheet (with iOS AirDrop detection), or — by inference — left the QR
 * visible on screen and let the other side scan it.
 *
 * **Key convention**: this store uses different keys per entry type so the
 * key is *deterministic* across every code path that might write or read it:
 *  - **mint entries**: keyed by `quoteId` (the lightning quote's stable id,
 *    available identically in screen-action ctx, coco event payloads, and
 *    persisted history rows)
 *  - **other types**: keyed by `historyEntry.id` (no current writers)
 *
 * Using `historyEntry.id` for mint entries was the original design and it
 * caused a silent first-write-wins failure: the screen-action override
 * wrote under the entry id from `useScreenActions` (which could be a
 * fallback `mintOp.id` if `executeMintQuote` timed out) while the global
 * `mint-op:quote-state-changed` subscription wrote under coco's persisted
 * row id, looked up via `quoteId`. The two ids didn't match, the guard
 * never engaged, and the inferred 'displayed' clobbered the real action.
 *
 * Both `useTransactionSource` (Transaction.tsx) and
 * `screenActionsBridge.getSourceLabel` (CocoPaymentUX.tsx) compute the
 * read key with the same convention.
 *
 * Lifecycle:
 *  - `setDistribution(key, source)` is **first-write-wins**. Once a real
 *    action ('copy' | 'share' | 'airdrop') is recorded, a later 'displayed'
 *    inference cannot overwrite it. This makes the inference a safe
 *    fallback rather than a clobber.
 *  - The 'displayed' fallback is written by a global subscription to coco's
 *    `mint-op:quote-state-changed` event in `CocoPaymentUX.tsx` when a quote
 *    transitions to PAID/ISSUED and no source has been recorded yet.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { redactError, storeLog } from '@/shared/lib/logger';
import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';

/**
 * Possible outbound-distribution sources for a transaction. These are
 * intentionally distinct from the inbound `ScanSource` ('qr' | 'nfc' |
 * 'paste' | 'deeplink') so the row can render a different icon for each.
 */
export type DistributionSource = 'copy' | 'share' | 'airdrop' | 'displayed';

export interface DistributionEntry {
  source: DistributionSource;
  recordedAt: number;
}

interface TransactionDistributionState {
  /** Map of historyEntry.id -> distribution entry */
  distributions: Record<string, DistributionEntry>;
}

interface TransactionDistributionActions {
  /**
   * Record the distribution method for a transaction. **First-write-wins**:
   * if an entry already exists for this key, the call is a no-op. This
   * protects real recorded actions ('copy' | 'share' | 'airdrop') from
   * being overwritten by the later 'displayed' inference.
   *
   * `key` is the per-type identifier — see the file-level JSDoc. For mint
   * entries pass `quoteId`, for everything else pass `historyEntry.id`.
   */
  setDistribution: (key: string, source: DistributionSource) => void;
  /** Get the distribution entry for a key, or null. */
  getDistribution: (key: string) => DistributionEntry | null;
}

type TransactionDistributionStore = TransactionDistributionState & TransactionDistributionActions;

const PersistedTransactionDistributionStore = z.object({
  distributions: z
    .record(
      z.string().max(256),
      z.looseObject({
        source: z.enum(['copy', 'share', 'airdrop', 'displayed']),
        recordedAt: z.number().int().nonnegative(),
      })
    )
    .default({}),
});

export const useTransactionDistributionStore = create<TransactionDistributionStore>()(
  persist(
    (set, get) => ({
      // Initial state
      distributions: {},

      // Actions
      setDistribution: (key: string, source: DistributionSource) => {
        const existing = get().distributions[key];
        if (existing) {
          // First-write-wins: do not overwrite a real action with a later
          // inference (or with a duplicate of the same action).
          storeLog.debug('store.tx_distribution.set.skipped', {
            key,
            source,
            existingSource: existing.source,
          });
          return;
        }
        storeLog.debug('store.tx_distribution.set', { key, source });
        set((state) => ({
          distributions: {
            ...state.distributions,
            [key]: {
              source,
              recordedAt: Date.now(),
            },
          },
        }));
      },

      getDistribution: (key: string) => {
        return get().distributions[key] ?? null;
      },
    }),
    {
      name: 'transaction-distribution-store',
      storage: createJSONStorage(() => createProfileScopedStorage()),
      version: 1,
      partialize: (state) => ({
        distributions: state.distributions,
      }),
      migrate: (state, _version) => state,
      merge: createMergeWithSchema('tx_distribution', PersistedTransactionDistributionStore),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          storeLog.warn('store.tx_distribution.rehydrate_failed', { error: redactError(error) });
        }
      },
    }
  )
);
