/**
 * @fileoverview NUT-27 Nostr mint backup: the codec.
 *
 * Wallets such as cashu.me back their mint list up to Nostr relays: a kind
 * `30078` addressable event (`d` = `mint-list`) whose content is the list,
 * NIP-44 v2 encrypted to itself, signed by a key derived from the wallet seed:
 * `SHA256(seed || UTF-8("cashu-mint-backup"))`, where `seed` is the 64-byte
 * BIP-39 seed of the Cashu mnemonic. The same seed restored anywhere derives
 * the same key, finds the event and reads the mints back.
 *
 * Pure and read-mostly: no relay I/O, nothing saved. Recovery discovery reads
 * backups through it (`fetchBackedUpMintUrls`); `encodeMintBackupEvent` exists
 * for interop tests and a later backup writer. What a relay returns is
 * untrusted: an event counts only when it is signed by the derived key and
 * decrypts, and its plaintext must match the schema below.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import * as nip44 from 'nostr-tools/nip44';
import { finalizeEvent, getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure';
import { z } from 'zod';

export const MINT_BACKUP_KIND = 30078;
const MINT_BACKUP_D_TAG = 'mint-list';
const DOMAIN_SEPARATOR = new TextEncoder().encode('cashu-mint-backup');
/** BIP-39 `mnemonicToSeed` output length. */
const SEED_BYTES = 64;
/** A backup is a short list; anything bigger is not one. */
const MAX_BACKUP_MINTS = 200;
const MAX_MINT_URL_LENGTH = 2048;
/** NIP-44 v2 caps plaintext at 64 KiB; its base64 payload stays under this. */
const MAX_CONTENT_LENGTH = 100_000;

export interface MintBackupKeys {
  privateKey: Uint8Array;
  /** x-only, 32-byte hex: the event author to look for. */
  publicKeyHex: string;
}

/** The decrypted content. `timestamp` is optional: not every writer sets it. */
const MintBackupPayload = z.object({
  mints: z.array(z.string().min(1).max(MAX_MINT_URL_LENGTH)).max(MAX_BACKUP_MINTS),
  timestamp: z.number().int().nonnegative().optional(),
});
type MintBackupPayload = z.infer<typeof MintBackupPayload>;

/** The event fields the codec reads, as a relay delivers them. */
const MintBackupEventShape = z.object({
  id: z.string(),
  kind: z.literal(MINT_BACKUP_KIND),
  pubkey: z.string().regex(/^[0-9a-f]{64}$/),
  created_at: z.number().int().nonnegative(),
  content: z.string().max(MAX_CONTENT_LENGTH),
  tags: z.array(z.array(z.string())),
  sig: z.string(),
});

/** NUT-27 key pair for a wallet seed (the 64-byte BIP-39 seed). */
export function deriveMintBackupKeys(seed: Uint8Array): MintBackupKeys {
  if (seed.length !== SEED_BYTES) {
    throw new RangeError(`NUT-27 needs the ${SEED_BYTES}-byte BIP-39 seed`);
  }
  const combined = new Uint8Array(seed.length + DOMAIN_SEPARATOR.length);
  combined.set(seed);
  combined.set(DOMAIN_SEPARATOR, seed.length);
  const privateKey = sha256(combined);
  combined.fill(0);
  return { privateKey, publicKeyHex: getPublicKey(privateKey) };
}

/** The relay filter that finds a seed's backup. */
export function mintBackupFilter(publicKeyHex: string): {
  kinds: number[];
  authors: string[];
  '#d': string[];
} {
  return { kinds: [MINT_BACKUP_KIND], authors: [publicKeyHex], '#d': [MINT_BACKUP_D_TAG] };
}

function selfConversationKey(keys: MintBackupKeys): Uint8Array {
  return nip44.v2.utils.getConversationKey(keys.privateKey, keys.publicKeyHex);
}

/** A signed backup event for `mints`, as NUT-27 describes it. */
export function encodeMintBackupEvent(
  keys: MintBackupKeys,
  payload: MintBackupPayload,
  options: { createdAt: number; client?: string }
): Event {
  const plaintext = JSON.stringify(MintBackupPayload.parse(payload));
  return finalizeEvent(
    {
      kind: MINT_BACKUP_KIND,
      created_at: options.createdAt,
      tags: [['d', MINT_BACKUP_D_TAG], ...(options.client ? [['client', options.client]] : [])],
      content: nip44.v2.encrypt(plaintext, selfConversationKey(keys)),
    },
    keys.privateKey
  );
}

/**
 * The mint list in one relay event, or null when the event is not this seed's
 * backup: wrong kind or `d` tag, another author, a bad signature, content that
 * does not decrypt, or plaintext that does not match the schema.
 */
export function decodeMintBackupEvent(
  keys: MintBackupKeys,
  raw: unknown
): (MintBackupPayload & { createdAt: number }) | null {
  const event = MintBackupEventShape.safeParse(raw);
  if (!event.success) return null;
  const { data } = event;
  if (data.pubkey !== keys.publicKeyHex) return null;
  if (!data.tags.some((tag) => tag[0] === 'd' && tag[1] === MINT_BACKUP_D_TAG)) return null;
  if (!verifyEvent({ ...data })) return null;
  let plaintext: string;
  try {
    plaintext = nip44.v2.decrypt(data.content, selfConversationKey(keys));
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(plaintext);
  } catch {
    return null;
  }
  const payload = MintBackupPayload.safeParse(json);
  if (!payload.success) return null;
  return { ...payload.data, createdAt: data.created_at };
}

/** The newest valid backup among relay events (addressable: the latest wins). */
export function latestMintBackup(
  keys: MintBackupKeys,
  events: readonly unknown[]
): (MintBackupPayload & { createdAt: number }) | null {
  let latest: (MintBackupPayload & { createdAt: number }) | null = null;
  for (const raw of events) {
    const backup = decodeMintBackupEvent(keys, raw);
    if (backup && (!latest || backup.createdAt > latest.createdAt)) latest = backup;
  }
  return latest;
}
