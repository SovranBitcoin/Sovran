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
import AsyncStorage from '@react-native-async-storage/async-storage';

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
          await AsyncStorage.removeItem('swap-transactions-store');
          set({ groups: {}, quoteIdToGroup: {} });
        } catch (error) {
          console.error('SwapTransactionsStore: Error clearing data:', error);
          throw error;
        }
      },
    }),
    {
      name: 'swap-transactions-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        groups: state.groups,
        quoteIdToGroup: state.quoteIdToGroup,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('SwapTransactionsStore: Failed to rehydrate from storage:', error);
        }
      },
    }
  )
);
