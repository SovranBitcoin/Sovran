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

/**
 * Create an unsigned "rumor" event.
 *
 * Per NIP-59 the rumor MUST NOT be signed – its `id` is computed via
 * `getEventHash` so that receivers can verify integrity after decryption.
 */
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

/**
 * Create a kind 13 "seal" event.
 *
 * The seal encrypts the JSON-encoded rumor using NIP-44 with the conversation
 * key between the sender and the recipient, then signs with the sender's key.
 * Tags are always empty per NIP-59.
 */
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

/**
 * Create a kind 1059 "gift wrap" event.
 *
 * The gift wrap encrypts the JSON-encoded seal using NIP-44 with a random,
 * one-time-use keypair.  The `p` tag reveals only the intended recipient so
 * relays can route the event.
 */
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
// High-level helper: build a NIP-17 DM gift wrap
// ---------------------------------------------------------------------------

/**
 * Build a gift-wrapped NIP-17 direct message (kind 14) for a single
 * recipient.  Returns the kind 1059 event ready to publish.
 *
 * NOTE: If you also need a self-copy, use {@link buildGiftWrappedDMPair}
 * instead so the same rumor is reused for both wraps.
 */
export function buildGiftWrappedDM(params: {
  content: string;
  senderPrivateKey: Uint8Array;
  recipientPublicKey: string;
  /** Extra tags on the kind 14 rumor (e.g. reply `e` tags). */
  extraTags?: string[][];
}): VerifiedEvent {
  const { content, senderPrivateKey, recipientPublicKey, extraTags } = params;

  // 1. Rumor (kind 14 – unsigned)
  const rumor = createRumor(
    {
      kind: 14,
      content,
      tags: [['p', recipientPublicKey], ...(extraTags ?? [])],
    },
    senderPrivateKey
  );

  // 2. Seal (kind 13 – signed by sender, encrypted to recipient)
  const seal = createSeal(rumor, senderPrivateKey, recipientPublicKey);

  // 3. Gift wrap (kind 1059 – signed by random key, encrypted to recipient)
  return createWrap(seal, recipientPublicKey);
}

/**
 * Build a pair of gift-wrapped NIP-17 DMs: one for the recipient and one
 * self-copy for the sender.
 *
 * Per the NIP-17 spec the **same rumor** (with the actual recipient in the
 * `p` tag) must be sealed and wrapped individually for each target.  This
 * ensures the sender can later retrieve their own sent messages and that the
 * inner rumor correctly identifies the conversation partner.
 */
export function buildGiftWrappedDMPair(params: {
  content: string;
  senderPrivateKey: Uint8Array;
  recipientPublicKey: string;
  extraTags?: string[][];
}): { recipientWrap: VerifiedEvent; senderWrap: VerifiedEvent } {
  const { content, senderPrivateKey, recipientPublicKey, extraTags } = params;
  const senderPublicKey = getPublicKey(senderPrivateKey);

  // 1. Rumor (kind 14 – unsigned) – shared across both wraps
  const rumor = createRumor(
    {
      kind: 14,
      content,
      tags: [['p', recipientPublicKey], ...(extraTags ?? [])],
    },
    senderPrivateKey
  );

  // 2a. Wrap for the recipient
  const recipientSeal = createSeal(rumor, senderPrivateKey, recipientPublicKey);
  const recipientWrap = createWrap(recipientSeal, recipientPublicKey);

  // 2b. Wrap for the sender (self-copy – same rumor, encrypted to self)
  const senderSeal = createSeal(rumor, senderPrivateKey, senderPublicKey);
  const senderWrap = createWrap(senderSeal, senderPublicKey);

  return { recipientWrap, senderWrap };
}

// ---------------------------------------------------------------------------
// High-level helper: unwrap a received NIP-17 gift wrap
// ---------------------------------------------------------------------------

/** Result of unwrapping a kind 1059 gift-wrapped event. */
export interface UnwrappedDM {
  /** The actual sender's pubkey (from the kind 13 seal). */
  senderPubkey: string;
  /** The recipient pubkey(s) from the kind 14 rumor's `p` tags. */
  recipientPubkeys: string[];
  /** The plain-text message content. */
  content: string;
  /** The canonical created_at timestamp from the rumor. */
  created_at: number;
  /** The rumor's kind (typically 14). */
  kind: number;
  /** The rumor's full tags array. */
  tags: string[][];
}

/**
 * Unwrap a kind 1059 gift-wrapped event to reveal the inner DM.
 *
 * Decryption layers:
 *   1. Gift wrap content → kind 13 seal  (using recipient's key + wrap pubkey)
 *   2. Seal content      → kind 14 rumor (using recipient's key + seal pubkey)
 *
 * Returns `null` if decryption fails at any layer.
 */
export function unwrapGiftWrap(
  wrapEvent: { content: string; pubkey: string },
  recipientPrivateKey: Uint8Array
): UnwrappedDM | null {
  try {
    // Layer 1: decrypt the gift wrap → seal
    const seal = nip44Decrypt(wrapEvent.content, recipientPrivateKey, wrapEvent.pubkey) as {
      pubkey: string;
      content: string;
      kind: number;
    };

    if (seal.kind !== 13) return null;

    // Layer 2: decrypt the seal → rumor
    const rumor = nip44Decrypt(seal.content, recipientPrivateKey, seal.pubkey) as {
      pubkey: string;
      content: string;
      created_at: number;
      kind: number;
      tags: string[][];
    };

    // NIP-17: verify that the seal's pubkey matches the rumor's pubkey
    if (seal.pubkey !== rumor.pubkey) return null;

    return {
      senderPubkey: seal.pubkey,
      recipientPubkeys: (rumor.tags || []).filter((t) => t[0] === 'p').map((t) => t[1]),
      content: rumor.content,
      created_at: rumor.created_at,
      kind: rumor.kind,
      tags: rumor.tags || [],
    };
  } catch {
    return null;
  }
}
