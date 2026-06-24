/**
 * @fileoverview Blossom upload client (BUD-02).
 *
 * Uploads a local file to a Blossom server: hashes the bytes (the content
 * address), signs a `kind:24242` authorization event with the active key,
 * and PUTs the file via `expo-file-system` with the `Authorization: Nostr …`
 * header. Returns the blob descriptor used to build the post's `imeta` tag.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { NDKEvent } from '@nostr-dev-kit/ndk-mobile';
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { ResultAsync, err, ok, type Result } from 'neverthrow';

import { nostrLog } from '@/shared/lib/logger';
import {
  buildBlossomAuthEvent,
  encodeAuthHeader,
  sha256Hex,
} from '@/shared/lib/nostr/media/blossomAuth';
import type { BlobDescriptor } from '@/shared/lib/nostr/media/types';

export type BlossomError =
  | { type: 'read-failed' }
  | { type: 'sign-failed' }
  | { type: 'upload-failed'; status?: number }
  | { type: 'bad-response' };

function base64ToBytes(base64: string): Uint8Array {
  const binary =
    typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseDescriptor(body: string): BlobDescriptor | null {
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    if (typeof raw.url !== 'string' || typeof raw.sha256 !== 'string') return null;
    return {
      url: raw.url,
      sha256: raw.sha256,
      size: typeof raw.size === 'number' ? raw.size : 0,
      type: typeof raw.type === 'string' ? raw.type : undefined,
      uploaded: typeof raw.uploaded === 'number' ? raw.uploaded : undefined,
    };
  } catch {
    return null;
  }
}

interface UploadOptions {
  ndk: NDK;
  server: string;
  fileUri: string;
  mimeType: string;
}

/** Uploads `fileUri` to `server` and returns the blob descriptor. */
export function uploadToBlossom(opts: UploadOptions): ResultAsync<BlobDescriptor, BlossomError> {
  return new ResultAsync(run(opts));
}

async function run(opts: UploadOptions): Promise<Result<BlobDescriptor, BlossomError>> {
  // 1. Hash the bytes (Blossom content address + imeta `x`).
  let sha256: string;
  try {
    const base64 = await FileSystem.readAsStringAsync(opts.fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    sha256 = sha256Hex(base64ToBytes(base64));
  } catch {
    nostrLog.warn('nostr.media.read_failed');
    return err({ type: 'read-failed' });
  }

  // 2. Sign the kind:24242 authorization event.
  let authHeader: string;
  try {
    const unsigned = buildBlossomAuthEvent({
      action: 'upload',
      sha256,
      createdAt: Math.floor(Date.now() / 1000),
    });
    const authEvent = new NDKEvent(opts.ndk);
    authEvent.kind = unsigned.kind;
    authEvent.content = unsigned.content;
    authEvent.created_at = unsigned.created_at;
    authEvent.tags = unsigned.tags;
    await authEvent.sign();
    authHeader = encodeAuthHeader(JSON.stringify(authEvent.rawEvent()));
  } catch {
    nostrLog.warn('nostr.media.auth_sign_failed');
    return err({ type: 'sign-failed' });
  }

  // 3. PUT the file.
  try {
    const response = await FileSystem.uploadAsync(`${opts.server}/upload`, opts.fileUri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { Authorization: authHeader, 'Content-Type': opts.mimeType },
    });
    if (response.status < 200 || response.status >= 300) {
      nostrLog.warn('nostr.media.upload_failed', { status: response.status });
      return err({ type: 'upload-failed', status: response.status });
    }
    const descriptor = parseDescriptor(response.body);
    if (!descriptor) return err({ type: 'bad-response' });
    nostrLog.info('nostr.media.uploaded', { size: descriptor.size });
    return ok(descriptor);
  } catch {
    nostrLog.warn('nostr.media.upload_failed', {});
    return err({ type: 'upload-failed' });
  }
}
