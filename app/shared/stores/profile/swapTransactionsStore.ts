/**
 * @fileoverview Swap Transactions Store
 *
 * Tracks swap groups (e.g. rebalance runs) that consist of multiple legs.
 * Each leg is correlated to underlying Coco mint/melt history entries via quoteId.
 *
 * Coco remains the source of truth for HistoryEntry creation; this store only
 * keeps enough metadata to:
 * - hide child mint/melt entries in the Transactions list
 * - insert a synthetic grouped "Swap" transaction
 * - show a detail view with per-leg local status/errors
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { mintLocalId } from '@/shared/lib/id';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { tolerantRecord } from '@/shared/lib/persist/tolerant';

type SwapGroupState = 'running' | 'finished' | 'cancelled';

export type SwapLegLocalStatus =
  'pending' | 'creatingInvoice' | 'invoiceReady' | 'melting' | 'verifying' | 'done' | 'failed';

export interface SwapLeg {
  id: string;
  fromMintUrl: string;
  toMintUrl: string;
  amount: number;

  // Correlation / recovery ids
  mintQuoteId?: string;
  meltQuoteId?: string;
  meltOperationId?: string;

  // Middleman chain metadata (set when routing through intermediary)
  chainId?: string;
  /** Full ordered path of mint URLs: [source, via1, via2, ..., destination]. */
  chainPath?: string[];
  /** 0-based index of this leg's hop within the chain. */
  chainHopIndex?: number;

  // UI state (local)
  localStatus?: SwapLegLocalStatus;
  errorMessage?: string;
}

export interface SwapGroup {
  id: string;
  unit: string;
  createdAt: number;
  title: string;
  state: SwapGroupState;
  legs: SwapLeg[];
}

type QuoteIdKind = 'mint' | 'melt';

type QuoteIdToGroupIndex = Record<string, { groupId: string; legId: string; kind: QuoteIdKind }>;

interface SwapTransactionsState {
  groups: Record<string, SwapGroup>;
  quoteIdToGroup: QuoteIdToGroupIndex;
}

/**
 * Replace one leg inside one group. Every leg-level action needs the same
 * three-level immutable rewrite (state → groups → legs) and the same
 * "silently do nothing if the group is gone" guard; each was carrying its own
 * copy, so a fix to the guard only ever reached one of them. Returns the
 * ORIGINAL state object when there is nothing to patch, so callers can detect
 * a no-op by identity.
 */
function patchLeg(
  state: SwapTransactionsState,
  groupId: string,
  legId: string,
  patch: (leg: SwapLeg) => SwapLeg
): SwapTransactionsState {
  const group = state.groups[groupId];
  if (!group) return state;
  return {
    ...state,
    groups: {
      ...state.groups,
      [groupId]: {
        ...group,
        legs: group.legs.map((leg) => (leg.id === legId ? patch(leg) : leg)),
      },
    },
  };
}

interface SwapTransactionsActions {
  startGroup: (params: { unit: string; title?: string }) => string;
  finalizeGroup: (groupId: string, state: Exclude<SwapGroupState, 'running'>) => void;

  addLeg: (
    groupId: string,
    leg: Omit<SwapLeg, 'id' | 'mintQuoteId' | 'meltQuoteId' | 'meltOperationId'>
  ) => string;

  tagMintQuote: (groupId: string, legId: string, quoteId: string) => void;
  tagMelt: (
    groupId: string,
    legId: string,
    params: { quoteId: string; operationId: string }
  ) => void;

  setLegStatus: (
    groupId: string,
    legId: string,
    params: { localStatus: SwapLegLocalStatus; errorMessage?: string }
  ) => void;

  getGroup: (groupId: string) => SwapGroup | null;
}

type SwapTransactionsStore = SwapTransactionsState & SwapTransactionsActions;

// Persisted-shape schema (defensive rehydrate validation).
const SwapLegLocalStatusSchema = z
  .enum(['pending', 'creatingInvoice', 'invoiceReady', 'melting', 'verifying', 'done', 'failed'])
  .catch('failed');
const SwapGroupStateSchema = z.enum(['running', 'finished', 'cancelled']).catch('cancelled');

const PersistedLeg = z.looseObject({
  id: z.string().max(128),
  fromMintUrl: z.string().max(2048),
  toMintUrl: z.string().max(2048),
  amount: z.number().int().nonnegative(),
  mintQuoteId: z.string().max(256).optional(),
  meltQuoteId: z.string().max(256).optional(),
  meltOperationId: z.string().max(256).optional(),
  chainId: z.string().max(128).optional(),
  chainPath: z.array(z.string().max(2048)).max(16).optional(),
  chainHopIndex: z.number().int().nonnegative().optional(),
  localStatus: SwapLegLocalStatusSchema.optional(),
  errorMessage: z.string().max(2048).optional(),
});

const PersistedSwapGroup = z.looseObject({
  id: z.string().max(128),
  unit: z.string().max(16),
  createdAt: z.number().int().nonnegative(),
  title: z.string().max(512),
  state: SwapGroupStateSchema,
  legs: z.array(PersistedLeg).max(256),
});

const PersistedQuoteIndexEntry = z.looseObject({
  groupId: z.string().max(128),
  legId: z.string().max(128),
  // Deliberately bare: `kind` is funds-flow direction and must never be
  // guessed; the per-entry safeParse below already drops just the bad row
  // instead of the blob, so hard-reject is the safe failure.
  // ast-grep-ignore: persisted-enum-needs-catch
  kind: z.enum(['mint', 'melt']),
});

const PersistedQuoteIndex = tolerantRecord(z.string().max(256), PersistedQuoteIndexEntry);

const PersistedSwapStore = z.object({
  groups: z.record(z.string().max(128), PersistedSwapGroup).default({}),
  // A future/unknown index entry cannot safely be guessed as mint or melt.
  // Drop only that derived correlation; the swap groups themselves remain
  // available for recovery and the rest of the quote index stays intact.
  quoteIdToGroup: PersistedQuoteIndex,
});

export const useSwapTransactionsStore = create<SwapTransactionsStore>()(
  persist(
    (set, get) => ({
      groups: {},
      quoteIdToGroup: {},

      startGroup: ({ unit, title }) => {
        const id = mintLocalId('swap');
        storeLog.info('store.swap_tx.start_group', { id, unit, title });
        const group: SwapGroup = {
          id,
          unit,
          createdAt: Date.now(),
          title: title ?? 'Swap',
          state: 'running',
          legs: [],
        };

        set((state) => ({
          groups: { ...state.groups, [id]: group },
        }));

        return id;
      },

      finalizeGroup: (groupId, nextState) => {
        storeLog.info('store.swap_tx.finalize_group', { groupId, nextState });
        set((state) => {
          const group = state.groups[groupId];
          if (!group) return state;
          return {
            ...state,
            groups: {
              ...state.groups,
              [groupId]: { ...group, state: nextState },
            },
          };
        });
      },

      addLeg: (groupId, leg) => {
        const legId = mintLocalId('leg');
        storeLog.info('store.swap_tx.add_leg', {
          groupId,
          legId,
          fromMint: leg.fromMintUrl,
          toMint: leg.toMintUrl,
          amount: leg.amount,
        });

        set((state) => {
          const group = state.groups[groupId];
          if (!group) return state;

          const nextLeg: SwapLeg = { ...leg, id: legId };
          return {
            ...state,
            groups: {
              ...state.groups,
              [groupId]: { ...group, legs: [...group.legs, nextLeg] },
            },
          };
        });

        return legId;
      },

      tagMintQuote: (groupId, legId, quoteId) => {
        if (!quoteId) return;
        storeLog.debug('store.swap_tx.tag_mint_quote', { groupId, legId, quoteId });

        set((state) => {
          const next = patchLeg(state, groupId, legId, (leg) => ({ ...leg, mintQuoteId: quoteId }));
          if (next === state) return state;
          return {
            ...next,
            quoteIdToGroup: {
              ...next.quoteIdToGroup,
              [quoteId]: { groupId, legId, kind: 'mint' },
            },
          };
        });
      },

      tagMelt: (groupId, legId, { quoteId, operationId }) => {
        if (!quoteId) return;
        storeLog.debug('store.swap_tx.tag_melt', { groupId, legId, quoteId, operationId });

        set((state) => {
          const next = patchLeg(state, groupId, legId, (leg) => ({
            ...leg,
            meltQuoteId: quoteId,
            meltOperationId: operationId,
          }));
          if (next === state) return state;
          return {
            ...next,
            quoteIdToGroup: {
              ...next.quoteIdToGroup,
              [quoteId]: { groupId, legId, kind: 'melt' },
            },
          };
        });
      },

      setLegStatus: (groupId, legId, { localStatus, errorMessage }) => {
        storeLog.debug('store.swap_tx.set_leg_status', {
          groupId,
          legId,
          localStatus,
          errorMessage,
        });
        set((state) =>
          patchLeg(state, groupId, legId, (leg) => ({
            ...leg,
            localStatus,
            errorMessage: errorMessage ?? (localStatus === 'failed' ? leg.errorMessage : undefined),
          }))
        );
      },

      getGroup: (groupId) => {
        return get().groups[groupId] ?? null;
      },
    }),
    persistConfig({
      name: 'swap-transactions-store',
      storage: createProfileScopedStorage(),
      schema: PersistedSwapStore,
      logKey: 'swap_tx',
      partialize: (state) => ({
        groups: state.groups,
        quoteIdToGroup: state.quoteIdToGroup,
      }),
    })
  )
);
