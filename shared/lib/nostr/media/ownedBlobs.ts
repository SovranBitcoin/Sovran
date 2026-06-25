/**
 * @fileoverview Extract the Blossom blobs a note declares as "ours".
 *
 * A blob is identified by its content address (sha256). Two sources:
 *  - NIP-92 `imeta` tags — authoritative (`x` = sha256, `m` = mime, `url`).
 *  - bare blob URLs in `content` whose path basename is a 64-hex hash — the
 *    Blossom convention `<host>/<sha256>(.ext)?`, so the hash IS the basename.
 *
 * Pure: callers (the create hook, the ingest seams) feed events/descriptors in
 * and persist the result into `ownedMediaStore`.
 */
import { parseImetaTags } from '@/features/feed/components/nostr/feedParse';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import type { MediaDescriptor } from '@/shared/lib/nostr/media/types';

export interface OwnedBlob {
  /** Content address (lowercase hex), the store's key. */
  sha256: string;
  /** A URL the blob was seen at (used for the on-demand existence probe). */
  url: string;
  /** Origin the blob lives on (scheme+host) — delete/probe target. */
  host: string;
  mimeType?: string;
}

const SHA256_RE = /^[0-9a-f]{64}$/i;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The sha256 if `url` is a Blossom blob (its path basename is a 64-hex hash),
 * else null. Strips any extension + query.
 */
export function blossomSha256FromUrl(url: string): string | null {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (!last) return null;
    const base = last.split('.')[0];
    return SHA256_RE.test(base) ? base.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Blobs a note declares: imeta entries (with mime) plus blossom-shaped content
 * URLs. Deduped by sha256 — the imeta entry wins (it carries the mime).
 */
export function extractOwnedBlobs(event: FeedEvent): OwnedBlob[] {
  const bySha = new Map<string, OwnedBlob>();

  for (const info of parseImetaTags(event.tags).values()) {
    if (!info.sha256) continue;
    const host = originOf(info.url);
    if (!host) continue;
    const sha = info.sha256.toLowerCase();
    bySha.set(sha, { sha256: sha, url: info.url, host, mimeType: info.mimeType });
  }

  for (const raw of event.content.match(URL_RE) ?? []) {
    // Trim trailing sentence punctuation a URL regex tends to swallow.
    const url = raw.replace(/[.,);]+$/, '');
    const sha = blossomSha256FromUrl(url);
    if (!sha || bySha.has(sha)) continue;
    const host = originOf(url);
    if (!host) continue;
    bySha.set(sha, { sha256: sha, url, host });
  }

  return [...bySha.values()];
}

/** Blobs from composer media descriptors (the richest create-time source). */
export function extractOwnedBlobsFromDescriptors(
  descriptors: readonly MediaDescriptor[]
): OwnedBlob[] {
  const bySha = new Map<string, OwnedBlob>();
  for (const d of descriptors) {
    if (!d.sha256 || !d.url) continue;
    const host = originOf(d.url);
    if (!host) continue;
    const sha = d.sha256.toLowerCase();
    bySha.set(sha, { sha256: sha, url: d.url, host, mimeType: d.mimeType });
  }
  return [...bySha.values()];
}
