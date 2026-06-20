/**
 * @fileoverview Media MIME ↔ file-extension resolution — the canonical owner.
 *
 * Blossom addresses blobs by their sha256, so an upload response URL can arrive
 * with no file extension. Nostr clients inline-render media by the extension in
 * the note's URL, so a bare-hash URL renders as a plain link, not an image.
 *
 * This module resolves a consistent `{ mimeType, extension }` from a picked
 * asset — trusting the file's own name over a picker-supplied mime, which is
 * often wrong (e.g. a PNG screenshot reported as `image/jpeg`) — and guarantees
 * the final URL carries a renderable suffix.
 */

/** Known media extensions → canonical MIME type. */
const EXTENSION_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
} as const;

type KnownExtension = keyof typeof EXTENSION_TO_MIME;

/** Canonical MIME type → preferred extension (the reverse of the table above). */
const MIME_TO_EXTENSION: Record<string, KnownExtension> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

/** The known media extension at the end of a filename or URL path, if any. */
function extensionOf(nameOrUri: string | undefined): KnownExtension | undefined {
  if (!nameOrUri) return undefined;
  const path = nameOrUri.split(/[?#]/, 1)[0];
  const dot = path.lastIndexOf('.');
  if (dot === -1) return undefined;
  const ext = path.slice(dot + 1).toLowerCase();
  return ext in EXTENSION_TO_MIME ? (ext as KnownExtension) : undefined;
}

/** The preferred extension for a MIME type, if recognized. */
export function extensionForMime(mimeType: string | undefined): KnownExtension | undefined {
  if (!mimeType) return undefined;
  return MIME_TO_EXTENSION[mimeType.toLowerCase()];
}

interface PickedMediaHints {
  fileName?: string;
  uri?: string;
  mimeType?: string;
  /** Last-resort family when no name/uri/mime resolves a type. */
  kind?: 'image' | 'video';
}

interface ResolvedMediaType {
  mimeType: string;
  extension: KnownExtension;
}

/**
 * Resolve a consistent mime + extension from a picked asset, preferring the
 * most trustworthy source and deriving BOTH fields from it (so they never
 * disagree): file name → uri → supplied mime → kind fallback.
 */
export function resolveMediaType(hints: PickedMediaHints): ResolvedMediaType {
  const fromName = extensionOf(hints.fileName) ?? extensionOf(hints.uri);
  if (fromName) return { extension: fromName, mimeType: EXTENSION_TO_MIME[fromName] };

  const fromMime = extensionForMime(hints.mimeType);
  if (fromMime && hints.mimeType) return { extension: fromMime, mimeType: hints.mimeType };

  const extension: KnownExtension = hints.kind === 'video' ? 'mp4' : 'jpg';
  return { extension, mimeType: EXTENSION_TO_MIME[extension] };
}

/**
 * Append `.extension` to a URL that lacks a renderable media suffix. Idempotent:
 * a URL that already ends in a known media extension is returned untouched.
 * Blossom blob URLs are clean content-address paths, so a bare append is safe.
 */
export function ensureUrlExtension(url: string, extension: string): string {
  if (extensionOf(url)) return url;
  return `${url}.${extension}`;
}
