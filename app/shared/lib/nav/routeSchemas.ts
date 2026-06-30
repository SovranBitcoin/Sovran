/**
 * @fileoverview Route-boundary validation primitives.
 *
 * Single source of truth for the regex-shaped schemas every route file
 * was previously redeclaring inline. Per AUDIT.md dim-5 every untrusted
 * deep-link input must cross a schema seam before the rest of the tree
 * sees it; that seam now lives here, not scattered across `app/**`.
 *
 * Cross-package primitives (Hex64, LightningAddress) are re-exported
 * from `@sovranbitcoin/schemas` so callers can pull everything from one
 * import. The remaining shapes — `Npub`, `CompressedPubkey`, `Hex16`,
 * `Geohash`, `HttpsUrl` — are route-only concerns that don't belong in
 * the cross-repo trust-boundary package.
 */

import { z } from 'zod';

import { Hex64, LightningAddress } from '@sovranbitcoin/schemas';

export { Hex64, LightningAddress };

/** NIP-19 npub bech32 string. Loose shape — full bech32 decoding is at the call site. */
export const Npub = z.string().regex(/^npub1[02-9ac-hj-np-z]{58,}$/, 'invalid npub');

/** Compressed secp256k1 public key — 33-byte hex (P2PK recipient). */
export const CompressedPubkey = z
  .string()
  .regex(/^0[23][0-9a-f]{64}$/, 'expected compressed pubkey (66-char hex)');

/** 16-char lowercase hex — bitchat BLE PeerID. */
export const Hex16 = z.string().regex(/^[0-9a-f]{16}$/, 'expected 16-char lowercase hex');

/** Base32 geohash, 1–12 chars — locator for bitchat geohash channels. */
export const Geohash = z.string().regex(/^[0-9bcdefghjkmnpqrstuvwxyz]{1,12}$/, 'invalid geohash');

/**
 * Bounded https-only URL — narrower than `HttpUrl` from schemas, which
 * also accepts `http://`. Used for mint URLs and other deep-link fields
 * where insecure transport is rejected at the boundary.
 */
export const HttpsUrl = z
  .string()
  .max(2048)
  .regex(/^https:\/\/[^\s]+$/, 'mintUrl must be https');
