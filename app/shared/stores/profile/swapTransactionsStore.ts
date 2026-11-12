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

import { defineStore as create } from '@/shared/lib/persist/defineStore';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { mintLocalId } from '@/shared/lib/id';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { tolerantRecord } from '@/shared/lib/persist/tolerant';

type SwapGroupState = 'running' | 'finished' | 'cancelled';

/**
 * What a saved group can become next. A run ends its group once; a retry
 * reopens it as running and ends it again. Finished and cancelled never
 * replace each other.
 */
const GROUP_MOVES: Record<SwapGroupState, readonly SwapGroupState[]> = {
  running: ['finished', 'cancelled'],
  finished: ['running'],
  cancelled: ['running'],
};

export type SwapLegLocalStatus =
  | 'pending'
  | 'creatingInvoice'
  | 'invoiceReady'
  | 'melting'
  | 'verifying'
  /** The melt was sent and its outcome is not yet known. */
  | 'paymentPending'
  /** The melt settled; the destination mint has not issued yet. */
  | 'settling'
  | 'done'
  | 'failed';

/**
 * What a saved leg can become next, in the order the rebalance engine moves a
 * transfer (an invoice, then the melt, then the destination's mint) plus the
 * reconciler's moves from Coco's operations. Done is final. A failed leg goes
 * again only through a new attempt, which starts with a new invoice.
 */
const LEG_MOVES: Record<SwapLegLocalStatus, readonly SwapLegLocalStatus[]> = {
  pending: ['creatingInvoice', 'invoiceReady', 'melting', 'failed'],
  creatingInvoice: ['invoiceReady', 'failed'],
  // A melt whose inputs fell short is prepared again for a smaller invoice,
  // and paid from here: a leg left here with a melt settles from that melt.
  invoiceReady: ['melting', 'verifying', 'paymentPending', 'settling', 'failed'],
  melting: ['invoiceReady', 'verifying', 'paymentPending', 'settling', 'failed'],
  verifying: ['settling', 'done', 'failed'],
  paymentPending: ['settling', 'failed'],
  settling: ['done', 'failed'],
  done: [],
  failed: ['creatingInvoice'],
};

/** A leg status to save; an error message belongs to a failure only. */
export type SwapLegStatusUpdate =
  | { localStatus: 'failed'; errorMessage?: string }
  | { localStatus: Exclude<SwapLegLocalStatus, 'failed'> };

export interface SwapLeg {
  id: string;
  fromMintUrl: string;
  toMintUrl: string;
  amount: number;

  // Correlation / recovery ids
  mintQuoteId?: string;
  /** Coco's operation for this leg's mint quote; a settling leg is reconciled from it. */
  mintOperationId?: string;
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

/** Move one group along `GROUP_MOVES`; returns the original state when it cannot. */
function moveGroup(
  state: SwapTransactionsState,
  groupId: string,
  nextState: SwapGroupState
): SwapTransactionsState {
  const group = state.groups[groupId];
  if (!group || group.state === nextState) return state;
  if (!GROUP_MOVES[group.state].includes(nextState)) {
    storeLog.warn('store.swap_tx.group_move_refused', {
      groupId,
      from: group.state,
      to: nextState,
    });
    return state;
  }
  storeLog.info('store.swap_tx.move_group', { groupId, from: group.state, to: nextState });
  return { ...state, groups: { ...state.groups, [groupId]: { ...group, state: nextState } } };
}

interface SwapTransactionsActions {
  startGroup: (params: { unit: string; title?: string }) => string;
  /** End a running group; a group that already ended keeps its end. */
  finalizeGroup: (groupId: string, state: Exclude<SwapGroupState, 'running'>) => void;
  /** Mark an ended group running again, for a retry of its legs. */
  reopenGroup: (groupId: string) => void;

  addLeg: (
    groupId: string,
    leg: Omit<SwapLeg, 'id' | 'mintQuoteId' | 'meltQuoteId' | 'meltOperationId'>
  ) => string;

  tagMintQuote: (
    groupId: string,
    legId: string,
    params: { quoteId: string; operationId?: string }
  ) => void;
  tagMelt: (
    groupId: string,
    legId: string,
    params: { quoteId: string; operationId: string }
  ) => void;

  /** Move a leg along `LEG_MOVES`; a move the table does not list is refused. */
  setLegStatus: (groupId: string, legId: string, update: SwapLegStatusUpdate) => void;

  getGroup: (groupId: string) => SwapGroup | null;
}

type SwapTransactionsStore = SwapTransactionsState & SwapTransactionsActions;

// Persisted-shape schema (defensive rehydrate validation).
const SwapLegLocalStatusSchema = z
  .enum([
    'pending',
    'creatingInvoice',
    'invoiceReady',
    'melting',
    'verifying',
    'paymentPending',
    'settling',
    'done',
    'failed',
  ])
  .catch('failed');
const SwapGroupStateSchema = z.enum(['running', 'finished', 'cancelled']).catch('cancelled');

/** Longest leg error message kept. */
const MAX_ERROR_MESSAGE = 2048;

/** A leg's error message as saved: clipped to what the reader accepts. */
const clipErrorMessage = (message: string | undefined) => message?.slice(0, MAX_ERROR_MESSAGE);

const PersistedLeg = z.looseObject({
  id: z.string().max(128),
  fromMintUrl: z.string().max(2048),
  toMintUrl: z.string().max(2048),
  amount: z.number().int().nonnegative(),
  mintQuoteId: z.string().max(256).optional(),
  mintOperationId: z.string().max(256).optional(),
  meltQuoteId: z.string().max(256).optional(),
  meltOperationId: z.string().max(256).optional(),
  chainId: z.string().max(128).optional(),
  chainPath: z.array(z.string().max(2048)).max(16).optional(),
  chainHopIndex: z.number().int().nonnegative().optional(),
  localStatus: SwapLegLocalStatusSchema.optional(),
  // A message too long to read is read as absent: 0.1.3 saved it with no
  // limit, and rejecting it would discard every swap group and the quote
  // index. New messages are clipped by `clipErrorMessage`.
  errorMessage: z.string().max(MAX_ERROR_MESSAGE).optional().catch(undefined),
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

export const useSwapTransactionsStore = create<SwapTransactionsStore>({
  name: 'swap-transactions-store',
  scope: 'profile',
})(
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

      finalizeGroup: (groupId, nextState) => set((state) => moveGroup(state, groupId, nextState)),
      reopenGroup: (groupId) => set((state) => moveGroup(state, groupId, 'running')),

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

          const nextLeg: SwapLeg = {
            ...leg,
            id: legId,
            ...(leg.errorMessage !== undefined
              ? { errorMessage: clipErrorMessage(leg.errorMessage) }
              : {}),
          };
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

      tagMintQuote: (groupId, legId, { quoteId, operationId }) => {
        if (!quoteId) return;
        storeLog.debug('store.swap_tx.tag_mint_quote', { groupId, legId, quoteId });

        set((state) => {
          const next = patchLeg(state, groupId, legId, (leg) => ({
            ...leg,
            mintQuoteId: quoteId,
            ...(operationId ? { mintOperationId: operationId } : {}),
          }));
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

      setLegStatus: (groupId, legId, update) => {
        const { localStatus } = update;
        const errorMessage = update.localStatus === 'failed' ? update.errorMessage : undefined;
        storeLog.debug('store.swap_tx.set_leg_status', {
          groupId,
          legId,
          localStatus,
          errorMessage,
        });
        set((state) =>
          patchLeg(state, groupId, legId, (leg) => {
            const from = leg.localStatus;
            if (
              from !== undefined &&
              from !== localStatus &&
              !LEG_MOVES[from].includes(localStatus)
            ) {
              storeLog.warn('store.swap_tx.leg_move_refused', {
                groupId,
                legId,
                from,
                to: localStatus,
              });
              return leg;
            }
            return {
              ...leg,
              localStatus,
              errorMessage:
                clipErrorMessage(errorMessage) ??
                (localStatus === 'failed' ? leg.errorMessage : undefined),
            };
          })
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
