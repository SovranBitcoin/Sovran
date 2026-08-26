/**
 * @fileoverview Profile-switch pairing intent
 *
 * Raw AsyncStorage on purpose — NOT profileStorage: the intent is written by
 * the profile the user is leaving and read by the target profile after the
 * restart-based switch, so it must live outside every per-pubkey namespace.
 *
 * The stored URI embeds the nostrconnect pairing secret, hence the hygiene:
 * 10-min TTL, single-take semantics (cleared before the intent is handed
 * out), cleared on expiry/mismatch/corruption, and never logged.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { z } from 'zod';

import { safeJsonParse } from '@/features/nostrSigner/lib/json';
import { MAX_NOSTRCONNECT_URI_LENGTH } from '@/features/nostrSigner/lib/nip46Uri';
import { PAIRING_INTENT_TTL_MS } from '@/features/nostrSigner/lib/nip46Types';
import { nostrLog, redactError, type RedactedError } from '@/shared/lib/logger';
import { isNostrPubkeyHex, NostrPubkeyHexSchema } from '@/shared/lib/protocolIds';

export const PAIRING_INTENT_STORAGE_KEY = 'nip46-pending-pairing';

// Canonical pubkey schema lives in protocolIds (branded output).

const PairingIntentSchema = z.strictObject({
  /** @SECRET full nostrconnect:// URI — carries the pairing secret; never log */
  uri: z.string().min(1).max(MAX_NOSTRCONNECT_URI_LENGTH),
  targetPubkey: NostrPubkeyHexSchema,
  targetAccountIndex: z.int().min(0),
  createdAt: z.int().min(0),
  expiresAt: z.int().min(0),
});
type PairingIntent = z.infer<typeof PairingIntentSchema>;

export type PairingIntentError =
  | { type: 'invalid-pubkey' }
  | { type: 'invalid-intent' }
  | { type: 'storage-read-failed'; cause: RedactedError }
  | { type: 'storage-write-failed'; cause: RedactedError };

export type TakePairingIntentOutcome =
  | { status: 'taken'; intent: PairingIntent }
  | { status: 'none' }
  | { status: 'expired' }
  | { status: 'mismatch' };

export interface PairingIntentInput {
  uri: string;
  targetPubkey: string;
  targetAccountIndex: number;
}

// ── Serialised RMW queue (same pattern as bunkerSecrets) ────────
// take = read → validate → clear; without serialisation two concurrent
// callers (e.g. a double-fired boot effect) could both read the same
// secret-bearing intent before either clear lands — single-take must hold
// within a session as well as across crash-and-reboot.

let rmwQueue: Promise<unknown> = Promise.resolve();

function queued<T>(
  task: () => ResultAsync<T, PairingIntentError>
): ResultAsync<T, PairingIntentError> {
  const run = rmwQueue.then(() => task());
  rmwQueue = run.then(
    () => undefined,
    () => undefined
  );
  return new ResultAsync(run);
}

const getItem = (): ResultAsync<string | null, PairingIntentError> =>
  ResultAsync.fromPromise(AsyncStorage.getItem(PAIRING_INTENT_STORAGE_KEY), (error) => {
    const cause = redactError(error);
    nostrLog.error('nostr.signer.pairing_intent_read_failed', { error: cause });
    return { type: 'storage-read-failed', cause } as const;
  });

const setItem = (value: string): ResultAsync<void, PairingIntentError> =>
  ResultAsync.fromPromise(AsyncStorage.setItem(PAIRING_INTENT_STORAGE_KEY, value), (error) => {
    const cause = redactError(error);
    nostrLog.error('nostr.signer.pairing_intent_write_failed', { error: cause });
    return { type: 'storage-write-failed', cause } as const;
  });

const removeItem = (): ResultAsync<void, PairingIntentError> =>
  ResultAsync.fromPromise(AsyncStorage.removeItem(PAIRING_INTENT_STORAGE_KEY), (error) => {
    const cause = redactError(error);
    nostrLog.error('nostr.signer.pairing_intent_clear_failed', { error: cause });
    return { type: 'storage-write-failed', cause } as const;
  });

/** Persists a pending pairing intent before the restart-based profile switch. */
export function setPairingIntent(
  input: PairingIntentInput,
  nowMs: number = Date.now()
): ResultAsync<void, PairingIntentError> {
  const parsed = PairingIntentSchema.safeParse({
    ...input,
    createdAt: nowMs,
    expiresAt: nowMs + PAIRING_INTENT_TTL_MS,
  });
  if (!parsed.success) {
    // Paths only — the uri embeds a secret and must never reach the log.
    nostrLog.error('nostr.signer.pairing_intent_invalid', {
      issues: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
    return errAsync({ type: 'invalid-intent' });
  }
  return queued(() => setItem(JSON.stringify(parsed.data)));
}

/**
 * Returns-and-clears the pending intent for the booting profile. The intent
 * is handed out only when `targetPubkey` matches `activePubkey` AND it is
 * unexpired; any other state clears storage and reports why:
 * - 'none'      — nothing stored (or corrupt blob, which is wiped)
 * - 'expired'   — TTL elapsed (checked before mismatch: a dead intent is dead
 *                 regardless of which profile boots)
 * - 'mismatch'  — a different profile booted; the secret-bearing URI must not
 *                 survive into the wrong profile's session
 * The clear write completes before 'taken' resolves, so the intent is
 * single-take even across a crash-and-reboot.
 */
export function takePairingIntent(
  activePubkey: string,
  nowMs: number = Date.now()
): ResultAsync<TakePairingIntentOutcome, PairingIntentError> {
  if (!isNostrPubkeyHex(activePubkey)) return errAsync({ type: 'invalid-pubkey' });
  return queued(() =>
    getItem().andThen((raw): ResultAsync<TakePairingIntentOutcome, PairingIntentError> => {
      if (raw === null) return okAsync({ status: 'none' });
      const parsed = safeJsonParse(raw).map((value) => PairingIntentSchema.safeParse(value));
      if (parsed.isErr() || !parsed.value.success) {
        nostrLog.warn('nostr.signer.pairing_intent_corrupt');
        return removeItem().map(() => ({ status: 'none' }) as const);
      }
      const intent = parsed.value.data;
      if (nowMs >= intent.expiresAt) {
        return removeItem().map(() => ({ status: 'expired' }) as const);
      }
      if (intent.targetPubkey.toLowerCase() !== activePubkey.toLowerCase()) {
        return removeItem().map(() => ({ status: 'mismatch' }) as const);
      }
      return removeItem().map(() => ({ status: 'taken', intent }) as const);
    })
  );
}

export function clearPairingIntent(): ResultAsync<void, PairingIntentError> {
  return queued(() => removeItem());
}
