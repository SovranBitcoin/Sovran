/** @jest-environment node */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { mnemonicToSeedSync } from '@scure/bip39';
import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';

import {
  checkAccountIntegrity,
  expectedDerivedPubkey,
  expectedImportedAccountNumber,
  expectedWalletPhrase,
  phraseDerivesPubkey,
  type AccountIntegrityInput,
  type IntegrityInvariant,
} from '@/shared/lib/nostr/derivationIntegrity';
import {
  deriveCashuMnemonic,
  deriveCashuMnemonicForImported,
  deriveCashuWalletSeed,
  deriveNostrKeys,
  pubkeyToAccountNumber,
} from '@/shared/lib/nostr/keyDerivation';

jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/**
 * The checker derives with its own code. These tests hold it to the published
 * NIP-06 vector, to the app's own derivation, and to each invariant in turn:
 * a healthy account passes, and each kind of damage is named.
 */
const ROOT =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_ROOT = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const hashPhrase = (phrase: string) => bytesToHex(sha256(utf8ToBytes(phrase))).slice(0, 16);
const seedOf = (phrase: string) => mnemonicToSeedSync(phrase, '');

const importedSecret = new Uint8Array(32).fill(9);
const importedPubkey = getPublicKey(importedSecret);
const importedNsec = nip19.nsecEncode(importedSecret);

/** Everything a release writes for a derived account, all of it correct. */
function derivedAccount(root: string, accountIndex: number): AccountIntegrityInput {
  const keys = deriveNostrKeys(root, accountIndex);
  const walletPhrase = deriveCashuMnemonic(root, accountIndex);
  const walletSeed = deriveCashuWalletSeed(walletPhrase);
  return {
    row: { accountIndex, pubkey: keys.pubkey },
    phraseHash: hashPhrase(root),
    hashPhrase,
    rootSeed: seedOf(root),
    expectedWalletSeed: walletSeed,
    stored: {
      derivedKeys: {
        npub: keys.npub,
        nsec: keys.nsec,
        pubkey: keys.pubkey,
        privateKeyHex: bytesToHex(keys.privateKey),
        mnemonicHash: hashPhrase(root),
      },
      walletPhrase: { value: walletPhrase, mnemonicHash: hashPhrase(root) },
      // The wallet keys its seed cache to the wallet phrase it stretched.
      walletSeed: { seed: walletSeed, mnemonicHash: hashPhrase(walletPhrase) },
    },
    session: {
      accountIndex,
      isImported: false,
      signerKey: keys.privateKey,
      walletPhrase,
    },
  };
}

/** The same for an imported account: its own key, and a wallet phrase from the root. */
function importedAccount(root: string): AccountIntegrityInput {
  const accountIndex = pubkeyToAccountNumber(importedPubkey);
  const walletPhrase = deriveCashuMnemonicForImported(root, accountIndex);
  const walletSeed = deriveCashuWalletSeed(walletPhrase);
  return {
    row: { accountIndex, pubkey: importedPubkey, source: 'imported' },
    phraseHash: hashPhrase(root),
    hashPhrase,
    rootSeed: seedOf(root),
    expectedWalletSeed: walletSeed,
    stored: {
      importedNsec,
      walletPhrase: { value: walletPhrase, mnemonicHash: hashPhrase(root) },
      walletSeed: { seed: walletSeed, mnemonicHash: hashPhrase(walletPhrase) },
    },
    session: { accountIndex, isImported: true, signerKey: importedSecret, walletPhrase },
  };
}

const failed = (input: AccountIntegrityInput): IntegrityInvariant[] =>
  checkAccountIntegrity(input).mismatches.map((mismatch) => mismatch.invariant);
const statusOf = (input: AccountIntegrityInput, invariant: IntegrityInvariant) =>
  checkAccountIntegrity(input).checks.find((check) => check.invariant === invariant);

describe('its own derivation', () => {
  it('matches the published NIP-06 test vector', () => {
    const seed = seedOf(
      'leader monkey parrot ring guide accident before fence cannon height naive bean'
    );
    expect(expectedDerivedPubkey(seed, 0)).toBe(
      '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917'
    );
  });

  it('agrees with the derivation the app runs, for identities and wallet phrases', () => {
    const seed = seedOf(ROOT);
    for (const index of [0, 1, 2, 63]) {
      expect(expectedDerivedPubkey(seed, index)).toBe(deriveNostrKeys(ROOT, index).pubkey);
      expect(expectedWalletPhrase(seed, { accountIndex: index, pubkey: '' })).toBe(
        deriveCashuMnemonic(ROOT, index)
      );
    }
    const number = pubkeyToAccountNumber(importedPubkey);
    expect(expectedImportedAccountNumber(importedPubkey)).toBe(number);
    expect(
      expectedWalletPhrase(seed, {
        accountIndex: number,
        pubkey: importedPubkey,
        source: 'imported',
      })
    ).toBe(deriveCashuMnemonicForImported(ROOT, number));
  });

  it('answers the one question the migrations ask', () => {
    const seed = seedOf(ROOT);
    expect(phraseDerivesPubkey(seed, 0, deriveNostrKeys(ROOT, 0).pubkey)).toBe(true);
    expect(phraseDerivesPubkey(seed, 0, deriveNostrKeys(ROOT, 1).pubkey)).toBe(false);
    expect(phraseDerivesPubkey(seed, 0, deriveNostrKeys(OTHER_ROOT, 0).pubkey)).toBe(false);
  });
});

describe('a healthy account', () => {
  it('passes every invariant that applies to a derived account', () => {
    const result = checkAccountIntegrity(derivedAccount(ROOT, 1));
    expect(result.ok).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.diagnosticCode).toBeNull();
    expect(
      result.checks.filter((check) => check.status === 'pass').map((c) => c.invariant)
    ).toEqual([
      'row.derived-pubkey',
      'cache.derived-keys-consistent',
      'cache.derived-keys-row',
      'cache.derived-keys-phrase',
      'cache.wallet-phrase',
      'cache.wallet-seed',
      'session.account',
      'session.signer-row',
      'session.wallet-phrase',
    ]);
  });

  it('passes every invariant that applies to an imported account', () => {
    const result = checkAccountIntegrity(importedAccount(ROOT));
    expect(result.ok).toBe(true);
    expect(result.source).toBe('imported');
    expect(
      result.checks.filter((check) => check.status === 'pass').map((c) => c.invariant)
    ).toEqual([
      'row.imported-key',
      'row.imported-index',
      'cache.wallet-phrase',
      'cache.wallet-seed',
      'session.account',
      'session.signer-row',
      'session.wallet-phrase',
    ]);
  });

  it('passes with nothing cached and nothing staged', () => {
    const { row, phraseHash, rootSeed } = derivedAccount(ROOT, 0);
    const result = checkAccountIntegrity({ row, phraseHash, hashPhrase, rootSeed, stored: {} });
    expect(result.ok).toBe(true);
    expect(result.complete).toBe(true);
  });

  it('says so when it could not run the checks that need the root seed', () => {
    const result = checkAccountIntegrity({ ...derivedAccount(ROOT, 0), rootSeed: null });
    expect(result.ok).toBe(true);
    expect(result.complete).toBe(false);
    expect(statusOf({ ...derivedAccount(ROOT, 0), rootSeed: null }, 'row.derived-pubkey')).toEqual({
      invariant: 'row.derived-pubkey',
      status: 'not-checked',
      reason: 'no-root-seed',
    });
  });
});

describe('a derived account that does not follow from the phrase', () => {
  it('names a row whose key the phrase does not derive', () => {
    const input = derivedAccount(ROOT, 0);
    input.row = { accountIndex: 0, pubkey: deriveNostrKeys(OTHER_ROOT, 0).pubkey };
    expect(failed(input)).toEqual(
      expect.arrayContaining(['row.derived-pubkey', 'cache.derived-keys-row', 'session.signer-row'])
    );
  });

  it('compares whole values, not the eight characters it reports', () => {
    // Each of these shares its reported prefix with the right value and
    // differs only after it. Comparing the prints would pass them all.
    const right = derivedAccount(ROOT, 0);
    const tail = (pubkey: string) => pubkey.slice(0, 8) + '0'.repeat(56);

    const row = derivedAccount(ROOT, 0);
    row.row = { accountIndex: 0, pubkey: tail(right.row.pubkey) };
    row.stored = {};
    row.session = undefined;
    expect(failed(row)).toEqual(['row.derived-pubkey']);
    // The report cannot tell them apart, which is why it must not decide.
    const reported = statusOf(row, 'row.derived-pubkey');
    expect(reported).toMatchObject({ status: 'fail' });
    if (reported?.status === 'fail') expect(reported.expected).toBe(reported.stored);

    const imported = importedAccount(ROOT);
    imported.row = { ...imported.row, pubkey: tail(importedPubkey) };
    expect(failed(imported)).toContain('row.imported-key');

    const signer = derivedAccount(ROOT, 0);
    signer.row = { accountIndex: 0, pubkey: tail(right.row.pubkey) };
    expect(failed(signer)).toEqual(
      expect.arrayContaining(['cache.derived-keys-row', 'session.signer-row'])
    );
  });

  it('compares a whole wallet seed', () => {
    const input = derivedAccount(ROOT, 0);
    const seed = new Uint8Array(input.stored.walletSeed!.seed);
    seed[63] ^= 1;
    input.stored.walletSeed = { ...input.stored.walletSeed!, seed };
    expect(failed(input)).toEqual(['cache.wallet-seed']);
  });

  it('reads a cache of the wrong shape as absent, not as another wallet', () => {
    // A seed that is not 64 bytes is not a seed. The wallet drops and remakes
    // such a cache when it opens; it must not stop a healthy account first.
    const seed = derivedAccount(ROOT, 0);
    seed.stored.walletSeed = { ...seed.stored.walletSeed!, seed: new Uint8Array([0]) };
    expect(checkAccountIntegrity(seed)).toMatchObject({ ok: true, complete: true });
    expect(statusOf(seed, 'cache.wallet-seed')).toMatchObject({ reason: 'absent' });

    // The same for a key cache whose private key is not a key at all.
    const keys = derivedAccount(ROOT, 0);
    keys.stored.derivedKeys = { ...keys.stored.derivedKeys!, privateKeyHex: '0'.repeat(64) };
    expect(checkAccountIntegrity(keys)).toMatchObject({ ok: true });
    expect(statusOf(keys, 'cache.derived-keys-row')).toMatchObject({ reason: 'absent' });
  });

  it('says so when a current wallet seed cache could not be held against anything', () => {
    const input = { ...derivedAccount(ROOT, 0), expectedWalletSeed: null };
    expect(statusOf(input, 'cache.wallet-seed')).toEqual({
      invariant: 'cache.wallet-seed',
      status: 'not-checked',
      reason: 'no-wallet-seed',
    });
    expect(checkAccountIntegrity(input).complete).toBe(false);
  });

  it('names a row filed under the wrong index', () => {
    const input = derivedAccount(ROOT, 0);
    input.row = { accountIndex: 3, pubkey: input.row.pubkey };
    expect(failed(input)).toContain('row.derived-pubkey');
  });

  it('catches a current cache that holds another key, without the root seed', () => {
    const input = derivedAccount(ROOT, 0);
    const other = deriveNostrKeys(ROOT, 4);
    input.rootSeed = null;
    input.stored.derivedKeys = {
      npub: other.npub,
      nsec: other.nsec,
      pubkey: other.pubkey,
      privateKeyHex: bytesToHex(other.privateKey),
      mnemonicHash: hashPhrase(ROOT),
    };
    expect(failed(input)).toEqual(['cache.derived-keys-row']);
  });

  it('catches a cache whose parts describe different keys', () => {
    const input = derivedAccount(ROOT, 0);
    // The public field still says the row's key; the private key is another's.
    input.stored.derivedKeys!.privateKeyHex = bytesToHex(deriveNostrKeys(ROOT, 4).privateKey);
    expect(failed(input)).toEqual(
      expect.arrayContaining([
        'cache.derived-keys-consistent',
        'cache.derived-keys-row',
        'cache.derived-keys-phrase',
      ])
    );
  });

  it("catches a current wallet phrase cache that is not this account's", () => {
    const input = derivedAccount(ROOT, 0);
    input.stored.walletPhrase = {
      value: deriveCashuMnemonic(ROOT, 1),
      mnemonicHash: hashPhrase(ROOT),
    };
    expect(failed(input)).toEqual(['cache.wallet-phrase']);
  });

  it("catches a current wallet seed cache that is not the wallet phrase's seed", () => {
    const input = derivedAccount(ROOT, 0);
    input.stored.walletSeed = {
      seed: deriveCashuWalletSeed(deriveCashuMnemonic(ROOT, 1)),
      mnemonicHash: hashPhrase(deriveCashuMnemonic(ROOT, 0)),
    };
    expect(failed(input)).toEqual(['cache.wallet-seed']);
  });

  it('catches a signer key, a wallet phrase or an account staged for another account', () => {
    const input = derivedAccount(ROOT, 0);
    input.session = {
      accountIndex: 1,
      isImported: false,
      signerKey: deriveNostrKeys(ROOT, 1).privateKey,
      walletPhrase: deriveCashuMnemonic(ROOT, 1),
    };
    expect(failed(input)).toEqual([
      'session.account',
      'session.signer-row',
      'session.wallet-phrase',
    ]);
  });

  it('catches a derived account about to be opened as an imported one', () => {
    const input = derivedAccount(ROOT, 0);
    input.session = { ...input.session, isImported: true };
    expect(failed(input)).toEqual(['session.account']);
  });
});

describe('an imported account', () => {
  it("names a stored key that is not the row's", () => {
    const input = importedAccount(ROOT);
    input.stored.importedNsec = nip19.nsecEncode(new Uint8Array(32).fill(3));
    expect(failed(input)).toContain('row.imported-key');
  });

  it('names a stored value that is not a key at all', () => {
    const input = importedAccount(ROOT);
    input.stored.importedNsec = nip19.npubEncode(importedPubkey);
    expect(statusOf(input, 'row.imported-key')).toMatchObject({
      status: 'fail',
      stored: 'unreadable',
    });
  });

  it("names a row filed under a number that is not its key's", () => {
    const input = importedAccount(ROOT);
    input.row = { ...input.row, accountIndex: 2 };
    expect(failed(input)).toContain('row.imported-index');
  });

  it('names a wallet phrase cache from the derived chain', () => {
    const input = importedAccount(ROOT);
    input.stored.walletPhrase = {
      value: deriveCashuMnemonic(ROOT, input.row.accountIndex),
      mnemonicHash: hashPhrase(ROOT),
    };
    expect(failed(input)).toEqual(['cache.wallet-phrase']);
  });

  it('leaves a missing key to the re-import screen: absent is not a mismatch', () => {
    const input = importedAccount(ROOT);
    input.stored.importedNsec = null;
    input.session = undefined;
    // A row can also read as imported because a newer build wrote a source
    // this one does not know; its caches are then the derived chain's.
    input.stored.walletPhrase = {
      value: deriveCashuMnemonic(ROOT, input.row.accountIndex),
      mnemonicHash: hashPhrase(ROOT),
    };
    const result = checkAccountIntegrity(input);
    expect(result.ok).toBe(true);
    expect(statusOf(input, 'row.imported-key')).toMatchObject({ reason: 'absent' });
  });

  it('is healthy whatever the root phrase, as long as its own key matches', () => {
    // The identity does not come from the phrase, so another phrase cannot
    // make it a mismatch. Caches made under the old phrase are ignored.
    const input = importedAccount(ROOT);
    const result = checkAccountIntegrity({
      ...input,
      phraseHash: hashPhrase(OTHER_ROOT),
      rootSeed: seedOf(OTHER_ROOT),
      expectedWalletSeed: null,
      session: {
        accountIndex: input.row.accountIndex,
        isImported: true,
        signerKey: importedSecret,
      },
    });
    expect(result.ok).toBe(true);
    expect(
      statusOf({ ...input, phraseHash: hashPhrase(OTHER_ROOT) }, 'cache.wallet-phrase')
    ).toMatchObject({ reason: 'stale' });
  });
});

describe("the phrase an imported account's wallet was made from", () => {
  const recorded = (root: string): AccountIntegrityInput => {
    const input = importedAccount(root);
    return { ...input, row: { ...input.row, walletPhraseFingerprint: hashPhrase(root) } };
  };

  it('passes while the phrase is the one the account recorded', () => {
    expect(failed(recorded(ROOT))).toEqual([]);
    expect(statusOf(recorded(ROOT), 'row.imported-wallet-phrase')).toMatchObject({
      status: 'pass',
    });
  });

  it('stops the account when another phrase would derive it a different wallet', () => {
    // The key still matches, so nothing else objects: this is the only check
    // that can, and it needs neither a derivation nor the keychain.
    const result = checkAccountIntegrity({
      ...recorded(ROOT),
      phraseHash: hashPhrase(OTHER_ROOT),
      rootSeed: null,
      expectedWalletSeed: null,
      stored: {},
      session: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.mismatches.map((mismatch) => mismatch.invariant)).toEqual([
      'row.imported-wallet-phrase',
    ]);
    expect(result.diagnosticCode).toContain('-RW-');
  });

  it('checks nothing when the caller has no phrase to hand, so a wallet can still be opened', () => {
    // The staged-credentials check runs with an empty hash just before a
    // wallet database is opened. Read as a mismatch, it would stop every
    // imported account that has a fingerprint from opening its wallet.
    const result = checkAccountIntegrity({
      ...recorded(ROOT),
      phraseHash: '',
      rootSeed: null,
      expectedWalletSeed: null,
      stored: {},
      session: {
        accountIndex: recorded(ROOT).row.accountIndex,
        isImported: true,
        signerKey: importedSecret,
      },
    });
    expect(result.ok).toBe(true);
    expect(
      result.checks.find((check) => check.invariant === 'row.imported-wallet-phrase')
    ).toMatchObject({ status: 'not-checked', reason: 'absent' });
  });

  it('holds an account imported before this was recorded against nothing', () => {
    expect(statusOf(importedAccount(ROOT), 'row.imported-wallet-phrase')).toMatchObject({
      status: 'not-checked',
      reason: 'absent',
    });
  });

  it('does not apply to an account made from the phrase', () => {
    expect(statusOf(derivedAccount(ROOT, 0), 'row.imported-wallet-phrase')).toMatchObject({
      status: 'not-checked',
      reason: 'not-applicable',
    });
  });
});

describe('after a recovery', () => {
  it('ignores caches made from the phrase that was replaced', () => {
    // Recovery only accepts a phrase that derives the saved derived rows, or
    // empties the list first. What it leaves behind is caches keyed to the
    // old phrase, and those must never read as a mismatch.
    const before = derivedAccount(OTHER_ROOT, 0);
    const after = derivedAccount(ROOT, 0);
    const result = checkAccountIntegrity({
      ...after,
      stored: before.stored,
      expectedWalletSeed: null,
    });
    expect(result.ok).toBe(true);
    for (const invariant of [
      'cache.derived-keys-consistent',
      'cache.derived-keys-row',
      'cache.derived-keys-phrase',
      'cache.wallet-phrase',
      'cache.wallet-seed',
    ] as const) {
      expect(result.checks.find((check) => check.invariant === invariant)).toMatchObject({
        status: 'not-checked',
        reason: 'stale',
      });
    }
  });

  it('still stops a row the new phrase does not derive', () => {
    const input = derivedAccount(ROOT, 0);
    input.row = { accountIndex: 0, pubkey: deriveNostrKeys(OTHER_ROOT, 0).pubkey };
    input.stored = derivedAccount(OTHER_ROOT, 0).stored;
    input.session = undefined;
    expect(failed(input)).toEqual(['row.derived-pubkey']);
  });
});

describe('what a result gives away', () => {
  const secretsOf = (root: string) => {
    const keys = deriveNostrKeys(root, 0);
    const walletPhrase = deriveCashuMnemonic(root, 0);
    return [
      root,
      keys.nsec,
      bytesToHex(keys.privateKey),
      walletPhrase,
      bytesToHex(deriveCashuWalletSeed(walletPhrase)),
      bytesToHex(seedOf(root)),
      importedNsec,
      bytesToHex(importedSecret),
    ];
  };

  it('holds no secret, and no whole public key, in a failing result', () => {
    const input = derivedAccount(ROOT, 0);
    const wrong = derivedAccount(OTHER_ROOT, 0);
    input.stored = wrong.stored;
    input.stored.derivedKeys!.mnemonicHash = hashPhrase(ROOT);
    input.stored.walletPhrase!.mnemonicHash = hashPhrase(ROOT);
    input.stored.walletSeed!.mnemonicHash = hashPhrase(deriveCashuMnemonic(ROOT, 0));
    input.session = wrong.session;
    const result = checkAccountIntegrity(input);
    expect(result.mismatches.length).toBeGreaterThan(4);

    const text = JSON.stringify(result);
    for (const secret of [...secretsOf(ROOT), ...secretsOf(OTHER_ROOT)]) {
      expect(text).not.toContain(secret);
      // Not a piece of one either: no run of 12 characters from any secret.
      for (let i = 0; i + 12 <= secret.length; i += 6) {
        expect(text).not.toContain(secret.slice(i, i + 12));
      }
    }
    expect(text).not.toContain(input.row.pubkey);
    expect(text).not.toContain(wrong.row.pubkey);
  });

  it('gives a short code that names the account and what failed', () => {
    const input = derivedAccount(ROOT, 2);
    const other = deriveNostrKeys(OTHER_ROOT, 2).pubkey;
    input.row = { accountIndex: 2, pubkey: other };
    input.stored = {};
    input.session = undefined;
    expect(checkAccountIntegrity(input).diagnosticCode).toBe(
      `AM1-D2-RD-${deriveNostrKeys(ROOT, 2).pubkey.slice(0, 8)}-${other.slice(0, 8)}`
    );
  });

  it('prints a secret the same way each time, and differently from another', () => {
    const a = statusOf(
      {
        ...derivedAccount(ROOT, 0),
        stored: {
          walletPhrase: { value: deriveCashuMnemonic(ROOT, 1), mnemonicHash: hashPhrase(ROOT) },
        },
      },
      'cache.wallet-phrase'
    );
    expect(a).toMatchObject({ status: 'fail' });
    if (a?.status !== 'fail') return;
    expect(a.expected).toMatch(/^h:[0-9a-f]{8}$/);
    expect(a.stored).toMatch(/^h:[0-9a-f]{8}$/);
    expect(a.expected).not.toBe(a.stored);
  });
});
