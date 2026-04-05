import { NetworkError, HttpResponseError } from '@cashu/coco-core';

/**
 * Returns true when the error indicates the mint could not be reached —
 * either a raw network failure, a server error (5xx), or a MintFetchError
 * (coco-core wraps network failures when refreshing mint info/keysets).
 */
export function isMintOfflineError(err: unknown): boolean {
  if (err instanceof NetworkError) return true;
  if (err instanceof HttpResponseError && err.status >= 500) return true;
  if (err instanceof Error && err.name === 'MintFetchError') return true;
  return false;
}
