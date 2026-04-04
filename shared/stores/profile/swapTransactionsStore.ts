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
import { persist, createJSONStorage } from 'zustand/middleware';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { log, storeLog } from '@/shared/lib/logger';

const profileStorage = createProfileScopedStorage();

export type SwapGroupState = 'running' | 'finished' | 'cancelled';

export type SwapLegLocalStatus =
  | 'pending'
  | 'creatingInvoice'
  | 'invoiceReady'
  | 'melting'
  | 'verifying'
  | 'done'
  | 'failed';

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
  getGroupsForUnit: (unit: string) => SwapGroup[];
  getIndex: () => QuoteIdToGroupIndex;

  clearAllData: () => Promise<void>;
}

type SwapTransactionsStore = SwapTransactionsState & SwapTransactionsActions;

const generateGroupId = () => `swap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const generateLegId = () => `leg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const useSwapTransactionsStore = create<SwapTransactionsStore>()(
  persist(
    (set, get) => ({
      groups: {},
      quoteIdToGroup: {},

      startGroup: ({ unit, title }) => {
        const id = generateGroupId();
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
        const legId = generateLegId();
        storeLog.info('store.swap_tx.add_leg', { groupId, legId, fromMint: leg.fromMintUrl, toMint: leg.toMintUrl, amount: leg.amount });

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
          const group = state.groups[groupId];
          if (!group) return state;

          const legs = group.legs.map((leg) =>
            leg.id === legId ? { ...leg, mintQuoteId: quoteId } : leg
          );

          return {
            ...state,
            groups: {
              ...state.groups,
              [groupId]: { ...group, legs },
            },
            quoteIdToGroup: {
              ...state.quoteIdToGroup,
              [quoteId]: { groupId, legId, kind: 'mint' },
            },
          };
        });
      },

      tagMelt: (groupId, legId, { quoteId, operationId }) => {
        if (!quoteId) return;
        storeLog.debug('store.swap_tx.tag_melt', { groupId, legId, quoteId, operationId });

        set((state) => {
          const group = state.groups[groupId];
          if (!group) return state;

          const legs = group.legs.map((leg) =>
            leg.id === legId ? { ...leg, meltQuoteId: quoteId, meltOperationId: operationId } : leg
          );

          return {
            ...state,
            groups: {
              ...state.groups,
              [groupId]: { ...group, legs },
            },
            quoteIdToGroup: {
              ...state.quoteIdToGroup,
              [quoteId]: { groupId, legId, kind: 'melt' },
            },
          };
        });
      },

      setLegStatus: (groupId, legId, { localStatus, errorMessage }) => {
        storeLog.debug('store.swap_tx.set_leg_status', { groupId, legId, localStatus, errorMessage });
        set((state) => {
          const group = state.groups[groupId];
          if (!group) return state;

          const legs = group.legs.map((leg) => {
            if (leg.id !== legId) return leg;
            return {
              ...leg,
              localStatus,
              errorMessage:
                errorMessage ?? (localStatus === 'failed' ? leg.errorMessage : undefined),
            };
          });

          return {
            ...state,
            groups: {
              ...state.groups,
              [groupId]: { ...group, legs },
            },
          };
        });
      },

      getGroup: (groupId) => {
        return get().groups[groupId] ?? null;
      },

      getGroupsForUnit: (unit) => {
        const groups = Object.values(get().groups).filter((g) => g.unit === unit);
        return groups.sort((a, b) => b.createdAt - a.createdAt);
      },

      getIndex: () => get().quoteIdToGroup,

      clearAllData: async () => {
        try {
          await profileStorage.removeItem('swap-transactions-store');
          set({ groups: {}, quoteIdToGroup: {} });
        } catch (error) {
          log.error('store.swap_tx.clear_failed', { error });
          throw error;
        }
      },
    }),
    {
      name: 'swap-transactions-store',
      storage: createJSONStorage(() => createProfileScopedStorage()),
      partialize: (state) => ({
        groups: state.groups,
        quoteIdToGroup: state.quoteIdToGroup,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          log.warn('store.swap_tx.rehydrate_failed', { error });
        }
      },
    }
  )
);
