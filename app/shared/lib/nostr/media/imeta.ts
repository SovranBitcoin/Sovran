/**
 * @fileoverview NIP-92 `imeta` tag construction and parsing (pure).
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

/** NIP-92 imeta metadata for a media url. */
interface ImetaInfo {
  url: string;
  mimeType?: string;
  alt?: string;
  width?: number;
  height?: number;
  blurhash?: string;
  /** Blossom content address (`x` field) — the authoritative blob hash to delete. */
  sha256?: string;
}

/**
 * Parses NIP-92 `imeta` tags into a `url → metadata` map, so the renderer can
 * use real dimensions (no layout shift), surface alt text to accessibility, and
 * show blurhash placeholders. Each imeta tag is space-delimited
 * `["imeta", "url …", "m …", "dim WxH", "alt …", "blurhash …"]`.
 */
export function parseImetaTags(tags: readonly string[][]): Map<string, ImetaInfo> {
  const map = new Map<string, ImetaInfo>();
  for (const tag of tags) {
    if (tag[0] !== 'imeta') continue;
    const info: ImetaInfo = { url: '' };
    for (let i = 1; i < tag.length; i += 1) {
      const field = tag[i];
      if (typeof field !== 'string') continue;
      const sp = field.indexOf(' ');
      if (sp < 0) continue;
      const key = field.slice(0, sp);
      const value = field.slice(sp + 1);
      if (key === 'url') info.url = value;
      else if (key === 'm') info.mimeType = value;
      else if (key === 'x') info.sha256 = value;
      else if (key === 'alt') info.alt = value;
      else if (key === 'blurhash') info.blurhash = value;
      else if (key === 'dim') {
        const [w, h] = value.split('x').map((n) => Number(n));
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
          info.width = w;
          info.height = h;
        }
      }
    }
    if (info.url) map.set(info.url, info);
  }
  return map;
}
