/**
 * @fileoverview Split-Bill Transactions Store
 *
 * Tracks "split-bill groups" — meta-transactions where the user asks N people
 * to pay their share of a total amount. Each participant gets their own
 * BOLT11 Lightning mint-quote (minting into the user's wallet) and is
 * optionally delivered via a channel that matches the source:
 *   - `source: 'nostr'`  → NIP-17 gift-wrap DM with the BOLT11
 *   - `source: 'ble'`    → bitchat Noise-encrypted private message
 *   - `source: 'search'` → QR-only fallback (shown in detail screen)
 *
 * Mirrors the `SwapGroup`/`SwapLeg` pattern in `swapTransactionsStore.ts` —
 * child mint entries are correlated via `quoteIdToSplitBill` so the
 * Transactions list can hide them in favour of a single meta-row.
 *
 * Coco's `HistoryEntry` is the source of truth for actual mint state; this
 * store only holds enough metadata to:
 *   - hide child mint entries in the Transactions list
 *   - render a synthetic "Split bill" meta-row
 *   - show per-participant delivery + payment status in the detail view
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { redactError, storeLog } from '@/shared/lib/logger';
import { clearPersistedStore } from '@/shared/lib/persist/clearPersistedStore';
import { createMergeWithSchema } from '@/shared/lib/persist/createMergeWithSchema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Where this participant came from in the picker. Determines default channel. */
export type SplitBillParticipantSource = 'nostr' | 'ble' | 'search' | 'self';

/** Which channel the orchestrator should use to deliver the BOLT11. */
export type SplitBillDeliveryChannel = 'nostr-dm' | 'ble-dm' | 'qr-only' | 'self';

/** Delivery status per participant. */
export type SplitBillDeliveryState = 'pending' | 'sent' | 'failed';

/** Payment status per participant (independent of delivery). */
export type SplitBillPaymentState = 'pending' | 'paid' | 'expired';

/** Top-level group lifecycle. */
export type SplitBillGroupState =
  | 'draft'
  | 'awaiting'
  | 'partially-paid'
  | 'paid'
  | 'expired'
  | 'cancelled';

export interface SplitBillParticipant {
  id: string;
  source: SplitBillParticipantSource;
  channel: SplitBillDeliveryChannel;
  /** Nostr hex pubkey — for `source: 'nostr' | 'search'`. */
  pubkey?: string;
  /** bitchat 16-hex PeerID — for `source: 'ble'`. */
  peerID?: string;
  /** bitchat / nostr nickname (falls back to pubkey prefix in UI). */
  nickname?: string;
  /** Avatar URL for rendering in the detail sheet / meta-row. */
  avatarUrl?: string;
  /** This participant's share of the total (in the group's unit). */
  amount: number;

  /** Correlation id — links back to coco's MintHistoryEntry.quoteId. */
  mintQuoteId?: string;
  /** The raw BOLT11 invoice string for manual share / QR render. */
  bolt11?: string;
  /** Mint quote expiry (ms since epoch) if available. */
  expiresAt?: number;

  deliveryState: SplitBillDeliveryState;
  deliveryError?: string;
  paymentState: SplitBillPaymentState;
}

export interface SplitBillGroup {
  id: string;
  unit: string; // 'sat' | 'usd' — stringly typed to avoid fighting coco's unit system
  /** The user's mint URL — every participant's invoice mints into this mint. */
  mintUrl: string;
  totalAmount: number;
  title: string;
  createdAt: number;
  state: SplitBillGroupState;
  participants: SplitBillParticipant[];
}

/** Reverse index: mint quote id → (groupId, participantId). Lets the
 *  Transactions list hide individual mint entries that belong to a group
 *  by filtering on quoteId, same pattern as `swapTransactionsStore`. */
export type QuoteIdToSplitBillIndex = Record<string, { groupId: string; participantId: string }>;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface SplitBillStoreState {
  groups: Record<string, SplitBillGroup>;
  quoteIdToSplitBill: QuoteIdToSplitBillIndex;
}

interface StartGroupInput {
  unit: string;
  mintUrl: string;
  totalAmount: number;
  title?: string;
  participants: (Omit<
    SplitBillParticipant,
    | 'id'
    | 'mintQuoteId'
    | 'bolt11'
    | 'expiresAt'
    | 'deliveryState'
    | 'deliveryError'
    | 'paymentState'
  > & {
    id?: string;
  })[];
}

interface SplitBillStoreActions {
  startGroup: (input: StartGroupInput) => SplitBillGroup;
  transitionGroup: (groupId: string, next: SplitBillGroupState) => void;

  tagMintQuote: (
    groupId: string,
    participantId: string,
    params: { mintQuoteId: string; bolt11?: string; expiresAt?: number }
  ) => void;

  markDelivered: (groupId: string, participantId: string, ok: boolean, error?: string) => void;

  /** Called when a mint quote flips to PAID (or ISSUED) in coco history. */
  markPaymentPaidByQuoteId: (quoteId: string) => void;
  markPaymentExpiredByQuoteId: (quoteId: string) => void;

  /**
   * Mark a participant paid by id rather than by quoteId. Used for
   * self-source participants that never hold a `mintQuoteId` — their
   * share of the split is already covered by virtue of being the user.
   */
  markPaymentPaid: (groupId: string, participantId: string) => void;

  finalizeGroup: (groupId: string) => void;
  cancelGroup: (groupId: string) => void;

  getGroup: (groupId: string) => SplitBillGroup | null;
  getGroupsForUnit: (unit: string) => SplitBillGroup[];

  clearAllData: () => Promise<void>;
}

export type SplitBillStore = SplitBillStoreState & SplitBillStoreActions;

const generateGroupId = () => `sb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const generateParticipantId = () => `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// ---------------------------------------------------------------------------

/**
 * Derive the top-level group state from participant payment states. Called
 * after every mutation that can affect payment / delivery status.
 */
function deriveGroupState(group: SplitBillGroup): SplitBillGroupState {
  if (group.state === 'cancelled') return 'cancelled';
  if (group.state === 'draft') return 'draft';

  const total = group.participants.length;
  if (total === 0) return group.state;

  const paid = group.participants.filter((p) => p.paymentState === 'paid').length;
  const expired = group.participants.filter((p) => p.paymentState === 'expired').length;

  if (paid === total) return 'paid';
  if (expired === total) return 'expired';
  if (paid > 0) return 'partially-paid';
  return 'awaiting';
}

// ---------------------------------------------------------------------------
// Persisted-shape schema (defensive rehydrate validation)
// ---------------------------------------------------------------------------

const ParticipantSourceSchema = z.enum(['nostr', 'ble', 'search', 'self']);
const DeliveryChannelSchema = z.enum(['nostr-dm', 'ble-dm', 'qr-only', 'self']);
const DeliveryStateSchema = z.enum(['pending', 'sent', 'failed']);
const PaymentStateSchema = z.enum(['pending', 'paid', 'expired']);
const GroupStateSchema = z.enum([
  'draft',
  'awaiting',
  'partially-paid',
  'paid',
  'expired',
  'cancelled',
]);

const PersistedParticipant = z.looseObject({
  id: z.string().max(128),
  source: ParticipantSourceSchema,
  channel: DeliveryChannelSchema,
  pubkey: z.string().max(128).optional(),
  peerID: z.string().max(64).optional(),
  nickname: z.string().max(256).optional(),
  avatarUrl: z.string().max(2048).optional(),
  amount: z.number().int().nonnegative(),
  mintQuoteId: z.string().max(256).optional(),
  bolt11: z.string().max(8192).optional(),
  expiresAt: z.number().int().nonnegative().optional(),
  deliveryState: DeliveryStateSchema,
  deliveryError: z.string().max(2048).optional(),
  paymentState: PaymentStateSchema,
});

const PersistedGroup = z.looseObject({
  id: z.string().max(128),
  unit: z.string().max(16),
  mintUrl: z.string().max(2048),
  totalAmount: z.number().int().nonnegative(),
  title: z.string().max(512),
  createdAt: z.number().int().nonnegative(),
  state: GroupStateSchema,
  participants: z.array(PersistedParticipant).max(256),
});

const PersistedSplitBillStore = z.object({
  groups: z.record(z.string().max(128), PersistedGroup).default({}),
  quoteIdToSplitBill: z
    .record(
      z.string().max(256),
      z.looseObject({
        groupId: z.string().max(128),
        participantId: z.string().max(128),
      })
    )
    .default({}),
});

// ---------------------------------------------------------------------------

export const useSplitBillTransactionsStore = create<SplitBillStore>()(
  persist(
    (set, get) => ({
      groups: {},
      quoteIdToSplitBill: {},

      startGroup: ({ unit, mintUrl, totalAmount, title, participants }) => {
        const id = generateGroupId();
        const group: SplitBillGroup = {
          id,
          unit,
          mintUrl,
          totalAmount,
          title:
            title ??
            `Split bill — ${participants.length} participant${participants.length === 1 ? '' : 's'}`,
          createdAt: Date.now(),
          state: 'draft',
          participants: participants.map((p) => ({
            id: p.id ?? generateParticipantId(),
            source: p.source,
            channel: p.channel,
            pubkey: p.pubkey,
            peerID: p.peerID,
            nickname: p.nickname,
            avatarUrl: p.avatarUrl,
            amount: p.amount,
            deliveryState: 'pending',
            paymentState: 'pending',
          })),
        };

        storeLog.info('store.split_bill.start_group', {
          id,
          unit,
          mintUrl,
          totalAmount,
          participants: group.participants.length,
        });

        set((state) => ({
          groups: { ...state.groups, [id]: group },
        }));

        return group;
      },

      transitionGroup: (groupId, nextState) => {
        storeLog.info('store.split_bill.transition', { groupId, nextState });
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

      tagMintQuote: (groupId, participantId, { mintQuoteId, bolt11, expiresAt }) => {
        if (!mintQuoteId) return;
        storeLog.debug('store.split_bill.tag_mint_quote', {
          groupId,
          participantId,
          mintQuoteId,
        });

        set((state) => {
          const group = state.groups[groupId];
          if (!group) return state;

          const participants = group.participants.map((p) =>
            p.id === participantId ? { ...p, mintQuoteId, bolt11, expiresAt } : p
          );

          return {
            ...state,
            groups: {
              ...state.groups,
              [groupId]: { ...group, participants },
            },
            quoteIdToSplitBill: {
              ...state.quoteIdToSplitBill,
              [mintQuoteId]: { groupId, participantId },
            },
          };
        });
      },

      markDelivered: (groupId, participantId, ok, error) => {
        storeLog.debug('store.split_bill.mark_delivered', {
          groupId,
          participantId,
          ok,
          error,
        });
        set((state) => {
          const group = state.groups[groupId];
          if (!group) return state;

          const participants = group.participants.map((p) => {
            if (p.id !== participantId) return p;
            return {
              ...p,
              deliveryState: ok ? ('sent' as const) : ('failed' as const),
              deliveryError: ok ? undefined : error,
            };
          });

          return {
            ...state,
            groups: {
              ...state.groups,
              [groupId]: { ...group, participants },
            },
          };
        });
      },

      markPaymentPaidByQuoteId: (quoteId) => {
        const entry = get().quoteIdToSplitBill[quoteId];
        if (!entry) return;
        storeLog.info('store.split_bill.payment_paid', {
          quoteId,
          groupId: entry.groupId,
          participantId: entry.participantId,
        });

        set((state) => {
          const group = state.groups[entry.groupId];
          if (!group) return state;

          const participants = group.participants.map((p) =>
            p.id === entry.participantId ? { ...p, paymentState: 'paid' as const } : p
          );
          const next = { ...group, participants };
          next.state = deriveGroupState(next);

          return {
            ...state,
            groups: { ...state.groups, [entry.groupId]: next },
          };
        });
      },

      markPaymentPaid: (groupId, participantId) => {
        storeLog.info('store.split_bill.payment_paid_by_id', {
          groupId,
          participantId,
        });

        set((state) => {
          const group = state.groups[groupId];
          if (!group) return state;

          const participants = group.participants.map((p) =>
            p.id === participantId ? { ...p, paymentState: 'paid' as const } : p
          );
          const next = { ...group, participants };
          next.state = deriveGroupState(next);

          return {
            ...state,
            groups: { ...state.groups, [groupId]: next },
          };
        });
      },

      markPaymentExpiredByQuoteId: (quoteId) => {
        const entry = get().quoteIdToSplitBill[quoteId];
        if (!entry) return;
        storeLog.info('store.split_bill.payment_expired', {
          quoteId,
          groupId: entry.groupId,
          participantId: entry.participantId,
        });

        set((state) => {
          const group = state.groups[entry.groupId];
          if (!group) return state;

          const participants = group.participants.map((p) =>
            p.id === entry.participantId ? { ...p, paymentState: 'expired' as const } : p
          );
          const next = { ...group, participants };
          next.state = deriveGroupState(next);

          return {
            ...state,
            groups: { ...state.groups, [entry.groupId]: next },
          };
        });
      },

      finalizeGroup: (groupId) => {
        storeLog.info('store.split_bill.finalize', { groupId });
        set((state) => {
          const group = state.groups[groupId];
          if (!group) return state;
          const next = { ...group };
          next.state = deriveGroupState(next);
          return { ...state, groups: { ...state.groups, [groupId]: next } };
        });
      },

      cancelGroup: (groupId) => {
        storeLog.info('store.split_bill.cancel', { groupId });
        set((state) => {
          const group = state.groups[groupId];
          if (!group) return state;
          return {
            ...state,
            groups: {
              ...state.groups,
              [groupId]: { ...group, state: 'cancelled' as const },
            },
          };
        });
      },

      getGroup: (groupId) => get().groups[groupId] ?? null,

      getGroupsForUnit: (unit) => {
        const groups = Object.values(get().groups).filter((g) => g.unit === unit);
        return groups.sort((a, b) => b.createdAt - a.createdAt);
      },

      clearAllData: async () => {
        try {
          await clearPersistedStore(useSplitBillTransactionsStore, {
            groups: {},
            quoteIdToSplitBill: {},
          });
        } catch (error) {
          storeLog.error('store.split_bill.clear_failed', { error: redactError(error) });
          throw error;
        }
      },
    }),
    {
      name: 'split-bill-transactions-store',
      storage: createJSONStorage(() => createProfileScopedStorage()),
      version: 1,
      partialize: (state) => ({
        groups: state.groups,
        quoteIdToSplitBill: state.quoteIdToSplitBill,
      }),
      migrate: (state, _version) => state,
      merge: createMergeWithSchema('split_bill', PersistedSplitBillStore),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          storeLog.warn('store.split_bill.rehydrate_failed', { error: redactError(error) });
        }
      },
    }
  )
);
