/**
 * Generate a legacy Redux store state for testing the migration pipeline.
 *
 * Usage:
 *   npx tsx scripts/gen-og-sovran-account.ts "<12-word mnemonic>" [cashuTokenA] [cashuTokenB] ...
 *
 * Writes the generated state to redux/store/migrationTest.deprecated.ts so
 * that a dev build boots with realistic legacy data and exercises the full
 * Redux→Coco migration path.
 */

import * as nip06 from 'nostr-tools/nip06';
import { nip19 } from 'nostr-tools';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { getDecodedToken, type Proof, type MintKeyset, type MintKeys } from '@cashu/cashu-ts';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ── CLI parsing ────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error(
    'Usage: npx tsx scripts/gen-og-sovran-account.ts "<12-word mnemonic>|new" [cashuTokenA] [cashuTokenB] ...'
  );
  process.exit(1);
}

const mnemonicArg = args[0].trim();
const mnemonic =
  mnemonicArg === 'new'
    ? bip39.entropyToMnemonic(randomBytes(16), wordlist)
    : mnemonicArg;
const tokenStrings = args.slice(1);

const words = mnemonic.trim().split(/\s+/);
if (words.length !== 12) {
  console.error(`Expected 12-word mnemonic, got ${words.length} words`);
  process.exit(1);
}
if (!bip39.validateMnemonic(mnemonic, wordlist)) {
  console.error('Expected a valid 12-word BIP-39 mnemonic or the literal "new"');
  process.exit(1);
}

// ── Nostr key derivation (NIP-06) ──────────────────────────────

const accountIndex = 0;
const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(mnemonic, undefined, accountIndex);
const nsec = nip19.nsecEncode(sk);
const npub = nip19.npubEncode(pk);

// BIP-32 root for xpub/xpriv (migration 25 logic: HDKey from mnemonic seed with empty passphrase)
const rootSeed = bip39.mnemonicToSeedSync(mnemonic, '');
const hdRoot = HDKey.fromMasterSeed(rootSeed);

// Cashu mnemonic (NUT-13, migration 72/101 logic)
const cashuDerivationPrefix = `m/44'/129372'`;
const cashuPath = `${cashuDerivationPrefix}/0'/${accountIndex}'/0/0`;
const cashuChild = hdRoot.derive(cashuPath);
const cashuMnemonic = bip39.entropyToMnemonic(cashuChild.privateKey as Uint8Array, wordlist);

console.log('=== Derived Keys ===');
console.log('pubkey:', pk);
console.log('npub:', npub);
console.log('nsec:', nsec.slice(0, 12) + '...');
console.log('xpub:', hdRoot.publicExtendedKey.slice(0, 20) + '...');
console.log('cashu mnemonic words:', cashuMnemonic.split(' ').length);

// ── Token decoding ─────────────────────────────────────────────

const decodedTokens: { token: { mint: string; proofs: Proof[]; unit?: string; memo?: string }; raw: string }[] = [];

for (const tokenStr of tokenStrings) {
  try {
    const token = getDecodedToken(tokenStr);
    decodedTokens.push({ token, raw: tokenStr });
    console.log(`\nDecoded token for mint: ${token.mint}`);
    console.log(`  proofs: ${token.proofs.length}`);
    console.log(`  total amount: ${token.proofs.reduce((s, p) => s + p.amount, 0)}`);
    console.log(`  unit: ${token.unit || 'sat'}`);
    console.log(`  keyset IDs: ${[...new Set(token.proofs.map((p) => p.id))].join(', ')}`);
  } catch (err) {
    console.error(`Failed to decode token: ${tokenStr.slice(0, 30)}...`, err);
    process.exit(1);
  }
}

// ── Build Redux state ──────────────────────────────────────────

// Group proofs by mint URL
const proofsByMint: Record<string, Proof[]> = {};
const mintUrls: string[] = [];

for (const { token } of decodedTokens) {
  const url = token.mint;
  if (!mintUrls.includes(url)) mintUrls.push(url);
  if (!proofsByMint[url]) proofsByMint[url] = [];

  for (const proof of token.proofs) {
    // Strip optional fields that didn't exist in the v2 era store
    proofsByMint[url].push({
      id: proof.id,
      amount: proof.amount,
      secret: proof.secret,
      C: proof.C,
    });
  }
}

// Build root-level keysets: cashu.keysets[mintUrl] = MintKeyset[]
// In the real app this came from mint.getKeySets().keysets
// We reconstruct from proof keyset IDs since that's all we have
const rootKeysets: Record<string, MintKeyset[]> = {};
for (const [mintUrl, proofs] of Object.entries(proofsByMint)) {
  const seenIds = new Set<string>();
  const keysets: MintKeyset[] = [];
  for (const proof of proofs) {
    if (!seenIds.has(proof.id)) {
      seenIds.add(proof.id);
      keysets.push({
        id: proof.id,
        unit: 'sat',
        active: true,
        input_fee_ppk: 0,
      });
    }
  }
  rootKeysets[mintUrl] = keysets;
}

// Build root-level keys: cashu.keys[mintUrl] = MintKeys[]
// In the real app this came from mint.getKeys().keysets
// We generate plausible dummy keys since we don't have the real mint pubkeys
// The migration code doesn't read keys, but a realistic store would have them
const rootKeys: Record<string, MintKeys[]> = {};
for (const [mintUrl, keysets] of Object.entries(rootKeysets)) {
  rootKeys[mintUrl] = keysets.map((ks) => ({
    id: ks.id,
    unit: ks.unit,
    keys: {
      1: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      2: '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      4: '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
      8: '02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13',
      16: '022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4',
      32: '02352bbf4a4cdd12564f93fa332ce333301d9ad40271f8107181340aef25be59d5',
      64: '021bf812ff58e3dfe3c77bdc44c100a6b2e0bf7d3a9b9ea24ae97b24fee8bc4c2d',
      128: '022d7b2e5c1e0e4e5b4e0c1a2d3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b',
    } as Record<number, string>,
  }));
}

// Build profile-level counters with random values > 1
// In the real app these were incremented by INCREASE_COUNTER_V2 (default 1, +amount)
const counters: Record<string, Record<string, number>> = {};
for (const [mintUrl, proofs] of Object.entries(proofsByMint)) {
  const keysetCounters: Record<string, number> = {};
  const seenIds = new Set<string>();
  for (const proof of proofs) {
    if (!seenIds.has(proof.id)) {
      seenIds.add(proof.id);
      // Random counter between 5 and 150 (realistic usage range)
      keysetCounters[proof.id] = Math.floor(Math.random() * 146) + 5;
    }
  }
  counters[mintUrl] = keysetCounters;
}

// Build mint info: cashu.info[mintUrl]
// In the real app this came from mint.getInfo()
const info: Record<string, any> = {};
for (const mintUrl of mintUrls) {
  info[mintUrl] = {
    name: mintUrl.replace(/https?:\/\//, '').split('/')[0],
    version: 'mock/0.1.0',
    description: 'Reconstructed mint info for migration testing',
  };
}

const selectedMint = mintUrls[0] || undefined;

// ── Assemble full state ────────────────────────────────────────

const nostrState = {
  currentProfile: { id: accountIndex },
  search: [
    {
      pubkey: '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2',
      profile: {
        created_at: 1724764804,
        profileEvent:
          '{"created_at":1738834915,"content":"{\\"displayName\\":\\"Sovran Bitcoin\\",\\"display_name\\":\\"Sovran Bitcoin\\",\\"name\\":\\"Sovran\\",\\"website\\":\\"https://sovranbitcoin.com\\",\\"about\\":\\"Working on a Bitcoin wallet that I like to use.\\",\\"lud16\\":\\"maskedroom40@walletofsatoshi.com\\",\\"picture\\":\\"https://m.primal.net/IEAX.png\\",\\"pubkey\\":\\"1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2\\",\\"npub\\":\\"npub1ref7jqxrh0z74554y900ufajer2lh52lk0wczrdrqcm8fjmjzweqll64x3\\",\\"created_at\\":1724764804,\\"banner\\":\\"https://m.primal.net/Kgxi.png\\"}","tags":[],"kind":0,"pubkey":"1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2","id":"97b889880504d1b0b70277076e51156b3c8d88d27acfa86882667be654aa228d","sig":"5f809e1604d84c58341664d362eb15f3d32e7faf73c9b675228a1ad4250bb80fd4ff3db7e314a7748412686abe2a7ba0e1fc0384ee72217ad82b0fcea20c4db8"}',
        displayName: 'Sovran Bitcoin',
        name: 'Sovran',
        website: 'https://sovranbitcoin.com',
        about: 'Working on a Bitcoin wallet that I like to use.',
        lud16: 'maskedroom40@walletofsatoshi.com',
        image: 'https://m.primal.net/IEAX.png',
        pubkey: '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2',
        npub: 'npub1ref7jqxrh0z74554y900ufajer2lh52lk0wczrdrqcm8fjmjzweqll64x3',
        banner: 'https://m.primal.net/Kgxi.png',
      },
    },
  ],
  profiles: [
    {
      id: accountIndex,
      mnemonic,
      pubkey: pk,
      profile: {
        created_at: 0,
        profileEvent: '',
        name: '',
        picture: '',
        image: '',
      },
      npub,
      nsec,
      mints: [],
      picture: '',
      root: {
        xpub: hdRoot.publicExtendedKey,
        xpriv: hdRoot.privateExtendedKey,
      },
      nut13: cashuMnemonic,
    },
  ],
  messages: { loaded_messages: [] },
  follows: {},
  contacts: [],
};

const cashuState = {
  profiles: [
    {
      selectedMint,
      mints: mintUrls,
      proofs: proofsByMint,
      keysets: {} as Record<string, MintKeyset[]>,  // always empty at profile level
      transactions: [] as any[],
      counters,
    },
  ],
  keysets: rootKeysets,
  keys: rootKeys,
  info,
  audits: {} as Record<string, any>,
  allocation: {} as Record<string, Record<string, number>>,
};

const settingsState = {
  settings: {
    lang: 'en',
    theme: 'dark',
    display_btc: 3,
    passcode: '',
    experimental: false,
    termsAccepted: null as null,
  },
};

// This is the shape redux-persist v6 stores under AsyncStorage key `persist:SOVRAN`
const fullPersistedState = {
  _persist: { version: 251, rehydrated: true },
  settings: settingsState,
  cashu: cashuState,
  nostr: nostrState,
};

// ── Output ─────────────────────────────────────────────────────

// Print full JSON to stdout for inspection
console.log('\n=== Full Persisted State (persist:SOVRAN) ===');
console.log(JSON.stringify(fullPersistedState, null, 2));

// Write migrationTest.deprecated.ts
const outputPath = path.resolve(__dirname, '..', 'redux', 'store', 'migrationTest.deprecated.ts');

// For the TS file we need to inline the actual decoded proofs and values
// rather than reference getDecodedToken at runtime
const tsFileContent = `\
/**
 * AUTO-GENERATED by scripts/gen-og-sovran-account.ts
 * Do not edit manually. Re-run the script to regenerate.
 *
 * This file provides initial state for the deprecated Redux store so that
 * a dev build boots with realistic legacy data and exercises the full
 * Redux→Coco migration path.
 */
export const nostrState = ${JSON.stringify(nostrState, null, 2)};

export const cashuState = ${JSON.stringify(cashuState, null, 2)};
`;

fs.writeFileSync(outputPath, tsFileContent, 'utf-8');
console.log(`\nWrote ${outputPath}`);

console.log('\n=== Summary ===');
console.log(`Mnemonic: ${mnemonic.split(' ').slice(0, 3).join(' ')}... (${words.length} words)`);
console.log(`Pubkey: ${pk}`);
console.log(`Mints: ${mintUrls.length}`);
for (const [mintUrl, proofs] of Object.entries(proofsByMint)) {
  const total = proofs.reduce((s, p) => s + p.amount, 0);
  console.log(`  ${mintUrl}: ${proofs.length} proofs, ${total} sats`);
  for (const [keysetId, counter] of Object.entries(counters[mintUrl] || {})) {
    console.log(`    keyset ${keysetId}: counter=${counter}`);
  }
}
console.log(`\nTo use: rebuild the app and the migration pipeline will pick up this data.`);
