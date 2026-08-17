import { nip19 } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

import { log } from '../logger';

// ── Memoized root seed ──────────────────────────────────────────
// PBKDF2-SHA512 (BIP-39 mnemonicToSeed at c=2048, dkLen=64) is ~3s in
// pure JS on Hermes. We cache the result in-memory so deriveNostrKeys
// + deriveCashuMnemonic share a single PBKDF2 call per profile switch.
let _cachedMnemonic: string | null = null;
let _cachedRootSeed: Uint8Array | null = null;

function getRootSeed(mnemonic: string): Uint8Array {
  if (_cachedMnemonic === mnemonic && _cachedRootSeed) return _cachedRootSeed;
  _cachedRootSeed = bip39.mnemonicToSeedSync(mnemonic);
  _cachedMnemonic = mnemonic;
  return _cachedRootSeed;
}

interface DerivedNostrKeys {
  npub: string;
  nsec: string;
  pubkey: string;
  privateKey: Uint8Array;
}

const NOSTR_DERIVATION_PREFIX = `m/44'/1237'`;

/**
 * Derive Nostr keys from a BIP-39 mnemonic using NIP-06.
 * Path: m/44'/1237'/<accountIndex>'/0/0
 *
 * Inlines `nostr-tools/nip06.accountFromSeedWords` so the BIP-39 PBKDF2
 * goes through `getRootSeed` (cached + native-accelerated) instead of
 * running a fresh pure-JS PBKDF2 inside nostr-tools every time.
 */
export function deriveNostrKeys(mnemonic: string, accountIndex: number = 0): DerivedNostrKeys {
  log.info('nostr.key_derivation.derive_nostr_keys.start', { accountIndex });
  const seed = getRootSeed(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(`${NOSTR_DERIVATION_PREFIX}/${accountIndex}'/0/0`);
  if (!child.privateKey || !child.publicKey) {
    throw new Error('Failed to derive Nostr key pair');
  }
  const sk = child.privateKey;
  // BIP340 / Nostr pubkey is the X-only (32-byte) form: drop the
  // 0x02/0x03 prefix from the compressed 33-byte public key.
  const pk = bytesToHex(child.publicKey.slice(1));

  log.info('nostr.key_derivation.derive_nostr_keys.complete', {
    accountIndex,
    pubkeyPrefix: pk.slice(0, 8),
  });
  return {
    npub: nip19.npubEncode(pk),
    nsec: nip19.nsecEncode(sk),
    pubkey: pk,
    privateKey: sk,
  };
}

const CASHU_DERIVATION_PREFIX = `m/44'/129372'`;

/**
 * Derive a Cashu (NUT-13) mnemonic from a BIP-39 root mnemonic.
 * Path: m/44'/129372'/0'/<accountIndex>'/0/0
 *
 * The child private key (32 bytes) is re-encoded as a 24-word BIP-39 mnemonic.
 */
export function deriveCashuMnemonic(mnemonic: string, accountIndex: number = 0): string {
  log.info('nostr.key_derivation.derive_cashu_mnemonic.start', { accountIndex });
  const seed = getRootSeed(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const path = `${CASHU_DERIVATION_PREFIX}/0'/${accountIndex}'/0/0`;
  const child = root.derive(path);
  log.info('nostr.key_derivation.derive_cashu_mnemonic.complete', { accountIndex, path });
  return bip39.entropyToMnemonic(child.privateKey as Uint8Array, wordlist);
}

/**
 * Derive the 64-byte Cashu wallet seed from a Cashu mnemonic.
 */
export function deriveCashuWalletSeed(cashuMnemonic: string): Uint8Array {
  log.debug('nostr.key_derivation.derive_cashu_wallet_seed.start');
  const seed = bip39.mnemonicToSeedSync(cashuMnemonic, '');
  log.debug('nostr.key_derivation.derive_cashu_wallet_seed.complete', {
    seedBytes: seed.byteLength,
  });
  return seed;
}

/**
 * Full chain: root mnemonic + account index → 64-byte Cashu wallet seed.
 * Equivalent to deriveCashuWalletSeed(deriveCashuMnemonic(mnemonic, accountIndex)).
 */
export function deriveCashuWalletSeedFromRoot(
  mnemonic: string,
  accountIndex: number = 0
): Uint8Array {
  log.info('nostr.key_derivation.derive_seed_from_root.start', { accountIndex });
  const seed = deriveCashuWalletSeed(deriveCashuMnemonic(mnemonic, accountIndex));
  log.info('nostr.key_derivation.derive_seed_from_root.complete', {
    accountIndex,
    seedBytes: seed.byteLength,
  });
  return seed;
}

// ── Imported nsec profile derivation ────────────────────────────

/**
 * Derive a deterministic 31-bit account number from a hex public key.
 * Uses the full 32-byte (64-char) pubkey with BigInt to avoid JS number precision loss.
 * Result is valid BIP-32 hardened index (0 .. 2^31 - 1).
 *
 * There is no official Nostr NIP for pubkey-to-number conversion. This is a
 * custom deterministic mapping. Changing this breaks existing imported profiles.
 */
export function pubkeyToAccountNumber(pubkeyHex: string): number {
  log.debug('nostr.key_derivation.pubkey_to_account_number', {
    pubkeyPrefix: pubkeyHex.slice(0, 8),
  });
  const full = BigInt('0x' + pubkeyHex);
  return Number(full % 0x80000000n) & 0x7fffffff;
}

/**
 * Derive a Cashu mnemonic for an imported nsec profile.
 * Path: m/44'/129372'/0'/<npubNumber>'/1/0
 *
 * Identical to {@link deriveCashuMnemonic} except:
 *  - Account segment is `npubNumber` (from {@link pubkeyToAccountNumber}).
 *  - External chain is `1` instead of `0`, distinguishing imported profiles.
 */
export function deriveCashuMnemonicForImported(mnemonic: string, npubNumber: number): string {
  log.info('nostr.key_derivation.derive_cashu_mnemonic_imported.start', { npubNumber });
  const seed = getRootSeed(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const path = `${CASHU_DERIVATION_PREFIX}/0'/${npubNumber}'/1/0`;
  const child = root.derive(path);
  log.info('nostr.key_derivation.derive_cashu_mnemonic_imported.complete', { npubNumber, path });
  return bip39.entropyToMnemonic(child.privateKey as Uint8Array, wordlist);
}

/**
 * Full chain for imported profiles: root mnemonic + npubNumber → 64-byte Cashu wallet seed.
 */
export function deriveCashuWalletSeedForImported(mnemonic: string, npubNumber: number): Uint8Array {
  log.info('nostr.key_derivation.derive_seed_imported.start', { npubNumber });
  const seed = deriveCashuWalletSeed(deriveCashuMnemonicForImported(mnemonic, npubNumber));
  log.info('nostr.key_derivation.derive_seed_imported.complete', {
    npubNumber,
    seedBytes: seed.byteLength,
  });
  return seed;
}
