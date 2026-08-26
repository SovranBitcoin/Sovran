/**
 * Branded identifier types for the protocol domains (Cashu / Nostr), plus the
 * ONE sanctioned cross-domain cast. Shape-identical hex strings (a Nostr
 * x-only pubkey, a P2PK lock key, an event id) are different types here, so
 * cross-domain mixups fail to compile instead of failing at a mint.
 *
 * Brands are compile-time only — no runtime shape, no persisted-schema impact.
 * Dictionary + spec citations: skills/sovran-deslop/references/terminology.md.
 */

import { z } from 'zod';

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** 32-byte x-only Schnorr pubkey, lowercase hex (NIP-01). 64 hex chars. */
export type NostrPubkeyHex = Brand<string, 'nostr.pubkey.hex'>;

/**
 * 33-byte compressed secp256k1 P2PK lock key, hex (NUT-11: "Public keys MUST
 * use the compressed Secp256k1 public key format"). 66 hex chars, `02`/`03`
 * prefix. Sovran identity locks are always the `02` form (x-only lift), but a
 * true SEC1-compressed key from another wallet can legitimately be `03`.
 */
export type CashuP2pkPubkey = Brand<string, 'cashu.p2pk.pubkey'>;

/**
 * Curve25519 Noise static key hex (bitchat's own identity, present for every
 * BLE peer). Shape-identical to `NostrPubkeyHex` — 64 hex — but a DIFFERENT
 * curve: never use one where the other is expected (no kind-0 lookups by
 * noise key, no DMs addressed by noise key).
 */
export type NoisePubkeyHex = Brand<string, 'bitchat.noise.pubkey'>;

export const NOSTR_PUBKEY_HEX_RE = /^[0-9a-f]{64}$/;
export const CASHU_P2PK_PUBKEY_RE = /^0[23][0-9a-f]{64}$/i;

/**
 * Checked cast for hex arriving at runtime boundaries (native events, route
 * params, transport ids). Throws on shape mismatch — callers sit inside
 * try/catch send paths or validate-and-log flows. NOTE: shape alone cannot
 * distinguish a Nostr key from a Noise key; use this only where the SOURCE
 * guarantees Nostr provenance (e.g. `senderPubkey` from Nostr events).
 */
export function asNostrPubkeyHex(value: string): NostrPubkeyHex {
  if (!NOSTR_PUBKEY_HEX_RE.test(value)) {
    throw new Error(`not a nostr pubkey hex (len ${value.length})`);
  }
  return value as NostrPubkeyHex;
}

/** NIP-01 event id: sha256 of the serialized event — 64 hex, shape-identical
 * to a pubkey but a DIFFERENT thing; never validate one as the other's type. */
export type NostrEventId = Brand<string, 'nostr.event.id'>;

// Shared case-tolerant 64-hex runtime check (reads must stay byte-compatible
// with historically-accepted persisted data — sovran-data; NIP-01 says
// lowercase, so CONSTRUCTION uses the strict regexes above instead).
const isHex64 = (value: unknown): value is string =>
  typeof value === 'string' && value.length === 64 && /^[0-9a-f]+$/i.test(value);

/**
 * Case-TOLERANT guard for reads (persisted blobs, wire input) — deliberately
 * wider than the construction-side `NOSTR_PUBKEY_HEX_RE`; tightening a read
 * path fails the parse and wipes persisted blobs.
 */
export function isNostrPubkeyHex(value: unknown): value is NostrPubkeyHex {
  return isHex64(value);
}

/**
 * Canonical zod schemas for 64-hex nostr fields — same tolerant acceptance,
 * branded output. Replace the per-file `HexPubkeySchema`/`PubkeyHexSchema`/
 * `Hex64Schema` copies; pick by MEANING, not shape.
 */
export const NostrPubkeyHexSchema = z.custom<NostrPubkeyHex>(isHex64, 'expected 64 hex chars');
export const NostrEventIdSchema = z.custom<NostrEventId>(isHex64, 'expected 64-hex event id');

/**
 * The only legal Nostr→Cashu key cast: lift a BIP-340 x-only pubkey to the
 * even-Y compressed point (`02` + x). This is the identity-lock form Nut Drop
 * and P2PK receives compare against — every `'02' + pubkey` template in the
 * app must route through here so the invariant has one owner.
 *
 * Throws on malformed input: callers hold keys produced by nostr-tools, so a
 * bad shape is a programmer error, not a data condition.
 */
export function cashuP2pkPubkeyFromNostrHex(nostrPubkeyHex: string): CashuP2pkPubkey {
  if (!NOSTR_PUBKEY_HEX_RE.test(nostrPubkeyHex)) {
    throw new Error(`not a nostr x-only pubkey hex (len ${nostrPubkeyHex.length})`);
  }
  return `02${nostrPubkeyHex}` as CashuP2pkPubkey;
}
