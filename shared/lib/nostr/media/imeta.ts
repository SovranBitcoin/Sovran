/**
 * @fileoverview NIP-92 `imeta` tag construction (pure).
 *
 * Mirrors the imeta shape shipped by Damus/Amethyst:
 * `["imeta", "url <url>", "m <mime>", "dim <w>x<h>", "x <sha256>", "blurhash …",
 *   "alt <text>"]`. Media urls also go inline into kind:1 `content`; the imeta
 * tag carries the structured metadata (dimensions for stable layout, alt for
 * accessibility, sha256 for verification).
 */
import type { MediaDescriptor } from '@/shared/lib/nostr/media/types';

/** Builds the `imeta` tag for one media descriptor. */
export function buildImetaTag(media: MediaDescriptor): string[] {
  const parts: string[] = [`url ${media.url}`];
  if (media.mimeType) parts.push(`m ${media.mimeType}`);
  if (media.width && media.height) parts.push(`dim ${media.width}x${media.height}`);
  if (media.sha256) parts.push(`x ${media.sha256}`);
  if (media.blurhash) parts.push(`blurhash ${media.blurhash}`);
  if (media.alt) parts.push(`alt ${media.alt}`);
  return ['imeta', ...parts];
}

/** Builds one imeta tag per media descriptor (the post's full set). */
export function buildImetaTags(media: readonly MediaDescriptor[]): string[][] {
  return media.map(buildImetaTag);
}
