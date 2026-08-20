/**
 * @fileoverview Bunker pairing secrets
 *
 * One-time bearer secrets embedded in generated bunker:// URIs. They live in
 * SecureStore (bearer credentials — never AsyncStorage/zustand/logs), scoped
 * per active pubkey, capped at 8 outstanding with a 10-min TTL and pruned on
 * every read.
 *
 * Consume-then-ack ordering: consumeSecret deletes the secret and waits for
 * the SecureStore write to complete BEFORE resolving ok(true). The engine
 * must only send the connect "ack" on ok(true), so a crash or write failure
 * between consume and ack costs the user one re-scan; acking before the
 * write lands would leave a replayable secret behind a successful pairing.
 *
 * All mutations and reads are funneled through a serialised RMW queue:
 * concurrent consumeSecret calls would otherwise read the same baseline and
 * both observe the secret as present — single-use would silently become
 * multi-use. (Reads prune expired entries, so they write too.) Mirrors the
 * keyIndexQueue pattern in shared/lib/nostr/secureStorage.ts.
 */

import { bytesToHex } from '@noble/hashes/utils.js';
import * as SecureStore from 'expo-secure-store';
import { errAsync, okAsync, Result, ResultAsync } from 'neverthrow';
import { Platform } from 'react-native';
import { z } from 'zod';

import { safeJsonParse } from '@/features/nostrSigner/lib/json';
import { BUNKER_SECRET_TTL_MS } from '@/features/nostrSigner/lib/nip46Types';
import { nostrLog, redactError, type RedactedError } from '@/shared/lib/logger';
import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';

const STORAGE_KEY_PREFIX = 'nip46_bunker_secrets_';
const MAX_OUTSTANDING_SECRETS = 8;
// 16 CSPRNG bytes → 32 hex chars; ample for a single-use 10-min bearer token.
const SECRET_BYTES = 16;
const SECRET_HEX_RE = /^[0-9a-f]{32}$/;

const BunkerSecretEntrySchema = z.strictObject({
  /** @SECRET one-time pairing bearer credential — never log or surface in errors */
  secret: z.string().regex(SECRET_HEX_RE),
  createdAt: z.int().min(0),
  expiresAt: z.int().min(0),
});
type BunkerSecretEntry = z.infer<typeof BunkerSecretEntrySchema>;

const BunkerSecretsBlobSchema = z.array(BunkerSecretEntrySchema);

export type BunkerSecretsError =
  | { type: 'invalid-pubkey' }
  | { type: 'csprng-failed'; cause: RedactedError }
  | { type: 'storage-read-failed'; cause: RedactedError }
  | { type: 'storage-write-failed'; cause: RedactedError };

const INVALID_PUBKEY: BunkerSecretsError = { type: 'invalid-pubkey' };

// Mirrors shared/lib/nostr/secureStorage: requireAuthentication:false keeps
// reads silent (no FaceID prompt cascade) and stores entries under the same
// keychain service alias as every other Sovran secret.
const IOS_SECURE_OPTIONS = {
  requireAuthentication: false,
} as const;

const secureOptions = (): SecureStore.SecureStoreOptions =>
  Platform.OS === 'ios' ? IOS_SECURE_OPTIONS : {};

function storageKey(activePubkey: string): string {
  return `${STORAGE_KEY_PREFIX}${activePubkey}`;
}

// ── Serialised RMW queue ────────────────────────────────────────

let rmwQueue: Promise<unknown> = Promise.resolve();

function queued<T>(
  task: () => ResultAsync<T, BunkerSecretsError>
): ResultAsync<T, BunkerSecretsError> {
  const run = rmwQueue.then(() => task());
  rmwQueue = run.then(
    () => undefined,
    () => undefined
  );
  return new ResultAsync(run);
}

// ── SecureStore primitives ──────────────────────────────────────

const getItem = (key: string): ResultAsync<string | null, BunkerSecretsError> =>
  ResultAsync.fromPromise(SecureStore.getItemAsync(key, secureOptions()), (error) => {
    const cause = redactError(error);
    nostrLog.error('nostr.signer.secrets_read_failed', { error: cause });
    return { type: 'storage-read-failed', cause } as const;
  });

const setItem = (key: string, value: string): ResultAsync<void, BunkerSecretsError> =>
  ResultAsync.fromPromise(SecureStore.setItemAsync(key, value, secureOptions()), (error) => {
    const cause = redactError(error);
    nostrLog.error('nostr.signer.secrets_write_failed', { error: cause });
    return { type: 'storage-write-failed', cause } as const;
  });

const deleteItem = (key: string): ResultAsync<void, BunkerSecretsError> =>
  ResultAsync.fromPromise(SecureStore.deleteItemAsync(key, secureOptions()), (error) => {
    const cause = redactError(error);
    nostrLog.error('nostr.signer.secrets_delete_failed', { error: cause });
    return { type: 'storage-write-failed', cause } as const;
  });

const generateSecret = Result.fromThrowable(
  () => {
    const bytes = new Uint8Array(SECRET_BYTES);
    // CSPRNG via the react-native-quick-crypto bootstrap loaded in index.js.
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  },
  (error): BunkerSecretsError => {
    const cause = redactError(error);
    nostrLog.error('nostr.signer.secret_mint_failed', { error: cause });
    return { type: 'csprng-failed', cause };
  }
);

interface LoadedEntries {
  entries: BunkerSecretEntry[];
  /** True when the persisted blob differs from `entries` (pruned or corrupt). */
  dirty: boolean;
}

function loadEntries(key: string, nowMs: number): ResultAsync<LoadedEntries, BunkerSecretsError> {
  return getItem(key).map((raw) => {
    if (raw === null) return { entries: [], dirty: false };
    const parsed = safeJsonParse(raw).map((value) => BunkerSecretsBlobSchema.safeParse(value));
    if (parsed.isErr() || !parsed.value.success) {
      // Corrupt blob — self-heal to empty. Secrets are regenerable (the
      // share screen mints a fresh one on open), so deletion is safe.
      nostrLog.warn('nostr.signer.secrets_blob_corrupt');
      return { entries: [], dirty: true };
    }
    const entries = parsed.value.data;
    const live = entries.filter((entry) => entry.expiresAt > nowMs);
    return { entries: live, dirty: live.length !== entries.length };
  });
}

function persistEntries(
  key: string,
  entries: BunkerSecretEntry[]
): ResultAsync<void, BunkerSecretsError> {
  if (entries.length === 0) return deleteItem(key);
  return setItem(key, JSON.stringify(entries));
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Mints a fresh one-time secret for the active profile's bunker:// URI.
 * Minting at the cap evicts the oldest outstanding secret — the share screen
 * regenerates on every open, so the newest secret is always the live one.
 */
export function mintSecret(
  activePubkey: string,
  nowMs: number = Date.now()
): ResultAsync<string, BunkerSecretsError> {
  if (!isNostrPubkeyHex(activePubkey)) return errAsync(INVALID_PUBKEY);
  const key = storageKey(activePubkey);
  return queued(() =>
    loadEntries(key, nowMs).andThen(({ entries }) =>
      generateSecret().asyncAndThen((secret) => {
        const next = [
          ...entries,
          { secret, createdAt: nowMs, expiresAt: nowMs + BUNKER_SECRET_TTL_MS },
        ].slice(-MAX_OUTSTANDING_SECRETS);
        return persistEntries(key, next).map(() => secret);
      })
    )
  );
}

/**
 * Atomically consumes `secret` if it is outstanding and unexpired. Resolves
 * ok(true) only AFTER the deletion write has landed (consume-then-ack — see
 * file header); ok(false) for unknown/expired/already-consumed secrets. A
 * write failure surfaces as err so the caller never acks a live secret.
 */
export function consumeSecret(
  activePubkey: string,
  secret: string,
  nowMs: number = Date.now()
): ResultAsync<boolean, BunkerSecretsError> {
  if (!isNostrPubkeyHex(activePubkey)) return errAsync(INVALID_PUBKEY);
  const key = storageKey(activePubkey);
  return queued(() =>
    loadEntries(key, nowMs).andThen(({ entries, dirty }) => {
      const index = entries.findIndex((entry) => entry.secret === secret);
      if (index === -1) {
        // Persist pruning even on a miss so expired entries don't linger.
        return dirty ? persistEntries(key, entries).map(() => false) : okAsync(false);
      }
      const next = entries.filter((_, i) => i !== index);
      return persistEntries(key, next).map(() => true);
    })
  );
}

export function clearSecrets(activePubkey: string): ResultAsync<void, BunkerSecretsError> {
  if (!isNostrPubkeyHex(activePubkey)) return errAsync(INVALID_PUBKEY);
  return queued(() => deleteItem(storageKey(activePubkey)));
}

/** Unexpired outstanding secrets, oldest first. Pruning is persisted as a side effect. */
export function listOutstanding(
  activePubkey: string,
  nowMs: number = Date.now()
): ResultAsync<BunkerSecretEntry[], BunkerSecretsError> {
  if (!isNostrPubkeyHex(activePubkey)) return errAsync(INVALID_PUBKEY);
  const key = storageKey(activePubkey);
  return queued(() =>
    loadEntries(key, nowMs).andThen(({ entries, dirty }) =>
      (dirty ? persistEntries(key, entries) : okAsync<void, BunkerSecretsError>(undefined)).map(
        () => entries
      )
    )
  );
}

export function hasOutstanding(
  activePubkey: string,
  nowMs: number = Date.now()
): ResultAsync<boolean, BunkerSecretsError> {
  return listOutstanding(activePubkey, nowMs).map((entries) => entries.length > 0);
}
