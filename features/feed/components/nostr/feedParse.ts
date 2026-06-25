import { nip19 } from 'nostr-tools';
import type { ContentSegment, FeedEvent } from './feedTypes';

// SVG is intentionally absent: expo-image can't render remote SVGs, so an svg
// url renders as a tappable link rather than a blank image box.
export const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif)(\?.*)?$/i;
export const VIDEO_EXT = /\.(mp4|webm|mov|m4v|avi)(\?.*)?$/i;

/**
 * Maps a NIP-92 imeta `m` mime type to how the renderer should treat its url,
 * or `undefined` to leave classification to the url extension. Lets an
 * extensionless media url (common with content-addressed Blossom blobs from
 * other clients) still render as media. SVG is excluded — see `IMAGE_EXT`.
 */
export function mediaKindForMime(mime: string | undefined): 'image' | 'video' | undefined {
  if (!mime || mime === 'image/svg+xml') return undefined;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return undefined;
}

// Bounded quantifiers protect parseContent against adversarial relay content
// allocating arbitrarily large match strings: bolt11 invoices never exceed
// ~700 chars in practice, URLs cap at 2KB, hashtags at 32 chars.
const LIGHTNING_INVOICE_REGEX = /\b(lnbc[a-z0-9]{20,700})\b/gi;
const HASHTAG_REGEX = /#([a-zA-Z][a-zA-Z0-9_]{0,31})/g;
export const URL_REGEX = /https?:\/\/[^\s<>"')\]]{1,2048}/gi;
const NOSTR_URI_REGEX = /nostr:(npub1|nprofile1|nevent1|note1|naddr1)[a-z0-9]{1,512}/gi;
const HEX_EVENT_ID_REGEX = /^[0-9a-f]{64}$/i;

// Sanity ceiling on raw note content. This defensive client-side bound keeps
// parseContent and _contentCache from retaining hostile inputs beyond the cap.
const MAX_FEED_CONTENT_LEN = 32_768;

const _contentCache = new Map<string, ContentSegment[]>();
const _CONTENT_CACHE_MAX = 300;
const _npubCache = new Map<string, string>();

export function parseContent(raw: string): ContentSegment[] {
  if (raw.length > MAX_FEED_CONTENT_LEN) {
    return [{ kind: 'text', text: raw.slice(0, MAX_FEED_CONTENT_LEN) }];
  }
  const cached = _contentCache.get(raw);
  if (cached) return cached;
  const result = _parseContentInner(raw);
  if (_contentCache.size >= _CONTENT_CACHE_MAX) _contentCache.clear();
  _contentCache.set(raw, result);
  return result;
}

function _parseContentInner(raw: string): ContentSegment[] {
  type Span = { start: number; end: number; seg: ContentSegment };
  const spans: Span[] = [];

  for (const m of raw.matchAll(NOSTR_URI_REGEX)) {
    const bech32 = m[0].replace('nostr:', '');
    try {
      const decoded = nip19.decode(bech32);
      let seg: ContentSegment;
      switch (decoded.type) {
        case 'npub':
          seg = { kind: 'npub', pubkey: decoded.data as string, bech32 };
          break;
        case 'nprofile':
          seg = {
            kind: 'nprofile',
            pubkey: (decoded.data as nip19.ProfilePointer).pubkey,
            bech32,
          };
          break;
        case 'nevent':
          seg = { kind: 'nevent', eventId: (decoded.data as nip19.EventPointer).id };
          break;
        case 'note':
          seg = { kind: 'note', eventId: decoded.data as string };
          break;
        case 'naddr':
          seg = {
            kind: 'naddr',
            identifier: (decoded.data as nip19.AddressPointer).identifier,
          };
          break;
        default:
          continue;
      }
      spans.push({ start: m.index!, end: m.index! + m[0].length, seg });
    } catch {
      // skip undecodable
    }
  }

  for (const m of raw.matchAll(LIGHTNING_INVOICE_REGEX)) {
    spans.push({
      start: m.index!,
      end: m.index! + m[0].length,
      seg: { kind: 'lightning', meltTarget: m[0] },
    });
  }

  for (const m of raw.matchAll(URL_REGEX)) {
    const url = m[0];
    let seg: ContentSegment;
    if (IMAGE_EXT.test(url)) {
      seg = { kind: 'image', url };
    } else if (VIDEO_EXT.test(url)) {
      seg = { kind: 'video', url };
    } else {
      seg = { kind: 'url', url };
    }
    spans.push({ start: m.index!, end: m.index! + m[0].length, seg });
  }

  for (const m of raw.matchAll(HASHTAG_REGEX)) {
    spans.push({
      start: m.index!,
      end: m.index! + m[0].length,
      seg: { kind: 'hashtag', tag: m[1] },
    });
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const cleaned: Span[] = [];
  let cursor = 0;
  for (const sp of spans) {
    if (sp.start >= cursor) {
      cleaned.push(sp);
      cursor = sp.end;
    }
  }

  const segments: ContentSegment[] = [];
  let pos = 0;

  for (const sp of cleaned) {
    if (sp.start > pos) pushTextWithNewlines(segments, raw.slice(pos, sp.start));
    segments.push(sp.seg);
    pos = sp.end;
  }
  if (pos < raw.length) pushTextWithNewlines(segments, raw.slice(pos));

  while (segments.length > 0 && segments[0].kind === 'newline') segments.shift();
  while (segments.length > 0 && segments[segments.length - 1].kind === 'newline') segments.pop();

  return segments;
}

function pushTextWithNewlines(out: ContentSegment[], text: string) {
  const lines = text.split('\n');
  let lastWasNewline = out.length > 0 && out[out.length - 1].kind === 'newline';

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 0) {
      out.push({ kind: 'text', text: lines[i] });
      lastWasNewline = false;
    }
    if (i < lines.length - 1 && !lastWasNewline) {
      out.push({ kind: 'newline' });
      lastWasNewline = true;
    }
  }
}

export function collectReferencedIds(notes: FeedEvent[]): {
  eventIds: string[];
  pubkeys: string[];
} {
  const eventIdSet = new Set<string>();
  const pubkeySet = new Set<string>();

  for (const note of notes) {
    for (const seg of parseContent(note.content)) {
      if (seg.kind === 'nevent' || seg.kind === 'note') eventIdSet.add(seg.eventId);
      else if (seg.kind === 'npub' || seg.kind === 'nprofile') pubkeySet.add(seg.pubkey);
    }
    for (const id of collectQuoteTagIds(note)) eventIdSet.add(id);
  }

  return { eventIds: Array.from(eventIdSet), pubkeys: Array.from(pubkeySet) };
}

export function collectQuoteTagIds(event: FeedEvent): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of event.tags || []) {
    if (tag[0] !== 'q' || !tag[1]) continue;
    const id = tag[1].trim().toLowerCase();
    if (!HEX_EVENT_ID_REGEX.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function tryNpubEncode(hex: string): string {
  const cached = _npubCache.get(hex);
  if (cached) return cached;
  try {
    const encoded = nip19.npubEncode(hex);
    if (_npubCache.size > 600) _npubCache.clear();
    _npubCache.set(hex, encoded);
    return encoded;
  } catch {
    return '';
  }
}

/** NIP-92 imeta metadata for a media url. */
export interface ImetaInfo {
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

/** Encodes a NIP-19 `nevent` for an event (for quotes / share links). '' on error. */
export function tryNeventEncode(
  id: string,
  author?: string,
  kind?: number,
  relays?: readonly string[]
): string {
  try {
    return nip19.neventEncode({ id, author, kind, relays: relays ? [...relays] : undefined });
  } catch {
    return '';
  }
}

export function prettifyUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname === '/' ? '' : u.pathname;
    const display = host + path;
    return display.length > 40 ? display.slice(0, 37) + '…' : display;
  } catch {
    return raw.length > 40 ? raw.slice(0, 37) + '…' : raw;
  }
}

export function normalizeFeedEvent(value: unknown): FeedEvent | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.id !== 'string' ||
    typeof input.kind !== 'number' ||
    typeof input.pubkey !== 'string' ||
    typeof input.content !== 'string' ||
    typeof input.created_at !== 'number' ||
    !Array.isArray(input.tags)
  ) {
    return null;
  }

  const content =
    input.content.length > MAX_FEED_CONTENT_LEN
      ? input.content.slice(0, MAX_FEED_CONTENT_LEN) + '…'
      : input.content;

  return {
    id: input.id,
    kind: input.kind,
    pubkey: input.pubkey,
    content,
    created_at: input.created_at,
    tags: input.tags.filter(Array.isArray) as string[][],
  };
}

export function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getFirstTagValue(event: FeedEvent, tagName: string): string | undefined {
  const tag = event.tags.find((t) => t[0] === tagName);
  return tag?.[1];
}
