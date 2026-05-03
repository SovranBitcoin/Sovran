/**
 * @fileoverview NIP-17 / NIP-59 Gift Wrap Utilities
 *
 * Implements the three-layer gift-wrapping protocol for private direct messages:
 *   1. Rumor  – unsigned kind 14 event (the actual message)
 *   2. Seal   – kind 13, encrypts the rumor with NIP-44, signed by sender
 *   3. Wrap   – kind 1059, encrypts the seal with a random throwaway key
 *
 * Reference: https://github.com/nostr-protocol/nips/blob/master/59.md
 *            https://github.com/nostr-protocol/nips/blob/master/17.md
 */

import type { UnsignedEvent, VerifiedEvent } from 'nostr-tools';
import { getPublicKey, getEventHash, nip44, finalizeEvent, generateSecretKey } from 'nostr-tools';

import { errField, logger } from '../logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An unsigned Nostr event with a computed id (a "rumor"). */
type Rumor = UnsignedEvent & { id: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TWO_DAYS = 2 * 24 * 60 * 60;

const now = (): number => Math.round(Date.now() / 1000);

/** Return a random timestamp within the last 2 days (for metadata privacy). */
const randomNow = (): number => Math.round(now() - Math.random() * TWO_DAYS);

/** Derive a NIP-44 conversation key from a private key and a public key. */
const nip44ConversationKey = (privateKey: Uint8Array, publicKey: string) =>
  nip44.v2.utils.getConversationKey(privateKey, publicKey);

/** NIP-44-encrypt any JSON-serialisable data. */
const nip44Encrypt = (data: object, privateKey: Uint8Array, publicKey: string): string =>
  nip44.v2.encrypt(JSON.stringify(data), nip44ConversationKey(privateKey, publicKey));

/** NIP-44-decrypt a ciphertext and return the parsed JSON. */
const nip44Decrypt = (ciphertext: string, privateKey: Uint8Array, peerPublicKey: string): unknown =>
  JSON.parse(nip44.v2.decrypt(ciphertext, nip44ConversationKey(privateKey, peerPublicKey)));

// ---------------------------------------------------------------------------
// Core NIP-59 building blocks
// ---------------------------------------------------------------------------

function createRumor(
  event: { kind: number; content: string; tags?: string[][]; created_at?: number },
  senderPrivateKey: Uint8Array
): Rumor {
  const rumor: Record<string, unknown> = {
    created_at: now(),
    tags: [],
    ...event,
    pubkey: getPublicKey(senderPrivateKey),
  };

  rumor.id = getEventHash(rumor as UnsignedEvent);

  return rumor as unknown as Rumor;
}

function createSeal(
  rumor: Rumor,
  senderPrivateKey: Uint8Array,
  recipientPublicKey: string
): VerifiedEvent {
  return finalizeEvent(
    {
      kind: 13,
      content: nip44Encrypt(rumor, senderPrivateKey, recipientPublicKey),
      created_at: randomNow(),
      tags: [],
    },
    senderPrivateKey
  ) as VerifiedEvent;
}

function createWrap(seal: VerifiedEvent, recipientPublicKey: string): VerifiedEvent {
  const randomKey = generateSecretKey();

  return finalizeEvent(
    {
      kind: 1059,
      content: nip44Encrypt(seal, randomKey, recipientPublicKey),
      created_at: randomNow(),
      tags: [['p', recipientPublicKey]],
    },
    randomKey
  ) as VerifiedEvent;
}

// ---------------------------------------------------------------------------
// High-level helpers
// ---------------------------------------------------------------------------

export function buildGiftWrappedDM(params: {
  content: string;
  senderPrivateKey: Uint8Array;
  recipientPublicKey: string;
  extraTags?: string[][];
}): VerifiedEvent {
  const { content, senderPrivateKey, recipientPublicKey, extraTags } = params;

  const rumor = createRumor(
    {
      kind: 14,
      content,
      tags: [['p', recipientPublicKey], ...(extraTags ?? [])],
    },
    senderPrivateKey
  );

  const seal = createSeal(rumor, senderPrivateKey, recipientPublicKey);
  return createWrap(seal, recipientPublicKey);
}

export function buildGiftWrappedDMPair(params: {
  content: string;
  senderPrivateKey: Uint8Array;
  recipientPublicKey: string;
  extraTags?: string[][];
}): { recipientWrap: VerifiedEvent; senderWrap: VerifiedEvent } {
  const { content, senderPrivateKey, recipientPublicKey, extraTags } = params;
  const senderPublicKey = getPublicKey(senderPrivateKey);

  const rumor = createRumor(
    {
      kind: 14,
      content,
      tags: [['p', recipientPublicKey], ...(extraTags ?? [])],
    },
    senderPrivateKey
  );

  const recipientSeal = createSeal(rumor, senderPrivateKey, recipientPublicKey);
  const recipientWrap = createWrap(recipientSeal, recipientPublicKey);

  const senderSeal = createSeal(rumor, senderPrivateKey, senderPublicKey);
  const senderWrap = createWrap(senderSeal, senderPublicKey);

  return { recipientWrap, senderWrap };
}

/** Result of unwrapping a kind 1059 gift-wrapped event. */
export interface UnwrappedDM {
  senderPubkey: string;
  recipientPubkeys: string[];
  content: string;
  created_at: number;
  kind: number;
  tags: string[][];
}

export function unwrapGiftWrap(
  wrapEvent: { content: string; pubkey: string },
  recipientPrivateKey: Uint8Array
): UnwrappedDM | null {
  try {
    const seal = nip44Decrypt(wrapEvent.content, recipientPrivateKey, wrapEvent.pubkey) as {
      pubkey: string;
      content: string;
      kind: number;
    };

    if (seal.kind !== 13) return null;

    const rumor = nip44Decrypt(seal.content, recipientPrivateKey, seal.pubkey) as {
      pubkey: string;
      content: string;
      created_at: number;
      kind: number;
      tags: string[][];
    };

    if (seal.pubkey !== rumor.pubkey) return null;

    return {
      senderPubkey: seal.pubkey,
      recipientPubkeys: (rumor.tags || []).filter((t) => t[0] === 'p').map((t) => t[1]),
      content: rumor.content,
      created_at: rumor.created_at,
      kind: rumor.kind,
      tags: rumor.tags || [],
    };
  } catch (e) {
    logger.warn('nostr.unwrapGiftWrap.failed', { error: errField(e) });
    return null;
  }
}
