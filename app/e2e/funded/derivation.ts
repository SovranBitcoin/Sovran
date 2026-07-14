import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

const SOVRAN_CASHU_ACCOUNT_0_PATH = `m/44'/129372'/0'/0'/0/0`;

function normalizeMnemonic(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/**
 * Reproduce Sovran's frozen app-mnemonic -> account-0 Cashu derivation without
 * importing React Native app modules into the host-side E2E process.
 */
export function deriveSovranAccount0CashuSeed(appMnemonic: string): Uint8Array {
  const normalized = normalizeMnemonic(appMnemonic);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('recovery custody requires a valid BIP-39 app mnemonic');
  }

  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(normalized));
  const child = root.derive(SOVRAN_CASHU_ACCOUNT_0_PATH);
  if (!child.privateKey || child.privateKey.length !== 32) {
    throw new Error('failed to derive Sovran account-0 Cashu key material');
  }
  const cashuMnemonic = entropyToMnemonic(child.privateKey, wordlist);
  const seed = mnemonicToSeedSync(cashuMnemonic, '');
  if (seed.length !== 64) throw new Error('derived Cashu seed is not 64 bytes');
  return new Uint8Array(seed);
}
