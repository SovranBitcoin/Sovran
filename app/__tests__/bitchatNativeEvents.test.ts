/**
 * @jest-environment node
 *
 * A payload from the native Bitchat module reaches app code only when it has
 * the fields its type promises. Every listener the module exports goes through
 * one of these readers (`listen` in `BitChatModule.ts`), and a payload a reader
 * turns down is dropped.
 */
import {
  readBLEBackgroundTaskExpiring,
  readBLEDeliveryStatus,
  readBLEMessage,
  readBLEPeerIdentity,
  readBLEPeerUpdate,
  readBLEPrivateMessage,
  readBLEState,
  readNostrMessage,
  readNostrPrivateMessage,
} from '../modules/bitchat-module/src/nativeEvents';

const PRIVATE_MESSAGE = {
  profileScope: 'scope-a',
  id: 'm1',
  peerID: 'peer-a',
  sender: 'Alice',
  content: 'hello',
  timestamp: 1_700_000_000_000,
  isOwn: false,
};
const PUBLIC_MESSAGE = {
  id: 'm1',
  content: 'hi',
  sender: 'Alice',
  senderPeerID: 'peer-a',
  timestamp: 1,
  isPrivate: false,
};
const GEOHASH_MESSAGE = {
  id: 'e1',
  content: 'hi',
  sender: 'Alice',
  senderPubkey: 'a'.repeat(64),
  timestamp: 1,
  geohash: 'u4pruy',
  isOwn: false,
};

it('reads a well-formed private message and leaves out fields it does not know', () => {
  expect(readBLEPrivateMessage({ ...PRIVATE_MESSAGE, unexpected: 'ignored' })).toEqual(
    PRIVATE_MESSAGE
  );
});

it.each([
  ['a missing id', { ...PRIVATE_MESSAGE, id: undefined }],
  ['an empty peer id', { ...PRIVATE_MESSAGE, peerID: '' }],
  ['a body that is not text', { ...PRIVATE_MESSAGE, content: { text: 'hello' } }],
  ['a body over the size limit', { ...PRIVATE_MESSAGE, content: 'x'.repeat(262_145) }],
  ['a time that is not a number', { ...PRIVATE_MESSAGE, timestamp: 'now' }],
  ['a time that is not finite', { ...PRIVATE_MESSAGE, timestamp: Number.NaN }],
  ['a scope that is not text', { ...PRIVATE_MESSAGE, profileScope: 7 }],
  ['no payload at all', null],
  ['a list instead of an object', [PRIVATE_MESSAGE]],
])('turns down a private message with %s', (_what, payload) => {
  expect(readBLEPrivateMessage(payload)).toBeNull();
});

it('keeps a body as large as a nearby payment can be', () => {
  const content = 'x'.repeat(262_144);
  expect(readBLEPrivateMessage({ ...PRIVATE_MESSAGE, content })?.content).toHaveLength(262_144);
});

it('reads an optional field sent as null as absent', () => {
  expect(
    readBLEPeerIdentity({ peerID: 'peer-a', isFavorite: false, nostrPubkeyHex: null })
  ).toEqual({ peerID: 'peer-a', isFavorite: false });
  expect(
    readBLEDeliveryStatus({ messageID: 'm1', status: 'sent', nickname: null, reason: null })
  ).toEqual({ messageID: 'm1', status: 'sent' });
  expect(readBLEPrivateMessage({ ...PRIVATE_MESSAGE, profileScope: null })).toEqual({
    id: 'm1',
    peerID: 'peer-a',
    sender: 'Alice',
    content: 'hello',
    timestamp: 1_700_000_000_000,
    isOwn: false,
  });
});

it('keeps what a peer identity and a delivery status carry', () => {
  const identity = {
    peerID: 'peer-a',
    isFavorite: true,
    nostrPubkeyHex: 'a'.repeat(64),
    creq: 'creqAfixture',
  };
  expect(readBLEPeerIdentity(identity)).toEqual(identity);
  const status = { messageID: 'm1', status: 'delivered', nickname: 'Alice' };
  expect(readBLEDeliveryStatus(status)).toEqual(status);
  expect(readBLEDeliveryStatus({ messageID: 'm1', status: 'failed', reason: 'encode' })).toEqual({
    messageID: 'm1',
    status: 'failed',
    reason: 'encode',
  });
});

it('turns down a delivery status the app does not know, and one without a message', () => {
  expect(readBLEDeliveryStatus({ messageID: 'm1', status: 'teleported' })).toBeNull();
  expect(readBLEDeliveryStatus({ status: 'sent' })).toBeNull();
  expect(readBLEPeerIdentity({ peerID: 'peer-a' })).toBeNull();
});

it('keeps the good entries of a peer list and turns down an unknown peer event', () => {
  expect(readBLEPeerUpdate({ type: 'list', peers: ['peer-a', 7, '', 'peer-b'] })).toEqual({
    type: 'list',
    peers: ['peer-a', 'peer-b'],
  });
  expect(readBLEPeerUpdate({ type: 'connected', peerID: 'peer-a' })).toEqual({
    type: 'connected',
    peerID: 'peer-a',
  });
  expect(readBLEPeerUpdate({ type: 'vanished', peerID: 'peer-a' })).toBeNull();
  expect(readBLEPeerUpdate({ type: 'connected' })).toBeNull();
  expect(readBLEPeerUpdate({ type: 'list', peers: 'peer-a' })).toBeNull();
  expect(readBLEPeerUpdate({ type: 'list', peers: Array(1025).fill('peer-a') })).toBeNull();
});

it('reads public, state, background and geohash events, and turns down malformed ones', () => {
  expect(readBLEMessage(PUBLIC_MESSAGE)).toEqual(PUBLIC_MESSAGE);
  expect(readBLEMessage({ ...PUBLIC_MESSAGE, isPrivate: undefined })).toBeNull();
  // iOS sends '' for a sender whose peer id it does not know.
  expect(readBLEMessage({ ...PUBLIC_MESSAGE, senderPeerID: '' })?.senderPeerID).toBe('');

  expect(readBLEState({ state: 'poweredOn' })).toEqual({ state: 'poweredOn' });
  expect(readBLEState({ state: 5 })).toBeNull();
  expect(readBLEBackgroundTaskExpiring({ handle: 3 })).toEqual({ handle: 3 });
  expect(readBLEBackgroundTaskExpiring({ handle: '3' })).toBeNull();

  expect(readNostrMessage(GEOHASH_MESSAGE)).toEqual(GEOHASH_MESSAGE);
  expect(readNostrMessage({ ...GEOHASH_MESSAGE, senderPubkey: undefined })).toBeNull();
  expect(readNostrPrivateMessage(GEOHASH_MESSAGE)).toEqual(GEOHASH_MESSAGE);
  expect(readNostrPrivateMessage({ ...GEOHASH_MESSAGE, senderPubkey: '' })).toBeNull();
});
