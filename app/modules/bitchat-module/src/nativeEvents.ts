/**
 * What the native side may hand to a listener. The payload types in `types.ts`
 * describe what Kotlin and Swift are written to send; these checks are what
 * actually stands between a native payload and app code. An event that does
 * not fit is dropped: a listener is never called with a missing id, a peer id
 * that is not a string, or a message body of unbounded size.
 *
 * An optional field the native side sent as `null` is read as absent.
 */
import type {
  BLEDeliveryStatus,
  BLEDeliveryStatusEvent,
  BLEMessageEvent,
  BLEPeerEvent,
  BLEPeerIdentityEvent,
  BLEPrivateMessageEvent,
  NostrMessageEvent,
  NostrPrivateMessageEvent,
} from './types';

/** Ids, names, keys and statuses. */
const MAX_SHORT = 512;
/** A message body or a payment request. Nearby payments carry a whole token. */
const MAX_BODY = 262_144;
/** Peers one list event may name. */
const MAX_PEERS = 1024;

type Fields = Record<string, unknown>;

const fields = (value: unknown): Fields | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : null;

const text = (value: unknown, max = MAX_SHORT): value is string =>
  typeof value === 'string' && value.length <= max;
const id = (value: unknown): value is string => text(value) && value.length > 0;
const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const flag = (value: unknown): value is boolean => typeof value === 'boolean';
/**
 * A name shown beside a message. It is chosen by the other side and nothing
 * depends on it, so one that is too long is cut, not a reason to lose the
 * message it came with.
 */
const isLabel = (value: unknown): value is string => typeof value === 'string';
const label = (value: string): string => value.slice(0, MAX_SHORT);
/** An optional string: absent, null, or a string within `max`. */
const optionalText = (value: unknown, max = MAX_SHORT): value is string | null | undefined =>
  value === undefined || value === null || text(value, max);

const DELIVERY_STATUSES: readonly BLEDeliveryStatus[] = [
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
  'partiallyDelivered',
];

export function readBLEMessage(raw: unknown): BLEMessageEvent | null {
  const e = fields(raw);
  if (!e || !id(e.id) || !text(e.content, MAX_BODY) || !isLabel(e.sender)) return null;
  if (!text(e.senderPeerID) || !time(e.timestamp) || !flag(e.isPrivate)) return null;
  return {
    id: e.id,
    content: e.content,
    sender: label(e.sender),
    senderPeerID: e.senderPeerID,
    timestamp: e.timestamp,
    isPrivate: e.isPrivate,
  };
}

export function readBLEPrivateMessage(raw: unknown): BLEPrivateMessageEvent | null {
  const e = fields(raw);
  if (!e || !id(e.id) || !id(e.peerID) || !isLabel(e.sender) || !text(e.content, MAX_BODY)) return null;
  if (!time(e.timestamp) || !flag(e.isOwn) || !optionalText(e.profileScope)) return null;
  return {
    ...(e.profileScope ? { profileScope: e.profileScope } : {}),
    id: e.id,
    peerID: e.peerID,
    sender: label(e.sender),
    content: e.content,
    timestamp: e.timestamp,
    isOwn: e.isOwn,
  };
}

export function readBLEPeerIdentity(raw: unknown): BLEPeerIdentityEvent | null {
  const e = fields(raw);
  if (!e || !id(e.peerID) || !flag(e.isFavorite)) return null;
  if (!optionalText(e.nostrPubkeyHex) || !optionalText(e.creq, MAX_BODY)) return null;
  return {
    peerID: e.peerID,
    isFavorite: e.isFavorite,
    ...(e.nostrPubkeyHex ? { nostrPubkeyHex: e.nostrPubkeyHex } : {}),
    ...(e.creq ? { creq: e.creq } : {}),
  };
}

export function readBLEDeliveryStatus(raw: unknown): BLEDeliveryStatusEvent | null {
  const e = fields(raw);
  if (!e || !id(e.messageID)) return null;
  const status = DELIVERY_STATUSES.find((known) => known === e.status);
  if (!status) return null;
  // Both are for display; a status is not lost over either.
  return {
    messageID: e.messageID,
    status,
    ...(isLabel(e.nickname) && e.nickname ? { nickname: label(e.nickname) } : {}),
    ...(isLabel(e.reason) && e.reason ? { reason: label(e.reason) } : {}),
  };
}

export function readBLEPeerUpdate(raw: unknown): BLEPeerEvent | null {
  const e = fields(raw);
  if (!e) return null;
  if (e.type === 'list') {
    if (!Array.isArray(e.peers) || e.peers.length > MAX_PEERS) return null;
    // One bad entry does not cost the list: the rest are still our peers.
    return { type: 'list', peers: e.peers.filter(id) };
  }
  if ((e.type === 'connected' || e.type === 'disconnected') && id(e.peerID)) {
    return { type: e.type, peerID: e.peerID };
  }
  return null;
}

export function readBLEState(raw: unknown): { state: string } | null {
  const e = fields(raw);
  return e && text(e.state) ? { state: e.state } : null;
}

export function readBLEBackgroundTaskExpiring(raw: unknown): { handle: number } | null {
  const e = fields(raw);
  return e && time(e.handle) ? { handle: e.handle } : null;
}

export function readNostrMessage(raw: unknown): NostrMessageEvent | null {
  const e = fields(raw);
  if (!e || !id(e.id) || !text(e.content, MAX_BODY) || !isLabel(e.sender)) return null;
  if (!id(e.senderPubkey) || !time(e.timestamp) || !text(e.geohash) || !flag(e.isOwn)) return null;
  return {
    id: e.id,
    content: e.content,
    sender: label(e.sender),
    senderPubkey: e.senderPubkey,
    timestamp: e.timestamp,
    geohash: e.geohash,
    isOwn: e.isOwn,
  };
}

export function readNostrPrivateMessage(raw: unknown): NostrPrivateMessageEvent | null {
  const e = fields(raw);
  if (!e || !id(e.id) || !id(e.senderPubkey) || !isLabel(e.sender)) return null;
  if (!text(e.content, MAX_BODY) || !time(e.timestamp) || !text(e.geohash) || !flag(e.isOwn)) {
    return null;
  }
  return {
    id: e.id,
    senderPubkey: e.senderPubkey,
    sender: label(e.sender),
    content: e.content,
    timestamp: e.timestamp,
    geohash: e.geohash,
    isOwn: e.isOwn,
  };
}
