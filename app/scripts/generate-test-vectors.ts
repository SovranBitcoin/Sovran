/**
 * Temporary script to generate all derived values from the NIP-06 test vector
 * mnemonics. Run with: npx tsx scripts/generate-test-vectors.ts
 */
import * as nip06 from 'nostr-tools/nip06';
import * as nip19 from 'nostr-tools/nip19';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { getUsername } from '@/shared/lib/username';

const MNEMONICS = [
  'leader monkey parrot ring guide accident before fence cannon height naive bean',
  'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade',
];

const MAX_ACCOUNT = 2;

for (const mnemonic of MNEMONICS) {
  const wordCount = mnemonic.split(' ').length;
  console.log('='.repeat(80));
  console.log(`Root mnemonic (${wordCount} words):`);
  console.log(`  ${mnemonic}`);
  console.log();

  for (let account = 0; account < MAX_ACCOUNT; account++) {
    console.log(`--- Account ${account} ---`);

    // NIP-06: m/44'/1237'/<account>'/0/0
    const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(
      mnemonic,
      undefined,
      account
    );
    const nsec = nip19.nsecEncode(sk);
    const npub = nip19.npubEncode(pk);

    const username = getUsername(pk);

    console.log('  Nostr (NIP-06):');
    console.log(`    path:        m/44'/1237'/${account}'/0/0`);
    console.log(`    private key: ${bytesToHex(sk)}`);
    console.log(`    public key:  ${pk}`);
    console.log(`    nsec:        ${nsec}`);
    console.log(`    npub:        ${npub}`);
    console.log(`    username:    ${username}`);

    // Cashu mnemonic: m/44'/129372'/0'/<account>'/0/0
    const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(mnemonic));
    const cashuPath = `m/44'/129372'/0'/${account}'/0/0`;
    const child = root.derive(cashuPath);
    const cashuPrivKey = child.privateKey as Uint8Array;
    const cashuMnemonic = bip39.entropyToMnemonic(cashuPrivKey, wordlist);

    console.log('  Cashu mnemonic (NUT-13):');
    console.log(`    path:        ${cashuPath}`);
    console.log(`    child key:   ${bytesToHex(cashuPrivKey)}`);
    console.log(`    mnemonic:    ${cashuMnemonic}`);

    // Cashu wallet seed
    const walletSeed = bip39.mnemonicToSeedSync(cashuMnemonic, '');
    console.log('  Cashu wallet seed:');
    console.log(`    seed (hex):  ${bytesToHex(walletSeed)}`);
    console.log(`    length:      ${walletSeed.length} bytes`);
    console.log();
  }
}
