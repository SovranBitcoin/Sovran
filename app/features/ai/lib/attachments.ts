/**
 * Image attach for the AI chat composer: pick + encode.
 *
 * Pick mirrors the Nostr `PostComposer` UX exactly (library-only picker,
 * `exif: false`, defer all processing to send time — a mis-pick costs no
 * work and the user can remove it before anything is encoded).
 *
 * Encode is deliberately NOT `normalizeImageAsset`: the Nostr path's
 * contract is a full-resolution *file* for Blossom upload, while chat
 * needs a *downscaled inline base64 data-URL* — Routstr's OpenAI-compatible
 * `chat/completions` decodes `image_url` data-URLs server-side and there
 * is no upload endpoint. It reuses the identical `expo-image-manipulator`
 * re-encode pipeline though, so EXIF/GPS stripping happens the same proven
 * way (PR #242 pattern): a full re-encode drops all metadata.
 */
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { aiLog } from '@/shared/lib/logger';
import type { ChatAttachment } from '@/shared/stores/profile/routstrStore';

/** Longest-edge cap for inline chat images. Vision endpoints tile images
 *  (~512px tiles) and gain nothing from more pixels than this, while the
 *  base64 payload grows quadratically — 1536px keeps a photo around
 *  200–400KB encoded. */
const MAX_LONGEST_EDGE = 1536;

/** JPEG quality for the inline re-encode. Slightly below the Nostr path's
 *  0.9 — model input tolerates compression artifacts better than humans
 *  viewing a full-screen photo, and the payload travels on every turn in
 *  the inline window. */
const JPEG_COMPRESS = 0.85;

/**
 * Session memo of encoded data-URLs keyed by local URI, so historical
 * image turns are read + re-encoded ONCE, not on every subsequent
 * send/retry that reassembles the conversation. LRU-capped: ~8 entries ×
 * ~400KB is a bounded few MB; oldest evicts first. In-memory only — the
 * base64 never touches persistence.
 */
const ENCODE_CACHE_MAX = 8;
const encodeCache = new Map<string, string>();

function cacheGet(key: string): string | undefined {
  const hit = encodeCache.get(key);
  if (hit !== undefined) {
    // Refresh recency (Map iteration order is insertion order).
    encodeCache.delete(key);
    encodeCache.set(key, hit);
  }
  return hit;
}

function cachePut(key: string, value: string): void {
  encodeCache.delete(key);
  encodeCache.set(key, value);
  if (encodeCache.size > ENCODE_CACHE_MAX) {
    const oldest = encodeCache.keys().next().value;
    if (oldest !== undefined) encodeCache.delete(oldest);
  }
}

/**
 * Open the system photo library and return the picked image's bounded
 * metadata, or `null` when the user cancels. Same picker call as
 * `PostComposer.handleAddMedia`.
 */
export async function pickChatImage(): Promise<ChatAttachment | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  aiLog.info('ai.attach.picked', {
    mimeType: asset.mimeType ?? 'image/jpeg',
    width: asset.width,
    height: asset.height,
  });
  return {
    localUri: asset.uri,
    mimeType: asset.mimeType ?? 'image/jpeg',
    width: asset.width,
    height: asset.height,
  };
}

/**
 * Re-encode an attachment into an inline `data:image/jpeg;base64,…` URL:
 * EXIF/GPS-stripped (full re-encode), downscaled to ≤1536px longest edge,
 * memoized per session. Returns `null` when the local URI is missing or
 * unreadable (photo deleted, iOS container path rotated across a
 * reinstall) — callers degrade that turn to text-only rather than failing
 * the send.
 */
export async function encodeChatImage(attachment: ChatAttachment): Promise<string | null> {
  const cached = cacheGet(attachment.localUri);
  if (cached !== undefined) return cached;
  const start = performance.now();
  try {
    const context = ImageManipulator.manipulate(attachment.localUri);
    const longest = Math.max(attachment.width || 0, attachment.height || 0);
    if (longest > MAX_LONGEST_EDGE) {
      // Single-dimension resize preserves aspect ratio.
      const resize =
        (attachment.width || 0) >= (attachment.height || 0)
          ? { width: MAX_LONGEST_EDGE }
          : { height: MAX_LONGEST_EDGE };
      context.resize(resize);
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: JPEG_COMPRESS,
      base64: true,
    });
    if (!saved.base64) {
      aiLog.warn('ai.attach.encode_missing', { reason: 'no_base64' });
      return null;
    }
    const dataUrl = `data:image/jpeg;base64,${saved.base64}`;
    cachePut(attachment.localUri, dataUrl);
    aiLog.info('ai.attach.encoded', {
      fromW: attachment.width,
      fromH: attachment.height,
      toW: saved.width,
      toH: saved.height,
      encodedChars: dataUrl.length,
      duration_ms: Math.round((performance.now() - start) * 100) / 100,
    });
    return dataUrl;
  } catch (err) {
    // Expired/deleted URI is an expected lifecycle event, not a send error.
    aiLog.warn('ai.attach.encode_missing', {
      reason: 'read_failed',
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
