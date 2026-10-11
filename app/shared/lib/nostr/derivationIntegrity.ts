/**
 * One checker for everything an account derives from the recovery phrase.
 *
 * It answers a single question: do the values saved for this account still
 * follow from the phrase (or, for an imported account, from its stored key)?
 * The chain it checks is written out in
 * `docs/architecture/persistence/derivation.md`.
 *
 * Two rules keep it trustworthy:
 *
 * - **Independent.** It derives with its own paths and its own code, and does
 *   not import `keyDerivation.ts`, the loader or the caches' writers. A bug in
 *   the code that produced a value cannot also hide it here.
 * - **Pure.** It reads nothing and writes nothing. Callers hand it the row, the
 *   stored secrets and a root seed, and get a list back. What to do about a
 *   mismatch is the caller's decision; this module never repairs.
 *
 * A result carries fingerprints, never secrets: a public key is shown by its
 * first eight characters, anything secret by eight characters of a tagged hash.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { HDKey } from '@scure/bip32';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';

// Spelled out here on purpose. These are the paths every release since 0.0.62
// has used; if `keyDerivation.ts` ever drifts from them, this is what notices.
const nostrPath = (accountIndex: number) => `m/44'/1237'/${accountIndex}'/0/0`;
const walletPath = (accountNumber: number, chain: 0 | 1) =>
  `m/44'/129372'/0'/${accountNumber}'/${chain}/0`;

const HEX_64 = /^[0-9a-f]{64}$/;

export type IntegrityInvariant =
  /** A derived row's public key is the one the phrase derives at its index. */
  | 'row.derived-pubkey'
  /** An imported row's public key is the public key of its stored nsec. */
  | 'row.imported-key'
  /** An imported row's index is the number computed from its public key. */
  | 'row.imported-index'
  /** The cached private key, nsec, npub and public key describe one key. */
  | 'cache.derived-keys-consistent'
  /** The cached derived key is the row's. */
  | 'cache.derived-keys-row'
  /** The cached derived key is the one the phrase derives. */
  | 'cache.derived-keys-phrase'
  /** The cached wallet phrase is the one the phrase derives for this account. */
  | 'cache.wallet-phrase'
  /** The cached wallet seed is the seed of that wallet phrase. */
  | 'cache.wallet-seed'
  /** The account and imported flag about to be used name this row. */
  | 'session.account'
  /** The signing key about to be used is the row's. */
  | 'session.signer-row'
  /** The wallet phrase about to be used is the one the phrase derives. */
  | 'session.wallet-phrase';

/** Short names for the diagnostic code a person reads out to support. */
const INVARIANT_CODE: Record<IntegrityInvariant, string> = {
  'row.derived-pubkey': 'RD',
  'row.imported-key': 'RK',
  'row.imported-index': 'RI',
  'cache.derived-keys-consistent': 'CC',
  'cache.derived-keys-row': 'CR',
  'cache.derived-keys-phrase': 'CP',
  'cache.wallet-phrase': 'CW',
  'cache.wallet-seed': 'CS',
  'session.account': 'SA',
  'session.signer-row': 'SS',
  'session.wallet-phrase': 'SW',
};

type NotCheckedReason =
  /** The value is not stored, or was not handed in. */
  | 'absent'
  /** A cache made from another phrase. The app ignores it, and so does this. */
  | 'stale'
  /** Needs the root seed, and this run was not given one. */
  | 'no-root-seed'
  /** A current wallet seed cache, but this run was not given the seed to hold it against. */
  | 'no-wallet-seed'
  /** Does not apply to this kind of account. */
  | 'not-applicable';

export type IntegrityCheck =
  | { invariant: IntegrityInvariant; status: 'pass' }
  | { invariant: IntegrityInvariant; status: 'not-checked'; reason: NotCheckedReason }
  | { invariant: IntegrityInvariant; status: 'fail'; expected: string; stored: string };

export type IntegrityMismatch = Extract<IntegrityCheck, { status: 'fail' }>;

export interface IntegrityRow {
  accountIndex: number;
  pubkey: string;
  /** Absent means derived, as in the profile store. */
  source?: 'derived' | 'imported';
}

export interface AccountIntegrityInput {
  row: IntegrityRow;
  /** `hashMnemonic` of the stored phrase: the caches are keyed to it. */
  phraseHash: string;
  /**
   * The same hash, for a wallet phrase. The wallet seed cache is keyed to the
   * phrase its seed was stretched from, which is the wallet phrase.
   */
  hashPhrase: (phrase: string) => string;
  /** BIP-39 seed of the stored phrase. Null runs only the checks that need no derivation. */
  rootSeed: Uint8Array | null;
  /**
   * BIP-39 seed of `expectedWalletPhrase(...)`, made by the caller because
   * stretching it is slow. Without it the wallet seed cache is not checked.
   */
  expectedWalletSeed?: Uint8Array | null;
  /** What secure storage holds for this account. Undefined means not read. */
  stored: {
    importedNsec?: string | null;
    derivedKeys?: {
      npub: string;
      nsec: string;
      pubkey: string;
      privateKeyHex: string;
      mnemonicHash: string;
    } | null;
    walletPhrase?: { value: string; mnemonicHash: string } | null;
    walletSeed?: { seed: Uint8Array; mnemonicHash: string } | null;
  };
  /** What is about to be used for this account: loaded keys, or staged wallet credentials. */
  session?: {
    accountIndex?: number;
    isImported?: boolean;
    signerKey?: Uint8Array | null;
    walletPhrase?: string | null;
  };
}

export interface AccountIntegrityResult {
  accountIndex: number;
  source: 'derived' | 'imported';
  /** First eight characters of the row's public key. */
  pubkeyPrefix: string;
  /** No invariant failed. Some may not have been checked: see `complete`. */
  ok: boolean;
  /** Every invariant that needs a derivation was able to run. */
  complete: boolean;
  checks: IntegrityCheck[];
  mismatches: IntegrityMismatch[];
  /** A short code for support, or null when nothing failed. Holds no secret. */
  diagnosticCode: string | null;
}

/** Thrown at a boundary that must not go on with a mismatched account. */
export class AccountIntegrityError extends Error {
  readonly result: AccountIntegrityResult;

  constructor(result: AccountIntegrityResult) {
    super('Saved account does not match the recovery phrase');
    this.name = 'AccountIntegrityError';
    this.result = result;
  }
}

// ── Fingerprints ────────────────────────────────────────────────

const pubkeyPrint = (pubkey: string) => `pub:${pubkey.slice(0, 8).toLowerCase()}`;

/** For secrets: a tagged hash, so the print cannot be matched against other hashes of the value. */
function secretPrint(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? utf8ToBytes(value) : value;
  const tagged = new Uint8Array([...utf8ToBytes('sovran-integrity-v1|'), ...bytes]);
  return `h:${bytesToHex(sha256(tagged)).slice(0, 8)}`;
}

const UNREADABLE = 'unreadable';

// ── Independent derivation ──────────────────────────────────────

function childKey(rootSeed: Uint8Array, path: string): Uint8Array {
  const key = HDKey.fromMasterSeed(rootSeed).derive(path).privateKey;
  if (!key) throw new Error('No private key at derivation path');
  return key;
}

/** NIP-06: the public key of account `accountIndex` under this root seed. */
export function expectedDerivedPubkey(rootSeed: Uint8Array, accountIndex: number): string {
  return getPublicKey(childKey(rootSeed, nostrPath(accountIndex)));
}

/** The number an imported account's wallet is filed under: its public key modulo 2^31. */
export function expectedImportedAccountNumber(pubkey: string): number {
  return Number(BigInt(`0x${pubkey}`) % 0x80000000n);
}

/** The wallet phrase this account's wallet seed is made from. */
export function expectedWalletPhrase(rootSeed: Uint8Array, row: IntegrityRow): string {
  const path =
    row.source === 'imported'
      ? walletPath(expectedImportedAccountNumber(row.pubkey), 1)
      : walletPath(row.accountIndex, 0);
  return entropyToMnemonic(childKey(rootSeed, path), wordlist);
}

function pubkeyOfSecretKey(secretKey: Uint8Array): string | null {
  try {
    return getPublicKey(secretKey);
  } catch {
    return null;
  }
}

function pubkeyOfNsec(nsec: string): string | null {
  try {
    const decoded = nip19.decode(nsec);
    return decoded.type === 'nsec' ? pubkeyOfSecretKey(decoded.data) : null;
  } catch {
    return null;
  }
}

/**
 * Whether every field of a derived-key cache can be read as a key at all. A
 * cache that fails this has the wrong shape, which is not evidence of another
 * identity: it counts as absent. Whether its fields agree is a separate
 * question, and a well-formed cache that disagrees is a mismatch.
 */
export function derivedKeysAreWellFormed(cache: {
  npub: string;
  nsec: string;
  privateKeyHex: string;
}): boolean {
  try {
    return (
      pubkeyOfSecretKey(hexToBytes(cache.privateKeyHex)) !== null &&
      pubkeyOfNsec(cache.nsec) !== null &&
      nip19.decode(cache.npub).type === 'npub'
    );
  } catch {
    return false;
  }
}

// ── The check ───────────────────────────────────────────────────

/**
 * Whether the phrase behind `rootSeed` derives this public key at this index.
 * The one comparison the migrations need; `checkAccountIntegrity` uses it too.
 */
export function phraseDerivesPubkey(
  rootSeed: Uint8Array,
  accountIndex: number,
  pubkey: string
): boolean {
  return expectedDerivedPubkey(rootSeed, accountIndex) === pubkey.toLowerCase();
}

/**
 * Whether the wallet seed cache was made for this account's current wallet
 * phrase. The wallet keys it to the phrase it stretched: the wallet phrase, or
 * the root phrase when it was not handed one.
 */
export function walletSeedIsCurrent(
  input: Pick<AccountIntegrityInput, 'stored' | 'phraseHash' | 'hashPhrase'>,
  walletPhrase: string
): boolean {
  const hash = input.stored.walletSeed?.mnemonicHash;
  return (
    hash !== undefined && (hash === input.hashPhrase(walletPhrase) || hash === input.phraseHash)
  );
}

export function checkAccountIntegrity(input: AccountIntegrityInput): AccountIntegrityResult {
  const { row, rootSeed, phraseHash, stored, session } = input;
  const imported = row.source === 'imported';
  const rowPubkey = row.pubkey.toLowerCase();
  const checks: IntegrityCheck[] = [];

  /**
   * Whole values decide; the prints are only what gets reported. Comparing the
   * prints would pass a key that shares its first eight characters. A null is
   * a value that could not be read, which matches nothing.
   */
  const compare = (
    invariant: IntegrityInvariant,
    expected: string | null,
    found: string | null,
    print: (value: string) => string
  ) =>
    checks.push(
      expected !== null && expected === found
        ? { invariant, status: 'pass' }
        : {
            invariant,
            status: 'fail',
            expected: expected === null ? UNREADABLE : print(expected),
            stored: found === null ? UNREADABLE : print(found),
          }
    );
  const plain = (value: string) => value;
  const skip = (invariant: IntegrityInvariant, reason: NotCheckedReason) =>
    checks.push({ invariant, status: 'not-checked', reason });
  /** Why a cache is left alone, or null when it should be checked. */
  const cacheSkip = (
    cache: { mnemonicHash: string } | null | undefined
  ): NotCheckedReason | null =>
    !cache ? 'absent' : cache.mnemonicHash !== phraseHash ? 'stale' : null;

  const derivedPubkey =
    rootSeed && !imported ? expectedDerivedPubkey(rootSeed, row.accountIndex) : null;

  // ── The profile row ──
  if (imported) {
    skip('row.derived-pubkey', 'not-applicable');
    if (!stored.importedNsec) {
      // A missing key is the re-import screen's case, not a mismatch.
      skip('row.imported-key', 'absent');
      skip('row.imported-index', 'absent');
    } else {
      compare('row.imported-key', rowPubkey, pubkeyOfNsec(stored.importedNsec), pubkeyPrint);
      compare(
        'row.imported-index',
        HEX_64.test(rowPubkey) ? `n:${expectedImportedAccountNumber(rowPubkey)}` : null,
        `n:${row.accountIndex}`,
        plain
      );
    }
  } else {
    skip('row.imported-key', 'not-applicable');
    skip('row.imported-index', 'not-applicable');
    if (derivedPubkey) compare('row.derived-pubkey', derivedPubkey, rowPubkey, pubkeyPrint);
    else skip('row.derived-pubkey', 'no-root-seed');
  }

  // ── The derived-key cache (derived accounts only; an imported one never reads it) ──
  const keysSkip = imported
    ? 'not-applicable'
    : (cacheSkip(stored.derivedKeys) ??
      (stored.derivedKeys && !derivedKeysAreWellFormed(stored.derivedKeys) ? 'absent' : null));
  if (keysSkip || !stored.derivedKeys) {
    const reason = keysSkip ?? 'absent';
    skip('cache.derived-keys-consistent', reason);
    skip('cache.derived-keys-row', reason);
    skip('cache.derived-keys-phrase', reason);
  } else {
    const cache = stored.derivedKeys;
    const cachePubkey = cache.pubkey.toLowerCase();
    let fromPrivateKey: string | null = null;
    try {
      fromPrivateKey = pubkeyOfSecretKey(hexToBytes(cache.privateKeyHex));
    } catch {
      fromPrivateKey = null;
    }
    let npubPubkey: string | null = null;
    try {
      const decoded = nip19.decode(cache.npub);
      npubPubkey = decoded.type === 'npub' ? decoded.data : null;
    } catch {
      npubPubkey = null;
    }
    const parts = [fromPrivateKey, pubkeyOfNsec(cache.nsec), npubPubkey];
    const odd = parts.find((part) => part !== cachePubkey);
    compare(
      'cache.derived-keys-consistent',
      cachePubkey,
      odd === undefined ? cachePubkey : odd,
      pubkeyPrint
    );
    // Compared through the private key, so a cache whose public field alone
    // was altered cannot pass.
    compare('cache.derived-keys-row', rowPubkey, fromPrivateKey, pubkeyPrint);
    if (derivedPubkey) {
      compare('cache.derived-keys-phrase', derivedPubkey, fromPrivateKey, pubkeyPrint);
    } else skip('cache.derived-keys-phrase', 'no-root-seed');
  }

  // ── The wallet phrase and seed ──
  // An imported account's wallet number comes from its public key; with a row
  // that holds no usable key there is nothing to derive from.
  // The same goes for an imported row whose key is missing: it cannot load
  // until it is re-imported or shown to be derived, so its caches are not judged.
  const walletUnknown = imported && (!stored.importedNsec || !HEX_64.test(rowPubkey));
  const walletPhrase = rootSeed && !walletUnknown ? expectedWalletPhrase(rootSeed, row) : null;
  const walletSkip: NotCheckedReason = walletUnknown ? 'absent' : 'no-root-seed';

  const phraseSkip = cacheSkip(stored.walletPhrase);
  if (phraseSkip || !stored.walletPhrase) skip('cache.wallet-phrase', phraseSkip ?? 'absent');
  else if (!walletPhrase) skip('cache.wallet-phrase', walletSkip);
  else compare('cache.wallet-phrase', walletPhrase, stored.walletPhrase.value, secretPrint);

  // Anything but 64 bytes is not a seed, so it is not a different wallet's either.
  if (!stored.walletSeed || stored.walletSeed.seed.length !== 64) {
    skip('cache.wallet-seed', 'absent');
  } else if (!walletPhrase) skip('cache.wallet-seed', walletSkip);
  else if (!walletSeedIsCurrent(input, walletPhrase)) skip('cache.wallet-seed', 'stale');
  else if (!input.expectedWalletSeed) skip('cache.wallet-seed', 'no-wallet-seed');
  else {
    compare(
      'cache.wallet-seed',
      bytesToHex(input.expectedWalletSeed),
      bytesToHex(stored.walletSeed.seed),
      secretPrint
    );
  }

  // ── What is about to be used ──
  if (session?.accountIndex === undefined || session.isImported === undefined) {
    skip('session.account', 'absent');
  } else {
    compare(
      'session.account',
      `n:${row.accountIndex}:${imported ? 'imported' : 'derived'}`,
      `n:${session.accountIndex}:${session.isImported ? 'imported' : 'derived'}`,
      plain
    );
  }

  if (!session?.signerKey) skip('session.signer-row', 'absent');
  else {
    compare('session.signer-row', rowPubkey, pubkeyOfSecretKey(session.signerKey), pubkeyPrint);
  }

  if (!session?.walletPhrase) skip('session.wallet-phrase', 'absent');
  else if (!walletPhrase) skip('session.wallet-phrase', walletSkip);
  else compare('session.wallet-phrase', walletPhrase, session.walletPhrase, secretPrint);

  const mismatches = checks.filter((check): check is IntegrityMismatch => check.status === 'fail');
  return {
    accountIndex: row.accountIndex,
    source: imported ? 'imported' : 'derived',
    pubkeyPrefix: rowPubkey.slice(0, 8),
    ok: mismatches.length === 0,
    complete: !checks.some(
      (check) =>
        check.status === 'not-checked' &&
        (check.reason === 'no-root-seed' || check.reason === 'no-wallet-seed')
    ),
    checks,
    mismatches,
    diagnosticCode: diagnosticCode(row, imported, mismatches),
  };
}

/**
 * `AM1-D0-RD+CR-1a2b3c4d-9f8e7d6c`: format version, account kind and index,
 * the invariants that failed, then what the first one expected and found.
 */
function diagnosticCode(
  row: IntegrityRow,
  imported: boolean,
  mismatches: IntegrityMismatch[]
): string | null {
  const first = mismatches[0];
  if (!first) return null;
  const bare = (print: string) =>
    print.replace(/^(pub|h|n):/, '').replace(/[^0-9a-z]/gi, '') || 'x';
  return [
    'AM1',
    `${imported ? 'I' : 'D'}${row.accountIndex}`,
    mismatches.map((mismatch) => INVARIANT_CODE[mismatch.invariant]).join('+'),
    bare(first.expected).slice(0, 8),
    bare(first.stored).slice(0, 8),
  ].join('-');
}
