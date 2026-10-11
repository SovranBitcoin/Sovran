/**
 * Runs the derivation integrity check against what this device has stored, and
 * holds the failures the critical screen shows.
 *
 * `derivationIntegrity.ts` is the checker and stays pure. This module is its
 * reader: it fetches the phrase, the row and the stored secrets without
 * changing any of them, stretches the phrase on its own, hands it all over,
 * and records a failure. It never repairs: a mismatch stops the account, and a
 * person decides what happens next.
 */
import { useSyncExternalStore } from 'react';

import { registerAccountScoped } from '@/shared/lib/account/accountRegistry';
import { log } from '@/shared/lib/logger';
import {
  checkAccountIntegrity,
  expectedWalletPhrase,
  phraseDerivesPubkey,
  walletSeedIsCurrent,
  type AccountIntegrityInput,
  type AccountIntegrityResult,
  type IntegrityRow,
} from '@/shared/lib/nostr/derivationIntegrity';
import { stretchPhraseJs, stretchPhraseNative } from '@/shared/lib/nostr/phraseStretch';
import {
  hashMnemonic,
  readAccountSecretsUnchanged,
  retrieveMnemonic,
  type StoredAccountSecrets,
} from '@/shared/lib/nostr/secureStorage';
import { useProfileStore } from '@/shared/stores/global/profileStore';

// ── The failures the critical screen shows ──────────────────────

// One per account. Every one is kept: the provider decides which to show, and
// the active account's always comes first.
const failures = new Map<number, AccountIntegrityResult>();
let failureList: readonly AccountIntegrityResult[] = [];
const listeners = new Set<() => void>();

function publishFailures(): void {
  failureList = [...failures.values()];
  for (const listener of listeners) listener();
}

/** Record a mismatch for its account, beside any already recorded for others. */
export function reportIntegrityFailure(result: AccountIntegrityResult): void {
  // Fingerprints only: a result never holds a secret.
  log.error('nostr.integrity.mismatch', {
    accountIndex: result.accountIndex,
    source: result.source,
    pubkeyPrefix: result.pubkeyPrefix,
    code: result.diagnosticCode,
    mismatches: result.mismatches,
  });
  failures.set(result.accountIndex, result);
  publishFailures();
}

/**
 * Close one account's failure. The provider only offers this for an account
 * that is not the active one, and another account's failure is untouched.
 */
export function dismissIntegrityFailure(accountIndex: number): void {
  if (failures.delete(accountIndex)) publishFailures();
}

export function getIntegrityFailures(): readonly AccountIntegrityResult[] {
  return failureList;
}

export function useIntegrityFailures(): readonly AccountIntegrityResult[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getIntegrityFailures,
    getIntegrityFailures
  );
}

// ── The check's own root seed ───────────────────────────────────

/**
 * The stored phrase, stretched by this module and kept for the launch. It is
 * never the seed the app derived with: a seed that had gone wrong there must
 * not be the one that vouches for what was derived from it. `byReference` is
 * true once the JS stretch made it; a native one is trusted until it disagrees.
 */
let root: { phrase: string; seed: Uint8Array; byReference: boolean } | null = null;

async function rootSeedOf(phrase: string, byReference: boolean): Promise<Uint8Array> {
  if (root?.phrase === phrase && (root.byReference || !byReference)) return root.seed;
  const native = byReference ? null : await stretchPhraseNative(phrase);
  // No native stretch: one pause on the JS thread, once per launch.
  root = { phrase, seed: native ?? stretchPhraseJs(phrase), byReference: !native };
  return root.seed;
}

registerAccountScoped(
  'nostr.integrity',
  () => {
    failures.clear();
    publishFailures();
    root?.seed.fill(0);
    root = null;
  },
  () => failures.size === 0 && root === null
);

// ── Checks ──────────────────────────────────────────────────────

interface VerifyOptions {
  /** The phrase, when the caller already holds it. Otherwise it is read. */
  phrase?: string;
  /** What secure storage holds, when the caller has already read it unchanged. */
  stored?: StoredAccountSecrets;
  /** The keys and wallet phrase about to be used for the account. */
  session?: AccountIntegrityInput['session'];
  /**
   * Whether this account is worth a pause on the JS thread: true for the
   * account being opened or switched to. For the others, a wallet seed cache is
   * only checked when the native stretch is there to do it.
   */
  thorough: boolean;
}

/**
 * The full check of one stored account: every invariant, derived afresh, with
 * nothing written. Resolves null when the phrase cannot be read, which is the
 * key recovery screen's case and not a mismatch.
 */
export async function verifyStoredAccount(
  row: IntegrityRow,
  options: VerifyOptions
): Promise<AccountIntegrityResult | null> {
  const phrase = options.phrase ?? (await retrieveMnemonic());
  if (!phrase) return null;
  const stored =
    options.stored ??
    (await readAccountSecretsUnchanged(
      row.accountIndex,
      row.source === 'imported' ? row.pubkey : null
    ));
  const hashes = { stored, phraseHash: hashMnemonic(phrase), hashPhrase: hashMnemonic };

  let usedNative = false;
  const run = async (byReference: boolean) => {
    const rootSeed = await rootSeedOf(phrase, byReference);
    usedNative ||= !root?.byReference;
    let expectedWalletSeed: Uint8Array | null = null;
    try {
      // Only stretched when there is a current seed cache to compare it with.
      const walletPhrase = expectedWalletPhrase(rootSeed, row);
      if (walletSeedIsCurrent(hashes, walletPhrase)) {
        const native = byReference ? null : await stretchPhraseNative(walletPhrase);
        usedNative ||= !!native;
        expectedWalletSeed =
          native ?? (byReference || options.thorough ? stretchPhraseJs(walletPhrase) : null);
      }
    } catch {
      // A row with no usable key has no wallet phrase; the check reports the row.
      expectedWalletSeed = null;
    }
    return checkAccountIntegrity({
      row,
      ...hashes,
      rootSeed,
      expectedWalletSeed,
      session: options.session,
    });
  };
  const result = await run(false);
  // A mismatch is only believed once the reference stretch agrees, so a fault
  // in the native one can never put a healthy account on the critical screen.
  return result.ok || !usedNative ? result : run(true);
}

/**
 * Whether the phrase derives `pubkey` at `accountIndex`: asked before a row
 * labelled imported is treated as derived, and before a new derived row is saved.
 */
export async function phraseDerivesAccount(
  phrase: string,
  accountIndex: number,
  pubkey: string
): Promise<boolean> {
  try {
    if (phraseDerivesPubkey(await rootSeedOf(phrase, false), accountIndex, pubkey)) return true;
    // A no from the native stretch is confirmed, as a mismatch is.
    return (
      !root?.byReference &&
      phraseDerivesPubkey(await rootSeedOf(phrase, true), accountIndex, pubkey)
    );
  } catch {
    return false;
  }
}

/** The same question about the stored phrase. False when it cannot be read. */
export async function storedPhraseDerivesAccount(
  accountIndex: number,
  pubkey: string
): Promise<boolean> {
  const phrase = await retrieveMnemonic();
  return !!phrase && phraseDerivesAccount(phrase, accountIndex, pubkey);
}

/**
 * Check the accounts that are not open, once, after startup. The active one
 * was checked in full before it was allowed to start. A failure is recorded
 * and nothing is written.
 */
export async function verifyOtherAccountsInBackground(
  activeAccountIndex: number,
  isCurrent: () => boolean
): Promise<void> {
  for (const row of useProfileStore.getState().profiles) {
    if (row.accountIndex === activeAccountIndex) continue;
    if (!isCurrent()) return;
    try {
      const result = await verifyStoredAccount(row, { thorough: false });
      if (result && !result.ok && isCurrent()) reportIntegrityFailure(result);
    } catch {
      // The error is not logged: it may quote a secret. A check that could
      // not run is not a mismatch.
      log.warn('nostr.integrity.background_check_failed', { accountIndex: row.accountIndex });
    }
  }
}

/**
 * The wallet manager's question, asked as it captures its credentials: do the
 * account, imported flag and signer key about to open a wallet database belong
 * to the saved row for that index? No derivation, so it costs nothing.
 * Null when there is no row yet to compare with.
 */
export function checkStagedCredentials(staged: {
  accountIndex: number;
  isImported: boolean;
  signerKey: Uint8Array | null;
}): AccountIntegrityResult | null {
  const row = useProfileStore
    .getState()
    .profiles.find((profile) => profile.accountIndex === staged.accountIndex);
  if (!row) return null;
  return checkAccountIntegrity({
    row,
    // No cache is handed in, so the hash is never compared.
    phraseHash: '',
    hashPhrase: hashMnemonic,
    rootSeed: null,
    stored: {},
    session: staged,
  });
}
