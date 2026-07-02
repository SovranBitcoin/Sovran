/**
 * @fileoverview Blossom (BUD-01) authorization event construction (pure).
 *
 * Blossom servers authorize a request with a signed `kind:24242` event passed
 * as `Authorization: Nostr <base64(event)>`. For an upload the event carries
 * `["t","upload"]`, the blob's `["x",<sha256>]`, and an `["expiration",<unix>]`.
 * This module builds the unsigned event + encodes the header; signing happens
 * in the client with the active key.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** Blossom authorization event kind (BUD-01). */
export const BLOSSOM_AUTH_KIND = 24242;

export type BlossomAction = 'upload' | 'delete' | 'get' | 'list';

export interface UnsignedBlossomAuth {
  kind: number;
  content: string;
  created_at: number;
  tags: string[][];
}

/** sha256 hex of arbitrary bytes (Blossom's content address). */
export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/**
 * Builds the unsigned `kind:24242` authorization event for a Blossom action.
 * `expirationSec` defaults to 5 minutes out.
 */
export function buildBlossomAuthEvent(opts: {
  action: BlossomAction;
  sha256: string;
  createdAt: number;
  expirationSec?: number;
  content?: string;
}): UnsignedBlossomAuth {
  const expiration = opts.expirationSec ?? opts.createdAt + 5 * 60;
  return {
    kind: BLOSSOM_AUTH_KIND,
    content: opts.content ?? `Authorize ${opts.action}`,
    created_at: opts.createdAt,
    tags: [
      ['t', opts.action],
      ['x', opts.sha256],
      ['expiration', String(expiration)],
    ],
  };
}

/**
 * Encodes a signed event into the `Authorization: Nostr <base64>` header value.
 * Accepts the serialized JSON of a signed event.
 */
export function encodeAuthHeader(signedEventJson: string): string {
  // base64 of the UTF-8 JSON. Uses the same byte helpers as the rest of the
  // crypto layer rather than relying on a global btoa.
  const bytes = utf8ToBytes(signedEventJson);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);

  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return `Nostr ${base64}`;
}
