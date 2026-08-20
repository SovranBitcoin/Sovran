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

import type { UnsignedEvent, VerifiedEvent, Event as NostrToolsEvent } from 'nostr-tools';
import {
  getPublicKey,
  getEventHash,
  nip44,
  finalizeEvent,
  generateSecretKey,
  verifyEvent,
} from 'nostr-tools';
import { z } from 'zod';
import { Hex64, Hex128 } from '@sovranbitcoin/schemas';

import { nostrLog } from '../logger';

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

/** Return a CSPRNG-random timestamp within the last 2 days for metadata privacy. */
const randomNow = (): number => {
  const random = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  return Math.round(now() - random * TWO_DAYS);
};

const nip44ConversationKey = (privateKey: Uint8Array, publicKey: string): Uint8Array =>
  nip44.v2.utils.getConversationKey(privateKey, publicKey);

const nip44Encrypt = (data: object, privateKey: Uint8Array, publicKey: string): string =>
  nip44.v2.encrypt(JSON.stringify(data), nip44ConversationKey(privateKey, publicKey));

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
  nostrLog.debug('nostr.nip17.create_rumor', {
    kind: event.kind,
    contentLen: event.content.length,
    tagCount: event.tags?.length ?? 0,
  });
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
  nostrLog.debug('nostr.nip17.create_seal', {
    rumorId: rumor.id?.slice(0, 8),
    recipientPrefix: recipientPublicKey.slice(0, 8),
  });
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
  nostrLog.debug('nostr.nip17.create_wrap', { recipientPrefix: recipientPublicKey.slice(0, 8) });
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
 * Build a pair of gift-wrapped NIP-17 DMs: one for the recipient and one
 * self-copy for the sender.
 *
 * Per the NIP-17 spec the **same rumor** (with the actual recipient in the
 * `p` tag) must be sealed and wrapped individually for each target.  This
 * ensures the sender can later retrieve their own sent messages and that the
 * inner rumor correctly identifies the conversation partner.
 *
 * NOTE: each gift-wrap does 1 Schnorr signature + 1 NIP-44 encrypt (≈ 500ms
 * on Hermes on a mid-range device). Building BOTH pair members back-to-back
 * blocks the JS thread for ~1s per recipient. When responsiveness matters,
 * use `buildRecipientGiftWrap` for the critical path and
 * `buildSenderSelfCopyWrap` for an off-thread/deferred self-copy instead.
 */
export function buildGiftWrappedDMPair(params: {
  content: string;
  senderPrivateKey: Uint8Array;
  recipientPublicKey: string;
  extraTags?: string[][];
}): { recipientWrap: VerifiedEvent; senderWrap: VerifiedEvent } {
  const { rumor, recipientWrap } = buildRecipientGiftWrap(params);
  const senderWrap = buildSenderSelfCopyWrap({
    rumor,
    senderPrivateKey: params.senderPrivateKey,
  });
  return { recipientWrap, senderWrap };
}

/**
 * Build only the recipient-facing gift-wrap (rumor + kind-13 seal +
 * kind-1059 wrap). Returns the rumor too so `buildSenderSelfCopyWrap` can
 * reuse it for the sender's self-copy wrap — the NIP-17 spec mandates the
 * same rumor flows to both targets.
 *
 * Use this on the critical path when you need the fastest possible publish
 * of the recipient's DM; defer `buildSenderSelfCopyWrap` to a background
 * task so its Schnorr + NIP-44 work doesn't block the JS thread.
 */
export function buildRecipientGiftWrap(params: {
  content: string;
  senderPrivateKey: Uint8Array;
  recipientPublicKey: string;
  extraTags?: string[][];
}): { rumor: Rumor; recipientWrap: VerifiedEvent } {
  const { content, senderPrivateKey, recipientPublicKey, extraTags } = params;
  nostrLog.info('nostr.nip17.build_recipient_wrap', {
    contentLen: content.length,
    recipientPrefix: recipientPublicKey.slice(0, 8),
  });

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
  return { rumor, recipientWrap };
}

/**
 * Build only the sender self-copy gift-wrap, reusing the rumor returned by
 * `buildRecipientGiftWrap`. Designed to be called from a background task
 * (setTimeout, InteractionManager, microtask) so the Schnorr + NIP-44 work
 * doesn't delay the caller's primary delivery.
 */
function buildSenderSelfCopyWrap(params: {
  rumor: Rumor;
  senderPrivateKey: Uint8Array;
}): VerifiedEvent {
  const { rumor, senderPrivateKey } = params;
  const senderPublicKey = getPublicKey(senderPrivateKey);
  nostrLog.info('nostr.nip17.build_sender_wrap', {
    senderPrefix: senderPublicKey.slice(0, 8),
  });
  const senderSeal = createSeal(rumor, senderPrivateKey, senderPublicKey);
  return createWrap(senderSeal, senderPublicKey);
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

// NIP-59 envelope shapes. Tag arrays at this layer can be empty (kind 13
// seals MUST carry zero tags per spec), so we don't reuse `Tag` from
// @sovranbitcoin/schemas which enforces .min(1). Bounds match the
// outer wrap caps already enforced by `nip44DecryptNative`.
const TagElement = z.string().max(4096);
const LooseTags = z.array(z.array(TagElement).max(64)).max(2048);
// `created_at` is intentionally unrefined: NIP-59 randomises seal/wrap
// timestamps within the past two days for metadata privacy, and incoming
// rumors carry the sender's clock. Future-skew bounds belong on the
// public wrap event, which is verified by the relay layer — not here.
const Timestamp = z.number().int().nonnegative();
const ContentString = z.string().max(100_000);

const SealEventSchema = z.object({
  id: Hex64,
  pubkey: Hex64,
  created_at: Timestamp,
  kind: z.literal(13),
  tags: LooseTags,
  content: ContentString,
  sig: Hex128,
});

const RumorEventSchema = z.object({
  id: Hex64,
  pubkey: Hex64,
  created_at: Timestamp,
  kind: z.number().int().min(0).max(65535),
  tags: LooseTags,
  content: ContentString,
});

/**
 * Unwrap a kind 1059 gift-wrapped event to reveal the inner DM.
 *
 * Decryption layers:
 *   1. Gift wrap content → kind 13 seal  (using recipient's key + wrap pubkey)
 *   2. Seal content      → kind 14 rumor (using recipient's key + seal pubkey)
 *
 * Each decrypted JSON is validated against a zod schema before further
 * processing; the seal's Schnorr signature is checked via `verifyEvent`,
 * and the rumor's `id` is recomputed via `getEventHash` to detect tampering
 * after the sender originally hashed it. Returns `null` on any failure.
 */
export function unwrapGiftWrap(
  wrapEvent: { content: string; pubkey: string },
  recipientPrivateKey: Uint8Array
): UnwrappedDM | null {
  nostrLog.debug('nostr.nip17.unwrap_gift_wrap.start', {
    wrapPubkeyPrefix: wrapEvent.pubkey.slice(0, 8),
    contentLen: wrapEvent.content.length,
  });
  try {
    // Layer 1: decrypt the gift wrap → seal
    const sealRaw = nip44Decrypt(wrapEvent.content, recipientPrivateKey, wrapEvent.pubkey);
    const sealParsed = SealEventSchema.safeParse(sealRaw);
    if (!sealParsed.success) {
      nostrLog.warn('nostr.nip17.unwrap_gift_wrap.invalid_seal_shape', {
        issues: sealParsed.error.issues.length,
      });
      return null;
    }
    const seal = sealParsed.data;

    // NIP-59: the seal MUST be signed by the sender. Without this check the
    // unwrap relies solely on NIP-44 ECDH binding for sender authentication;
    // the spec requires the schnorr sig as a defence-in-depth integrity gate.
    if (!verifyEvent(seal as NostrToolsEvent)) {
      nostrLog.warn('nostr.nip17.unwrap_gift_wrap.seal_sig_invalid', {
        sealPrefix: seal.pubkey.slice(0, 8),
      });
      return null;
    }

    // Layer 2: decrypt the seal → rumor
    const rumorRaw = nip44Decrypt(seal.content, recipientPrivateKey, seal.pubkey);
    const rumorParsed = RumorEventSchema.safeParse(rumorRaw);
    if (!rumorParsed.success) {
      nostrLog.warn('nostr.nip17.unwrap_gift_wrap.invalid_rumor_shape', {
        issues: rumorParsed.error.issues.length,
      });
      return null;
    }
    const rumor = rumorParsed.data;

    // NIP-59: the rumor is unsigned, so we use `id == getEventHash(rumor)`
    // as the integrity gate — a tampered rumor lands with a stale id and
    // we drop it before any consumer sees the payload.
    if (getEventHash(rumor as UnsignedEvent) !== rumor.id) {
      nostrLog.warn('nostr.nip17.unwrap_gift_wrap.rumor_id_mismatch', {
        senderPrefix: rumor.pubkey.slice(0, 8),
      });
      return null;
    }

    // NIP-17: verify that the seal's pubkey matches the rumor's pubkey
    if (seal.pubkey !== rumor.pubkey) {
      nostrLog.warn('nostr.nip17.unwrap_gift_wrap.pubkey_mismatch', {
        sealPrefix: seal.pubkey.slice(0, 8),
        rumorPrefix: rumor.pubkey.slice(0, 8),
      });
      return null;
    }

    nostrLog.info('nostr.nip17.unwrap_gift_wrap.success', {
      senderPrefix: seal.pubkey.slice(0, 8),
      rumorKind: rumor.kind,
      contentLen: rumor.content.length,
    });
    return {
      senderPubkey: seal.pubkey,
      recipientPubkeys: rumor.tags.filter((t) => t[0] === 'p').map((t) => t[1]),
      content: rumor.content,
      created_at: rumor.created_at,
      kind: rumor.kind,
      tags: rumor.tags,
    };
  } catch {
    nostrLog.error('nostr.nip17.unwrap_gift_wrap.decryption_failed', {
      wrapPubkeyPrefix: wrapEvent.pubkey.slice(0, 8),
    });
    return null;
  }
}
