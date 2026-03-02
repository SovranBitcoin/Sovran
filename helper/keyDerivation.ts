import * as nip06 from 'nostr-tools/nip06';
import { nip19 } from 'nostr-tools';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

export interface DerivedNostrKeys {
  npub: string;
  nsec: string;
  pubkey: string;
  privateKey: Uint8Array;
}

/**
 * Derive Nostr keys from a BIP-39 mnemonic using NIP-06.
 * Path: m/44'/1237'/<accountIndex>'/0/0
 */
export function deriveNostrKeys(mnemonic: string, accountIndex: number = 0): DerivedNostrKeys {
  const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(
    mnemonic,
    undefined,
    accountIndex
  );

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
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const path = `${CASHU_DERIVATION_PREFIX}/0'/${accountIndex}'/0/0`;
  const child = root.derive(path);
  return bip39.entropyToMnemonic(child.privateKey as Uint8Array, wordlist);
}

/**
 * Derive the 64-byte Cashu wallet seed from a Cashu mnemonic.
 */
export function deriveCashuWalletSeed(cashuMnemonic: string): Uint8Array {
  return bip39.mnemonicToSeedSync(cashuMnemonic, '');
}

/**
 * Full chain: root mnemonic + account index → 64-byte Cashu wallet seed.
 * Equivalent to deriveCashuWalletSeed(deriveCashuMnemonic(mnemonic, accountIndex)).
 */
export function deriveCashuWalletSeedFromRoot(
  mnemonic: string,
  accountIndex: number = 0
): Uint8Array {
  return deriveCashuWalletSeed(deriveCashuMnemonic(mnemonic, accountIndex));
}
