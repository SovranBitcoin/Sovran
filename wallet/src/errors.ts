import { NetworkError, HttpResponseError } from '@cashu/coco-core';

import { logger } from './logger';

function summarizeError(err: unknown): Record<string, unknown> {
  if (err instanceof HttpResponseError) {
    return {
      errorKind: 'http-response',
      status: err.status,
      name: err.name,
      messageLength: err.message.length,
    };
  }
  if (err instanceof Error) {
    return {
      errorKind: err instanceof NetworkError ? 'network' : 'error',
      name: err.name,
      messageLength: err.message.length,
    };
  }
  return {
    errorKind: err == null ? 'nullish' : typeof err,
  };
}

/**
 * Returns true when the error indicates the mint could not be reached —
 * either a raw network failure, a server error (5xx), or a MintFetchError
 * (coco-core wraps network failures when refreshing mint info/keysets).
 */
export function isMintOfflineError(err: unknown): boolean {
  const result =
    err instanceof NetworkError ||
    (err instanceof HttpResponseError && err.status >= 500) ||
    (err instanceof Error && err.name === 'MintFetchError');
  logger.debug('errors.mintOffline.classify', {
    ...summarizeError(err),
    result,
  });
  return result;
}
