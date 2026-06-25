import type NDK from '@nostr-dev-kit/ndk-mobile';

import { nostrLog } from '@/shared/lib/logger';
import { useOwnedMediaStore } from '@/shared/stores/profile/ownedMediaStore';

import { checkBlobExists, deleteFromBlossom } from './blossomClient';

export interface DeleteOwnedBlobArgs {
  ndk: NDK;
  /** Blossom origin the blob lives on, e.g. 'https://blossom.primal.net'. */
  host: string;
  sha256: string;
  /** Public blob URL — HEAD-probed to disambiguate Primal's overloaded 404. */
  url: string;
  signal?: AbortSignal;
}

export interface DeleteOwnedBlobResult {
  deleted: boolean;
  /** Failure reason when `deleted` is false; undefined on success. */
  error?: string;
}

/**
 * Deletes a single owned blob from its Blossom host (BUD-11) and reconciles the
 * owned-media ledger: requested → deleted | delete-failed.
 *
 * The server's response is ambiguous in two ways, so a *failed* delete is
 * confirmed with a HEAD-probe of the URL before we trust it: a confirmed-absent
 * blob counts as deleted, anything else stays a real failure.
 *  - Primal answers 404 for both "already gone" and "not owned".
 *  - Primal's DELETE can run a slow server-side purge; our request may time out
 *    (no HTTP status) even though the deletion completes — the probe recovers it.
 * The probe therefore runs on ANY `delete-failed`, not just a 404.
 *
 * The single source of truth for "delete one blob and record the outcome",
 * shared by the post-delete flow (one leg per image) and the Settings → My
 * media ledger (one row per blob). Pure of React so both call sites just supply
 * `ndk`.
 */
export async function deleteOwnedBlob({
  ndk,
  host,
  sha256,
  url,
  signal,
}: DeleteOwnedBlobArgs): Promise<DeleteOwnedBlobResult> {
  const ownedMedia = useOwnedMediaStore.getState();
  ownedMedia.setDeleteState(host, sha256, 'delete-requested');

  const res = await deleteFromBlossom({ ndk, server: host, sha256, signal });

  let deleted = res.isOk();
  if (!deleted && res.isErr() && res.error.type === 'delete-failed') {
    // Trust "gone" over the failed response: a 404 may mean already-gone, and a
    // timed-out slow purge may have completed. Only a confirmed-absent blob
    // flips to deleted; still-present (or indeterminate) stays a real failure.
    if ((await checkBlobExists(url)) === false) deleted = true;
  }

  ownedMedia.setDeleteState(host, sha256, deleted ? 'deleted' : 'delete-failed');
  const error = deleted ? undefined : res.isErr() ? res.error.type : 'unknown';
  nostrLog.info('nostr.delete.blob', { host, sha256: sha256.slice(0, 12), ok: deleted, error });
  return { deleted, error };
}
