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
  | { type: 'bad-response' }
  | { type: 'too-large'; size: number }
  | { type: 'canceled' };

export type BlossomDeleteError =
  | { type: 'sign-failed' }
  | { type: 'delete-failed'; status?: number }
  | { type: 'canceled' };

/** A DELETE that hangs would stall the whole multi-image delete flow. */
const DELETE_TIMEOUT_MS = 15_000;

/** Hard ceiling on upload size; photos are re-encoded well under this. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Per-attempt upload timeout. */
const UPLOAD_TIMEOUT_MS = 60_000;
/** Total attempts (1 initial + retries) for transient network failures. */
const MAX_ATTEMPTS = 3;

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

export interface UploadOptions {
  ndk: NDK;
  server: string;
  fileUri: string;
  mimeType: string;
  /** Receives upload progress as a 0–1 fraction. */
  onProgress?: (fraction: number) => void;
  /** Aborts the upload (e.g. when the user removes the media block). */
  signal?: AbortSignal;
}

/** Uploads `fileUri` to `server` and returns the blob descriptor. */
export function uploadToBlossom(opts: UploadOptions): ResultAsync<BlobDescriptor, BlossomError> {
  return new ResultAsync(run(opts));
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function run(opts: UploadOptions): Promise<Result<BlobDescriptor, BlossomError>> {
  if (opts.signal?.aborted) return err({ type: 'canceled' });

  // 1. Reject oversized files before reading them into memory.
  try {
    const info = await FileSystem.getInfoAsync(opts.fileUri);
    if (info.exists && info.size > MAX_UPLOAD_BYTES) {
      nostrLog.warn('nostr.media.too_large', { size: info.size });
      return err({ type: 'too-large', size: info.size });
    }
  } catch {
    nostrLog.warn('nostr.media.read_failed');
    return err({ type: 'read-failed' });
  }

  // 2. Hash the bytes (Blossom content address + imeta `x`).
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
  if (opts.signal?.aborted) return err({ type: 'canceled' });

  // 3. Sign the kind:24242 authorization event.
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

  // 4. PUT the file, retrying transient failures with backoff.
  let last: Result<BlobDescriptor, BlossomError> = err({ type: 'upload-failed' });
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (opts.signal?.aborted) return err({ type: 'canceled' });
    last = await putOnce(opts, authHeader);
    if (last.isOk()) return last;

    const e = last.error;
    // Don't retry cancellation, oversize, or client (4xx) responses.
    if (e.type === 'canceled' || e.type === 'too-large') return last;
    if (e.type === 'upload-failed' && e.status && e.status >= 400 && e.status < 500) return last;
    if (attempt < MAX_ATTEMPTS) await delay(500 * 2 ** (attempt - 1));
  }
  return last;
}

/** One PUT attempt: progress callbacks, timeout, and abort all wired to the task. */
async function putOnce(
  opts: UploadOptions,
  authHeader: string
): Promise<Result<BlobDescriptor, BlossomError>> {
  const task = FileSystem.createUploadTask(
    `${opts.server}/upload`,
    opts.fileUri,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { Authorization: authHeader, 'Content-Type': opts.mimeType },
    },
    (data) => {
      if (opts.onProgress && data.totalBytesExpectedToSend > 0) {
        opts.onProgress(data.totalBytesSent / data.totalBytesExpectedToSend);
      }
    }
  );

  const onAbort = (): void => void task.cancelAsync();
  opts.signal?.addEventListener('abort', onAbort);
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const response = await Promise.race([
      task.uploadAsync(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          void task.cancelAsync();
          resolve(undefined);
        }, UPLOAD_TIMEOUT_MS);
      }),
    ]);

    // cancelAsync resolves uploadAsync to null/undefined (abort or timeout).
    if (!response)
      return err(opts.signal?.aborted ? { type: 'canceled' } : { type: 'upload-failed' });
    if (response.status < 200 || response.status >= 300) {
      nostrLog.warn('nostr.media.upload_failed', { status: response.status });
      return err({ type: 'upload-failed', status: response.status });
    }
    const descriptor = parseDescriptor(response.body);
    if (!descriptor) return err({ type: 'bad-response' });
    nostrLog.info('nostr.media.uploaded', { size: descriptor.size });
    return ok(descriptor);
  } catch {
    if (opts.signal?.aborted) return err({ type: 'canceled' });
    nostrLog.warn('nostr.media.upload_failed', {});
    return err({ type: 'upload-failed' });
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

export interface DeleteOptions {
  ndk: NDK;
  /**
   * Origin the blob lives on (scheme + host of the blob URL), e.g.
   * `https://blossom.primal.net`. A blob can only be deleted from the server it
   * was uploaded to, so this is derived from the URL host — NOT from the
   * currently-configured media server (which may since have changed).
   */
  server: string;
  /** Blob content address; `DELETE /<sha256>` per BUD-11. */
  sha256: string;
  signal?: AbortSignal;
}

/**
 * Deletes a blob from its Blossom server (BUD-11): signs a fresh `kind:24242`
 * authorization event with `["t","delete"]` + `["x",<sha256>]` and sends
 * `DELETE /<sha256>` with `Authorization: Nostr …` and `X-SHA-256`.
 *
 * The auth event is signed per call (not reused) so its short expiration can't
 * lapse partway through a slow multi-image delete. The server only honours the
 * delete when the signer owns the blob; a 401/403/404 is therefore expected and
 * left non-fatal for the caller to fold into its progress UI.
 */
export function deleteFromBlossom(opts: DeleteOptions): ResultAsync<void, BlossomDeleteError> {
  return new ResultAsync(runDelete(opts));
}

async function runDelete(opts: DeleteOptions): Promise<Result<void, BlossomDeleteError>> {
  if (opts.signal?.aborted) return err({ type: 'canceled' });

  // Fresh delete auth (5-min expiry) signed for THIS blob.
  let authHeader: string;
  try {
    const unsigned = buildBlossomAuthEvent({
      action: 'delete',
      sha256: opts.sha256,
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
    nostrLog.warn('nostr.media.delete_auth_sign_failed');
    return err({ type: 'sign-failed' });
  }

  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
  try {
    // eslint-disable-next-line no-restricted-globals -- Blossom DELETE returns a bare status (BUD-11), not a JSON envelope; needs raw fetch + AbortSignal.
    const response = await fetch(`${opts.server}/${opts.sha256}`, {
      method: 'DELETE',
      headers: { Authorization: authHeader, 'X-SHA-256': opts.sha256 },
      signal: controller.signal,
    });
    if (response.status >= 200 && response.status < 300) {
      nostrLog.info('nostr.media.deleted', {
        server: opts.server,
        sha256: opts.sha256.slice(0, 12),
        status: response.status,
      });
      return ok(undefined);
    }
    nostrLog.warn('nostr.media.delete_failed', {
      server: opts.server,
      sha256: opts.sha256.slice(0, 12),
      status: response.status,
    });
    return err({ type: 'delete-failed', status: response.status });
  } catch {
    if (opts.signal?.aborted) return err({ type: 'canceled' });
    nostrLog.warn('nostr.media.delete_failed', {
      server: opts.server,
      sha256: opts.sha256.slice(0, 12),
    });
    return err({ type: 'delete-failed' });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
