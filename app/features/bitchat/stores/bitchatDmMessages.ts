import { defineStore as create } from '@/shared/lib/persist/defineStore';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { bitchatLog } from '@/shared/lib/logger';
import type { BLEDeliveryStatusEvent, BLEPrivateMessageEvent, ChatMessage } from 'bitchat-module';

const MESSAGE_BUFFER_CAP = 500;

type BleDmDeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface BleDmMessage extends ChatMessage {
  /** Status only set on own (outbound) messages. Read through `decodeDelivery`. */
  deliveryStatus?: BleDmDeliveryStatus;
  /** When `deliveryStatus === 'failed'`, the reason: the native side's, or `timeout` / `app_restart`. */
  failureReason?: string;
}

/** Why no report settled a message: the 15 s watchdog fired, or the app restarted first. */
type UnconfirmedWhy = 'timeout' | 'app_restart';

/**
 * Where an own message's delivery stands. Saved as `deliveryStatus`,
 * `failureReason` and `isPending` exactly as before (`encodeDelivery`), so an
 * older release reads every message a newer one saves.
 */
type BleDmDelivery =
  | { state: 'sending' }
  | { state: 'sent' }
  | { state: 'delivered' }
  | { state: 'read' }
  /** No report came in time. Saved as `failed` with `why` as the reason. */
  | { state: 'unconfirmed'; why: UnconfirmedWhy }
  /** The native side reported a failure or refused the send. */
  | { state: 'failed'; reason: string | undefined };

type DeliveryEvent =
  | { type: 'sending' | 'sent' | 'delivered' | 'read' }
  | { type: 'failed'; reason: string | undefined }
  /** The 15 s watchdog fired. */
  | { type: 'timed-out' }
  /** The app started again with the message saved. */
  | { type: 'relaunched' };

/**
 * Which events move each state; any other is refused. Reports only move
 * forward (sending → sent → delivered → read), and a delivered or read report
 * wins over every failure.
 */
const MOVES: Record<BleDmDelivery['state'], readonly DeliveryEvent['type'][]> = {
  sending: ['sent', 'delivered', 'read', 'failed', 'timed-out', 'relaunched'],
  sent: ['delivered', 'read', 'failed', 'relaunched'],
  // The peer acknowledged it: final, a late failure included (owner's ruling, 2026-11-11).
  delivered: ['read'],
  read: [],
  // The 15 s mark and a restart mean "not confirmed yet": a later report
  // wins (owner's ruling, 2026-11-11). Until one comes it offers a retry.
  unconfirmed: ['sent', 'delivered', 'read', 'failed'],
  // A new reason replaces the old one. A delivered or read report is proof
  // the peer has it, so it wins over a failure, whichever came first (owner's ruling).
  failed: ['failed', 'delivered', 'read'],
};

function stateAfter(event: DeliveryEvent): BleDmDelivery {
  switch (event.type) {
    case 'sending':
    case 'sent':
    case 'delivered':
    case 'read':
      return { state: event.type };
    case 'failed':
      return { state: 'failed', reason: event.reason };
    case 'timed-out':
      return { state: 'unconfirmed', why: 'timeout' };
    case 'relaunched':
      return { state: 'unconfirmed', why: 'app_restart' };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/**
 * The state `event` moves `current` to, or null when the table refuses it. A
 * message saved with no status counts as sending for a native report, as every
 * own message starts; the watchdog and a relaunch leave it alone.
 */
function nextDelivery(current: BleDmDelivery | null, event: DeliveryEvent): BleDmDelivery | null {
  const from =
    current ?? (event.type === 'timed-out' || event.type === 'relaunched' ? null : SENDING);
  return from && MOVES[from.state].includes(event.type) ? stateAfter(event) : null;
}

const SENDING: BleDmDelivery = { state: 'sending' };

/** A saved message's delivery, or null when it carries no status (inbound messages). */
function decodeDelivery(
  message: Pick<BleDmMessage, 'deliveryStatus' | 'failureReason'>
): BleDmDelivery | null {
  const { deliveryStatus, failureReason } = message;
  switch (deliveryStatus) {
    case undefined:
      return null;
    case 'sending':
    case 'sent':
    case 'delivered':
    case 'read':
      return { state: deliveryStatus };
    case 'failed':
      return failureReason === 'timeout' || failureReason === 'app_restart'
        ? { state: 'unconfirmed', why: failureReason }
        : { state: 'failed', reason: failureReason };
    default: {
      const unreachable: never = deliveryStatus;
      return unreachable;
    }
  }
}

/** The saved fields for `delivery`, as every release has written them. */
function encodeDelivery(
  delivery: BleDmDelivery
): Required<Pick<BleDmMessage, 'deliveryStatus' | 'isPending'>> &
  Pick<BleDmMessage, 'failureReason'> {
  switch (delivery.state) {
    case 'sending':
      return { deliveryStatus: 'sending', isPending: true, failureReason: undefined };
    case 'sent':
    case 'delivered':
    case 'read':
      return { deliveryStatus: delivery.state, isPending: false, failureReason: undefined };
    case 'unconfirmed':
      return { deliveryStatus: 'failed', isPending: false, failureReason: delivery.why };
    case 'failed':
      return { deliveryStatus: 'failed', isPending: false, failureReason: delivery.reason };
    default: {
      const unreachable: never = delivery;
      return unreachable;
    }
  }
}

interface BitchatDmMessagesStore {
  /** Keyed by counterparty 16-hex BLE peerID. */
  byPeer: Record<string, BleDmMessage[]>;
  /** Push an inbound DM (from `onBLEPrivateMessage`) into the thread buffer. */
  appendIncoming(event: BLEPrivateMessageEvent): void;
  /** Add an optimistic outbound DM (status `'sending'`) before native dispatch. */
  appendOutgoing(message: BleDmMessage, peerID: string): void;
  /** Move an outbound message on a native delivery status, as the table allows. */
  applyDeliveryStatus(event: BLEDeliveryStatusEvent): void;
  /** The 15 s watchdog fired for `messageID`; true when that moved the message. */
  markTimedOut(messageID: string): boolean;
}

function reportedEvent(event: BLEDeliveryStatusEvent): DeliveryEvent {
  bitchatLog.debug('bitchat.dm.status.map', { nativeStatus: event.status });
  switch (event.status) {
    case 'sending':
    case 'sent':
    case 'delivered':
    case 'read':
      return { type: event.status };
    case 'failed':
      return { type: 'failed', reason: event.reason };
    case 'partiallyDelivered':
      // 1:1 DM should never see partial — treat as sent.
      return { type: 'sent' };
  }
}

/**
 * `byPeer` with the message `messageID` moved by `event`, or null when no
 * thread holds it or the table refuses the move. Outbound messages are keyed
 * by counterparty, but a delivery status carries only the message id, so
 * every thread is searched.
 */
function moveDelivery(
  byPeer: Record<string, BleDmMessage[]>,
  messageID: string,
  event: DeliveryEvent
): Record<string, BleDmMessage[]> | null {
  for (const [peer, thread] of Object.entries(byPeer)) {
    const idx = thread.findIndex((m) => m.id === messageID);
    if (idx < 0) continue;
    const message = thread[idx]!;
    const current = decodeDelivery(message);
    const next = nextDelivery(current, event);
    if (!next) {
      bitchatLog.debug('bitchat.dm.delivery_status.skipped_downgrade', {
        peerID: peer,
        messageId: messageID,
        previousStatus: current?.state ?? 'sending',
        incoming: event.type,
      });
      return null;
    }
    const updated = thread.slice();
    updated[idx] = { ...message, ...encodeDelivery(next) };
    bitchatLog.info('bitchat.dm.delivery_status.updated', {
      peerID: peer,
      messageId: messageID,
      previousStatus: current?.state ?? 'sending',
      nextStatus: next.state,
      hasFailureReason: next.state === 'failed' && !!next.reason,
    });
    return { ...byPeer, [peer]: updated };
  }
  bitchatLog.debug('bitchat.dm.delivery_status.no_match_or_noop', {
    messageId: messageID,
    incoming: event.type,
    peerCount: Object.keys(byPeer).length,
  });
  return null;
}

function appendCapped(prev: BleDmMessage[], msg: BleDmMessage): BleDmMessage[] {
  if (prev.some((m) => m.id === msg.id)) {
    bitchatLog.debug('bitchat.dm.thread.append.skipped_duplicate', {
      messageId: msg.id,
      previousCount: prev.length,
      isOwn: msg.isOwn,
      contentLength: msg.content.length,
    });
    return prev;
  }
  const last = prev[prev.length - 1];
  const inOrder = !last || msg.timestamp >= last.timestamp;
  const next = inOrder ? [...prev, msg] : [...prev, msg].sort((a, b) => a.timestamp - b.timestamp);
  const capped = next.length > MESSAGE_BUFFER_CAP;
  const result = capped ? next.slice(next.length - MESSAGE_BUFFER_CAP) : next;
  bitchatLog.debug('bitchat.dm.thread.append.result', {
    previousCount: prev.length,
    nextCount: result.length,
    capped,
    inOrder,
    isOwn: msg.isOwn,
    contentLength: msg.content.length,
    deliveryStatus: msg.deliveryStatus ?? null,
  });
  return result;
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
  // `.catch('failed')`: fail VISIBLE. Catching an unknown status to
  // undefined renders the message as unremarkably in-flight ('sending'
  // rank), silently hiding a possible transport failure; 'failed' surfaces
  // a retry affordance instead (worst case: a duplicate resend). Missing
  // stays undefined via `.optional()` — inbound messages carry no status.
  deliveryStatus: z
    .enum(['sending', 'sent', 'delivered', 'read', 'failed'])
    .catch('failed')
    .optional(),
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
 * ack) becomes unconfirmed, saved as `failed` with reason `'app_restart'` —
 * we can't know whether it actually reached the peer between the last write
 * and the relaunch, so we surface the ambiguity rather than show a misleading
 * "in flight" forever. A delivery report that still arrives wins. The user can
 * tap the failed bubble to retry, which starts a fresh handshake and sends
 * with a new messageID.
 *
 * Native-side `DmPeerSummary` (UserDefaults-backed in `BitChatBLEBridge.swift`)
 * remains the source of truth for the Contacts-tab Recent/All entries — this
 * store is the message-thread layer.
 */
export const useBitchatDmMessagesStore = create<BitchatDmMessagesStore>({
  name: 'bitchat-dm-messages-store',
  scope: 'profile',
})(
  persist<BitchatDmMessagesStore, [], [], PersistedSlice>(
    (set, get) => ({
      byPeer: {},
      appendIncoming: (event) => {
        bitchatLog.info('bitchat.dm.incoming.append', {
          peerID: event.peerID,
          messageId: event.id,
          contentLength: event.content.length,
          isOwn: event.isOwn,
        });
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
        bitchatLog.info('bitchat.dm.outgoing.append', {
          peerID,
          messageId: message.id,
          contentLength: message.content.length,
          deliveryStatus: message.deliveryStatus ?? null,
          isPending: message.isPending ?? null,
        });
        set((state) => ({
          byPeer: {
            ...state.byPeer,
            [peerID]: appendCapped(state.byPeer[peerID] ?? [], message),
          },
        }));
      },
      applyDeliveryStatus: (event) => {
        bitchatLog.info('bitchat.dm.delivery_status.apply', {
          messageId: event.messageID,
          nativeStatus: event.status,
          hasReason: !!event.reason,
        });
        set((state) => {
          const byPeer = moveDelivery(state.byPeer, event.messageID, reportedEvent(event));
          return byPeer ? { byPeer } : state;
        });
      },
      markTimedOut: (messageID) => {
        const byPeer = moveDelivery(get().byPeer, messageID, { type: 'timed-out' });
        if (byPeer) set({ byPeer });
        return !!byPeer;
      },
    }),
    persistConfig<BitchatDmMessagesStore, PersistedSlice>({
      name: 'bitchat-dm-messages-store',
      storage: createProfileScopedStorage(),
      schema: PersistedBitchatDmStore,
      partialize: (state) => ({ byPeer: state.byPeer }),
      afterHydrate: (state) => {
        // Mark any in-flight outbound messages unconfirmed. We don't know
        // whether they actually made it to the peer between the last write
        // and the relaunch — better to flag the ambiguity than show a
        // permanent spinner. Inbound messages and already-delivered/read
        // outbound messages pass through untouched.
        if (!state) {
          bitchatLog.debug('bitchat.dm.hydrate.skipped_empty');
          return;
        }
        let mutated = false;
        let demotedCount = 0;
        const next: Record<string, BleDmMessage[]> = {};
        for (const [peer, thread] of Object.entries(state.byPeer)) {
          let changed = false;
          const updated = thread.map((m) => {
            const next = m.isOwn ? nextDelivery(decodeDelivery(m), { type: 'relaunched' }) : null;
            if (!next) return m;
            changed = true;
            demotedCount += 1;
            return { ...m, ...encodeDelivery(next) };
          });
          if (changed) {
            mutated = true;
            next[peer] = updated;
          } else {
            next[peer] = thread;
          }
        }
        if (mutated) {
          bitchatLog.info('bitchat.dm.hydrate.demoted_pending', {
            peerCount: Object.keys(state.byPeer).length,
            demotedCount,
          });
          useBitchatDmMessagesStore.setState({ byPeer: next });
        } else {
          bitchatLog.debug('bitchat.dm.hydrate.no_demotions', {
            peerCount: Object.keys(state.byPeer).length,
          });
        }
      },
    })
  )
);
