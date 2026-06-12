/**
 * @fileoverview Shared JSON helper for the NIP-46 feature
 *
 * One `JSON.parse` wrapper for every signer module — the engine, policy,
 * method handlers, and storage layers all decode untrusted blobs the same way,
 * returning an error sentinel instead of throwing.
 */

import { Result } from 'neverthrow';

/** `JSON.parse` as a Result — `err('invalid_json')` instead of a throw. */
export const safeJsonParse = Result.fromThrowable(
  (raw: string) => JSON.parse(raw) as unknown,
  () => 'invalid_json' as const
);
