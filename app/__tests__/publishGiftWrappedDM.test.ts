/**
 * @jest-environment node
 *
 * Characterization of `publishGiftWrappedDM`, the publisher the Send flow
 * uses to hand a bearer ecash token to a Nostr contact. The real NIP-17
 * construction and unwrap run; only NDK publication is replaced, by an
 * `NDKEvent` whose `publish()` records the event and can be made to fail.
 */

import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';

import { publishGiftWrappedDM } from '@/shared/lib/nostr/publishGiftWrappedDM';
import { unwrapGiftWrap } from '@/shared/lib/nostr/nip17';

type Published = {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  pubkey: string;
  id: string;
  sig: string;
};

const mockPublished: Published[] = [];
const mockOutcomes: (() => Promise<unknown>)[] = [];

jest.mock('@nostr-dev-kit/ndk-mobile', () => {
  class NDKEvent {
    kind = 0;
    content = '';
    tags: string[][] = [];
    created_at = 0;
    pubkey = '';
    id = '';
    sig = '';
    publish() {
      mockPublished.push({
        kind: this.kind,
        content: this.content,
        tags: this.tags,
        created_at: this.created_at,
        pubkey: this.pubkey,
        id: this.id,
        sig: this.sig,
      });
      const next = mockOutcomes.shift();
      return next ? next() : Promise.resolve(new Set(['wss://relay.example']));
    }
  }
  return { __esModule: true, default: class NDK {}, NDKEvent };
});

// A dummy bearer token: these tests never touch real proofs.
const TOKEN = 'cashuBdummy-bearer-token-for-tests';

const senderKey = generateSecretKey();
const senderPub = getPublicKey(senderKey);
const recipientKey = generateSecretKey();
const recipientPub = getPublicKey(recipientKey);
const outsiderKey = generateSecretKey();

const ndk: never = Object.create(null) as never;

function send(extra: { extraTags?: string[][] } = {}) {
  return publishGiftWrappedDM({
    ndk,
    senderPrivateKey: senderKey,
    recipientPublicKey: recipientPub,
    content: TOKEN,
    ...extra,
  });
}

beforeEach(() => {
  mockPublished.length = 0;
  mockOutcomes.length = 0;
});

test('publishes two distinct signed kind-1059 wraps, the recipient one first', async () => {
  await send();

  expect(mockPublished).toHaveLength(2);
  const [first, second] = mockPublished;
  expect(first.kind).toBe(1059);
  expect(second.kind).toBe(1059);
  expect(first.id).not.toBe(second.id);
  expect(first.pubkey).not.toBe(second.pubkey);
  expect(verifyEvent(first as never)).toBe(true);
  expect(verifyEvent(second as never)).toBe(true);
  expect(first.tags).toContainEqual(['p', recipientPub]);
  expect(second.tags).toContainEqual(['p', senderPub]);
  // Neither wrap is signed by, or exposes, the sender's own key.
  expect(first.pubkey).not.toBe(senderPub);
  expect(second.pubkey).not.toBe(senderPub);
});

test('the recipient can open its wrap and read the token from the sender', async () => {
  await send();
  const opened = unwrapGiftWrap(mockPublished[0], recipientKey);

  expect(opened).toMatchObject({ senderPubkey: senderPub, content: TOKEN, kind: 14 });
  expect(opened?.recipientPubkeys).toEqual([recipientPub]);
});

test('the sender can open the self-copy, and the recipient cannot', async () => {
  await send();
  const selfCopy = mockPublished[1];

  expect(unwrapGiftWrap(selfCopy, senderKey)?.content).toBe(TOKEN);
  expect(unwrapGiftWrap(selfCopy, recipientKey)).toBeNull();
});

test('someone else cannot open either wrap', async () => {
  await send();

  expect(unwrapGiftWrap(mockPublished[0], outsiderKey)).toBeNull();
  expect(unwrapGiftWrap(mockPublished[1], outsiderKey)).toBeNull();
});

test('the token never appears in clear in a published event', async () => {
  await send();

  for (const event of mockPublished) {
    expect(event.content).not.toContain(TOKEN);
    expect(JSON.stringify(event.tags)).not.toContain(TOKEN);
  }
});

test('it returns the self-copy wrap id, not the recipient wrap id', async () => {
  const { selfWrapId } = await send();

  expect(selfWrapId).toBe(mockPublished[1].id);
  expect(selfWrapId).not.toBe(mockPublished[0].id);
});

test('a refused recipient wrap rejects and the self-copy is never published', async () => {
  mockOutcomes.push(() => Promise.reject(new Error('Not enough relays received the event')));

  await expect(send()).rejects.toThrow('Not enough relays received the event');
  expect(mockPublished).toHaveLength(1);
  expect(mockPublished[0].tags).toContainEqual(['p', recipientPub]);
});

test('a refused self-copy still resolves with the self-copy wrap id', async () => {
  mockOutcomes.push(
    () => Promise.resolve(new Set(['wss://relay.example'])),
    () => Promise.reject(new Error('self copy refused'))
  );

  const { selfWrapId } = await send();

  // QUIRK: the self-copy is best effort. Its id is returned (and used as the
  // local echo's dedup key) even though no relay holds that event.
  expect(mockPublished).toHaveLength(2);
  expect(selfWrapId).toBe(mockPublished[1].id);
});

test('it waits for the self-copy publish to settle before resolving', async () => {
  let releaseSelfCopy: () => void = () => {};
  mockOutcomes.push(
    () => Promise.resolve(new Set(['wss://relay.example'])),
    () =>
      new Promise((resolve) => {
        releaseSelfCopy = () => resolve(new Set());
      })
  );

  let settled = false;
  const pending = send().then((r) => {
    settled = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 0));
  expect(mockPublished).toHaveLength(2);
  expect(settled).toBe(false);

  releaseSelfCopy();
  await pending;
  expect(settled).toBe(true);
});

test('extra tags reach the decrypted message for both parties', async () => {
  await send({ extraTags: [['subject', 'ecash']] });

  expect(unwrapGiftWrap(mockPublished[0], recipientKey)?.tags).toContainEqual(['subject', 'ecash']);
  expect(unwrapGiftWrap(mockPublished[1], senderKey)?.tags).toContainEqual(['subject', 'ecash']);
});
