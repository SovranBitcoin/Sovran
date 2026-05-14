import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import type {
  BLEDeliveryStatus,
  BLEDeliveryStatusEvent,
  BLEPrivateMessageEvent,
  ChatMessage,
} from 'bitchat-module';

const MESSAGE_BUFFER_CAP = 500;

export type BleDmDeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface BleDmMessage extends ChatMessage {
  /** Status only set on own (outbound) messages. */
  deliveryStatus?: BleDmDeliveryStatus;
  /** When `deliveryStatus === 'failed'`, the reason string the native side sent. */
  failureReason?: string;
}

interface BitchatDmMessagesStore {
  /** Keyed by counterparty 16-hex BLE peerID. */
  byPeer: Record<string, BleDmMessage[]>;
  /** Push an inbound DM (from `onBLEPrivateMessage`) into the thread buffer. */
  appendIncoming(event: BLEPrivateMessageEvent): void;
  /** Add an optimistic outbound DM (status `'sending'`) before native dispatch. */
  appendOutgoing(message: BleDmMessage, peerID: string): void;
  /** Update an outbound message's delivery status when the native event fires. */
  applyDeliveryStatus(event: BLEDeliveryStatusEvent): void;
  /** Get the current thread for a peer (stable reference until next change). */
  getForPeer(peerID: string): BleDmMessage[];
  /** Reset a thread (e.g. when the user clears the conversation). */
  clearForPeer(peerID: string): void;
}

function mapStatus(status: BLEDeliveryStatus): BleDmDeliveryStatus {
  switch (status) {
    case 'sending':
      return 'sending';
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'failed':
      return 'failed';
    case 'partiallyDelivered':
      // 1:1 DM should never see partial — treat as sent.
      return 'sent';
  }
}

/**
 * Status progression: sending → sent → delivered → read. Never downgrade
 * (a late 'sent' arriving after we've already seen 'delivered' would otherwise
 * undo the better signal). `failed` always wins so users see transport errors.
 */
const STATUS_RANK: Record<BleDmDeliveryStatus, number> = {
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

function appendCapped(prev: BleDmMessage[], msg: BleDmMessage): BleDmMessage[] {
  if (prev.some((m) => m.id === msg.id)) return prev;
  const last = prev[prev.length - 1];
  const inOrder = !last || msg.timestamp >= last.timestamp;
  const next = inOrder ? [...prev, msg] : [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
  return next.length > MESSAGE_BUFFER_CAP ? next.slice(next.length - MESSAGE_BUFFER_CAP) : next;
}

/**
 * Persisted shape — kept loose so older blobs can hydrate even when we add
 * optional fields later (`looseObject` ignores unknown keys but won't reject
 * known ones with the wrong type). Anything that fails schema validation
 * falls back to an empty `byPeer` rather than wiping the in-memory store.
 */
const PersistedBleDmMessage = z.looseObject({
  id: z.string(),
  content: z.string(),
  sender: z.string(),
  senderId: z.string(),
  timestamp: z.number(),
  isPrivate: z.boolean(),
  isOwn: z.boolean(),
  isPending: z.boolean().optional(),
  deliveryStatus: z.enum(['sending', 'sent', 'delivered', 'read', 'failed']).optional(),
  failureReason: z.string().optional(),
});

const PersistedBitchatDmStore = z.looseObject({
  byPeer: z.record(z.string(), z.array(PersistedBleDmMessage)).default({}),
});

type PersistedSlice = Pick<BitchatDmMessagesStore, 'byPeer'>;

/**
 * App-wide buffer for Bitchat BLE 1:1 messages. Lifted out of the DM screen so
 * inbound messages aren't dropped while the screen is closed and so outbound
 * delivery-status transitions can update the bubble even after a brief
 * unmount-remount.
 *
 * Persisted to AsyncStorage so chat history survives app kill. On rehydrate,
 * any outbound message still in `sending` / `sent` (without a `delivered`
 * ack) is downgraded to `failed` with reason `'app_restart'` — we can't
 * know whether it actually reached the peer between the last write and the
 * relaunch, so we surface the ambiguity rather than show a misleading
 * "in flight" forever. The user can tap the failed bubble to retry, which
 * starts a fresh handshake and sends with a new messageID.
 *
 * Native-side `DmPeerSummary` (UserDefaults-backed in `BitChatBLEBridge.swift`)
 * remains the source of truth for the Contacts-tab Recent/All entries — this
 * store is the message-thread layer.
 */
export const useBitchatDmMessagesStore = create<BitchatDmMessagesStore>()(
  persist<BitchatDmMessagesStore, [], [], PersistedSlice>(
    (set, get) => ({
      byPeer: {},
      appendIncoming: (event) => {
        const msg: BleDmMessage = {
          id: event.id,
          content: event.content,
          sender: event.sender,
          senderId: event.peerID,
          timestamp: event.timestamp,
          isPrivate: true,
          isOwn: event.isOwn,
        };
        set((state) => ({
          byPeer: {
            ...state.byPeer,
            [event.peerID]: appendCapped(state.byPeer[event.peerID] ?? [], msg),
          },
        }));
      },
      appendOutgoing: (message, peerID) => {
        set((state) => ({
          byPeer: {
            ...state.byPeer,
            [peerID]: appendCapped(state.byPeer[peerID] ?? [], message),
          },
        }));
      },
      applyDeliveryStatus: (event) => {
        const incoming = mapStatus(event.status);
        set((state) => {
          // Outbound messages are keyed by `peerID === counterparty`, but the
          // delivery status event carries only `messageID`. Find which peer's
          // thread holds the matching id.
          const next: Record<string, BleDmMessage[]> = {};
          let mutated = false;
          for (const [peer, thread] of Object.entries(state.byPeer)) {
            let updated = thread;
            const idx = thread.findIndex((m) => m.id === event.messageID);
            if (idx >= 0) {
              const current = thread[idx]!;
              const currentRank = STATUS_RANK[current.deliveryStatus ?? 'sending'];
              // Never downgrade (e.g. a late `sent` after we already saw
              // `delivered`); always accept `failed` so the user can see it.
              if (incoming === 'failed' || STATUS_RANK[incoming] > currentRank) {
                updated = thread.slice();
                updated[idx] = {
                  ...current,
                  deliveryStatus: incoming,
                  isPending: incoming === 'sending',
                  failureReason: incoming === 'failed' ? event.reason : undefined,
                };
                mutated = true;
              }
            }
            next[peer] = updated;
          }
          return mutated ? { byPeer: next } : state;
        });
      },
      getForPeer: (peerID) => get().byPeer[peerID] ?? [],
      clearForPeer: (peerID) =>
        set((state) => {
          if (!state.byPeer[peerID]) return state;
          const { [peerID]: _removed, ...rest } = state.byPeer;
          return { byPeer: rest };
        }),
    }),
    persistConfig<BitchatDmMessagesStore, PersistedSlice>({
      name: 'bitchat-dm-messages-store',
      storage: createProfileScopedStorage(),
      schema: PersistedBitchatDmStore,
      partialize: (state) => ({ byPeer: state.byPeer }),
      afterHydrate: (state) => {
        // Demote any in-flight outbound messages to `failed`. We don't know
        // whether they actually made it to the peer between the last write
        // and the relaunch — better to flag the ambiguity than show a
        // permanent spinner. Inbound messages and already-delivered/read
        // outbound messages pass through untouched.
        if (!state) return;
        let mutated = false;
        const next: Record<string, BleDmMessage[]> = {};
        for (const [peer, thread] of Object.entries(state.byPeer)) {
          let changed = false;
          const updated = thread.map((m) => {
            if (m.isOwn && (m.deliveryStatus === 'sending' || m.deliveryStatus === 'sent')) {
              changed = true;
              return {
                ...m,
                deliveryStatus: 'failed' as const,
                isPending: false,
                failureReason: 'app_restart',
              };
            }
            return m;
          });
          if (changed) {
            mutated = true;
            next[peer] = updated;
          } else {
            next[peer] = thread;
          }
        }
        if (mutated) {
          useBitchatDmMessagesStore.setState({ byPeer: next });
        }
      },
    })
  )
);
