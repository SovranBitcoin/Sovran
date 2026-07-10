/**
 * @jest-environment node
 */

import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  nip44,
  type Event as NostrEvent,
  type UnsignedEvent,
} from 'nostr-tools';

import { buildGiftWrappedDMPair, unwrapGiftWrap } from '@/shared/lib/nostr/nip17';

type Rumor = UnsignedEvent & { id: string };

function encryptJson(value: object, privateKey: Uint8Array, publicKey: string): string {
  const conversationKey = nip44.v2.utils.getConversationKey(privateKey, publicKey);
  return nip44.v2.encrypt(JSON.stringify(value), conversationKey);
}

function createRumor(senderPublicKey: string, recipientPublicKey: string): Rumor {
  const unsigned: UnsignedEvent = {
    kind: 14,
    pubkey: senderPublicKey,
    created_at: 1_700_000_000,
    tags: [['p', recipientPublicKey]],
    content: 'authenticated hello',
  };
  return { ...unsigned, id: getEventHash(unsigned) };
}

function createSeal(
  rumor: Rumor,
  senderPrivateKey: Uint8Array,
  recipientPublicKey: string,
  kind = 13
): NostrEvent {
  return finalizeEvent(
    {
      kind,
      created_at: 1_700_000_001,
      tags: [],
      content: encryptJson(rumor, senderPrivateKey, recipientPublicKey),
    },
    senderPrivateKey
  );
}

function wrapSeal(seal: object, recipientPublicKey: string): NostrEvent {
  const wrapPrivateKey = generateSecretKey();
  return finalizeEvent(
    {
      kind: 1059,
      created_at: 1_700_000_002,
      tags: [['p', recipientPublicKey]],
      content: encryptJson(seal, wrapPrivateKey, recipientPublicKey),
    },
    wrapPrivateKey
  );
}

function changeFirstHex(value: string): string {
  return `${value[0] === '0' ? '1' : '0'}${value.slice(1)}`;
}

describe('NIP-17 gift wraps', () => {
  it('round-trips the recipient and sender self-copy with one recipient-bound rumor', () => {
    const senderPrivateKey = generateSecretKey();
    const senderPublicKey = getPublicKey(senderPrivateKey);
    const recipientPrivateKey = generateSecretKey();
    const recipientPublicKey = getPublicKey(recipientPrivateKey);
    const wrongPrivateKey = generateSecretKey();

    const { recipientWrap, senderWrap } = buildGiftWrappedDMPair({
      content: 'private hello',
      senderPrivateKey,
      recipientPublicKey,
      extraTags: [['subject', 'greeting']],
    });

    const recipientCopy = unwrapGiftWrap(recipientWrap, recipientPrivateKey);
    const senderCopy = unwrapGiftWrap(senderWrap, senderPrivateKey);

    expect(recipientCopy).toMatchObject({
      senderPubkey: senderPublicKey,
      recipientPubkeys: [recipientPublicKey],
      content: 'private hello',
      kind: 14,
    });
    expect(senderCopy).toMatchObject({
      senderPubkey: senderPublicKey,
      recipientPubkeys: [recipientPublicKey],
      content: 'private hello',
      kind: 14,
    });
    expect(recipientCopy?.tags).toContainEqual(['subject', 'greeting']);
    expect(senderCopy?.tags).toEqual(recipientCopy?.tags);

    expect(recipientWrap.tags).toEqual([['p', recipientPublicKey]]);
    expect(senderWrap.tags).toEqual([['p', senderPublicKey]]);
    expect(recipientWrap.pubkey).not.toBe(senderPublicKey);
    expect(recipientWrap.pubkey).not.toBe(recipientPublicKey);
    expect(senderWrap.pubkey).not.toBe(senderPublicKey);
    expect(senderWrap.pubkey).not.toBe(recipientPublicKey);
    expect(unwrapGiftWrap(recipientWrap, wrongPrivateKey)).toBeNull();
  });

  it('rejects a seal with a tampered Schnorr signature', () => {
    const senderPrivateKey = generateSecretKey();
    const recipientPrivateKey = generateSecretKey();
    const recipientPublicKey = getPublicKey(recipientPrivateKey);
    const rumor = createRumor(getPublicKey(senderPrivateKey), recipientPublicKey);
    const seal = createSeal(rumor, senderPrivateKey, recipientPublicKey);
    const tamperedSeal = { ...seal, sig: changeFirstHex(seal.sig) };

    expect(
      unwrapGiftWrap(wrapSeal(tamperedSeal, recipientPublicKey), recipientPrivateKey)
    ).toBeNull();
  });

  it('rejects a rumor whose content no longer matches its id', () => {
    const senderPrivateKey = generateSecretKey();
    const recipientPrivateKey = generateSecretKey();
    const recipientPublicKey = getPublicKey(recipientPrivateKey);
    const rumor = createRumor(getPublicKey(senderPrivateKey), recipientPublicKey);
    rumor.content = 'tampered after hashing';
    const seal = createSeal(rumor, senderPrivateKey, recipientPublicKey);

    expect(unwrapGiftWrap(wrapSeal(seal, recipientPublicKey), recipientPrivateKey)).toBeNull();
  });

  it('rejects a rumor that claims a different author from its signed seal', () => {
    const senderPrivateKey = generateSecretKey();
    const claimedAuthorPrivateKey = generateSecretKey();
    const recipientPrivateKey = generateSecretKey();
    const recipientPublicKey = getPublicKey(recipientPrivateKey);
    const rumor = createRumor(getPublicKey(claimedAuthorPrivateKey), recipientPublicKey);
    const seal = createSeal(rumor, senderPrivateKey, recipientPublicKey);

    expect(unwrapGiftWrap(wrapSeal(seal, recipientPublicKey), recipientPrivateKey)).toBeNull();
  });

  it('rejects a correctly signed inner event that is not a kind 13 seal', () => {
    const senderPrivateKey = generateSecretKey();
    const recipientPrivateKey = generateSecretKey();
    const recipientPublicKey = getPublicKey(recipientPrivateKey);
    const rumor = createRumor(getPublicKey(senderPrivateKey), recipientPublicKey);
    const wrongKindSeal = createSeal(rumor, senderPrivateKey, recipientPublicKey, 14);

    expect(
      unwrapGiftWrap(wrapSeal(wrongKindSeal, recipientPublicKey), recipientPrivateKey)
    ).toBeNull();
  });
});
