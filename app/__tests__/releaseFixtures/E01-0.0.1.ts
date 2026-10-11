import { ACCOUNTS, PHRASE, reduxPersistRow } from './format';
import type { ReleaseFixture } from './format';

const A0 = ACCOUNTS[0];
// The mint the old app gave a profile it made on demand: helper/redux/cashu/helpers.ts:5@957eed9ea.
const MINT = 'https://mint.minibits.cash/Bitcoin';
const KEYSET = '00500550f0494146';
const PICTURE = 'https://i.ibb.co/fixture/profile.webp';
const TOKEN = 'cashuBfixture-token-received';
const INVOICE = 'lnbc210n1fixtureinvoice';

// HDKey.fromMasterSeed(mnemonicToSeedSync(PHRASE)), computed outside the app's code.
const ROOT = {
  xpub: 'xpub661MyMwAqRbcG86irpRUgrk1Pt3CxrgzWBPBjkD87zPrQjEtGsjDekWJHNcUo9wXVGJg27JXDN98rZJxgBMn77WxCLPYDvhQTNUU4bFmrVq',
  xpriv:
    'xprv9s21ZrQH143K3e2FkntUKioGqrCiZPy98xTawMoWZersXvujjLQy6xBpS81msv7V1wGkMsQjx6jzmPn3VnjpMHB9FLY2wUxZor5BEbptqve',
};

/**
 * One profile as onboarding stored it: app/onboard/animate.tsx:885-901@957eed9ea (and the
 * same object as `currentProfile`, :903-919) over what `getProfile` returned (:835 and :811).
 * Its key is NIP-06 `m/44'/1237'/0'/0/0` (`nip06.accountFromSeedWords(mnemonic, undefined, 0)`,
 * animate.tsx:818), so it is ACCOUNTS[0]. There is no `nut13`: the wallet seed is the raw
 * 32-byte child key at `m/44'/129372'/0'/<profile id>'/0/0`, derived on each use
 * (helper/cashu/wallet.ts:37-42@957eed9ea).
 */
const PROFILE = {
  // NDK `fetchProfile()` result.
  profile: {
    name: 'fixture',
    image: PICTURE,
    created_at: 1745230000,
    profileEvent: JSON.stringify({
      kind: 0,
      created_at: 1745230000,
      pubkey: A0.pubkey,
      content: JSON.stringify({ name: 'fixture', picture: PICTURE }),
      tags: [
        [
          'client',
          'sovran.money',
          '31990:1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2:sovran-app',
        ],
      ],
    }),
  },
  pubkey: A0.pubkey,
  npub: A0.npub,
  nsec: A0.nsec,
  mints: [],
  mnemonic: PHRASE,
  id: 0,
  picture: PICTURE,
  root: ROOT,
};

// A proof as cashu-ts 2.2.2 `wallet.receive` and `wallet.mintProofs` returned it. Synthetic values.
const proof = (amount: number, n: number) => ({
  id: KEYSET,
  amount,
  secret: `${n}`.repeat(64),
  C: `02${`${n}`.repeat(64)}`,
});
const PROOFS = [proof(1, 1), proof(4, 2), proof(16, 3), proof(1, 4), proof(20, 5)];

/**
 * E1: 0.0.1 and the first 0.0.2 build. The whole install is one redux-persist row,
 * `persist:SOVRAN`, at version 30 with no whitelist
 * (helper/redux/store/index.ts:95-102@957eed9ea), and nothing else: no other AsyncStorage key
 * and no SecureStore. The store builds at version 30 are f1ddf02d34 to 011e1fb476
 * (2025-04-21 to 2025-04-23); the 0.0.1 builds before the repository began cannot be read.
 *
 * This is the first epoch. What later ones changed: a transaction here is written by
 * helper/cashu/ecash.ts and helper/cashu/lightning.ts with `note`, `lnurl`, `privkey`,
 * `quote`, `payment_request` and `unified_request`, and a Lightning receive keeps the amount
 * as the string the keypad produced (components/layout/CustomKeyboard.tsx:41,
 * app/currency.tsx:63). Every profile starts on the Minibits mint. Counters start at 0, and
 * minting a paid invoice uses no counter (components/cashu.ts:89).
 *
 * `nostr.search` holds the one seeded entry, cut short
 * (helper/redux/nostr/reducer.ts:16-36@957eed9ea).
 */
export const fixture: ReleaseFixture = {
  epoch: 'E1',
  versions: ['0.0.1', '0.0.2'],
  commit: '957eed9ea',
  surface: 'Redux row at version 30: the first durable state, wallet seed is the raw child key',
  asyncStorage: {
    // helper/redux/store/index.ts:95-102@957eed9ea
    'persist:SOVRAN': reduxPersistRow(30, {
      // helper/redux/settings/reducer.ts:3-9@957eed9ea; terms at :40-50, written from
      // app/(drawer)/(tabs)/index.tsx:209-214; display_btc (default 1) from
      // components/layout/PrimaryBalance.tsx:18.
      settings: {
        settings: {
          lang: 'en',
          theme: 'dark',
          display_btc: 2,
          termsAccepted: { termsAccepted: true, date: '2025-04-21T10:00:00.000Z' },
        },
      },
      // helper/redux/cashu/reducer.ts:22-33@957eed9ea (one entry per nostr profile position).
      cashu: {
        profiles: [
          {
            // Both defaults: helper/redux/cashu/reducer.ts:25-26@957eed9ea
            selectedMint: MINT,
            mints: [MINT],
            // APPEND_PROOFS_V2, helper/redux/cashu/reducer.ts:129-141@957eed9ea
            proofs: { [MINT]: PROOFS },
            // INCREASE_COUNTER_V2 starts at 0: helper/redux/cashu/reducer.ts:181-188@957eed9ea
            counters: { [MINT]: { [KEYSET]: 3 } },
            keysets: {},
            transactions: [
              // helper/cashu/ecash.ts:247-270@957eed9ea; `nostr.pubkey` was undefined for a
              // token that did not come from a contact.
              {
                amount: 21,
                date: '2025-04-21T10:05:00.000Z',
                type: 'ecash',
                token: TOKEN,
                transactionType: 'receive',
                unit: 'sat',
                mintUrl: MINT,
                paid: true,
                counter: 0,
                nostr: {},
                proofs: { keep: PROOFS.slice(0, 3) },
              },
              // helper/cashu/lightning.ts:192-217@957eed9ea; `paid` set by
              // components/cashu.ts:116-122@957eed9ea
              {
                request: INVOICE,
                quote: 'fixture-mint-quote-1',
                amount: '21',
                date: '2025-04-21T10:10:00.000Z',
                type: 'lightning',
                paid: true,
                transactionType: 'receive',
                unit: 'sat',
                isSweep: false,
                isNpubcash: false,
                mintUrl: MINT,
                payment_request: 'creqAfixture-request',
                unified_request: 'creqAfixture-unified',
              },
            ],
          },
        ],
        // SET_KEYSETS, SET_INFO: helper/redux/cashu/reducer.ts:59-71@957eed9ea, written by
        // helper/cashu/mint.ts:18-26 and helper/cashu/keys.ts:19-28, which stored the answer of
        // `mint.getKeys()` (each keyset with its public keys) under `keysets`.
        keysets: {
          [MINT]: [
            {
              id: KEYSET,
              unit: 'sat',
              keys: {
                '1': `03${'a'.repeat(64)}`,
                '2': `03${'b'.repeat(64)}`,
                '4': `03${'c'.repeat(64)}`,
              },
            },
          ],
        },
        info: {
          [MINT]: {
            name: 'Fixture mint',
            pubkey: `02${'d'.repeat(64)}`,
            version: 'Nutshell/0.16.5',
            nuts: {
              '4': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
              '5': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
            },
          },
        },
      },
      // helper/redux/bitrefill/reducer.ts:4-6@957eed9ea
      bitrefill: { events: [] },
      // helper/redux/pricelist/reducer.ts:7-13@957eed9ea
      pricelist: { usd: { btc: 104250.5 } },
      // helper/redux/lnvpn/reducer.ts:3-5@957eed9ea
      vpns: { vpns: [] },
      // helper/redux/esim/reducer.ts:3-5@957eed9ea
      esim: { esims: [] },
      // helper/redux/nostr/reducer.ts:12-42@957eed9ea; profiles and currentProfile set by
      // app/onboard/animate.tsx:885-919@957eed9ea.
      nostr: {
        currentProfile: PROFILE,
        search: [
          {
            pubkey: '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2',
            profile: {
              created_at: 1724764804,
              displayName: 'Sovran Bitcoin',
              name: 'Sovran',
              pubkey: '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2',
              npub: 'npub1ref7jqxrh0z74554y900ufajer2lh52lk0wczrdrqcm8fjmjzweqll64x3',
            },
          },
        ],
        profiles: [PROFILE],
        messages: { loaded_messages: [] },
        follows: {},
      },
    }),
  },
  secureStore: {},
  sqliteDatabases: [],
  survives: {
    phrase: PHRASE,
    activeAccountIndex: 0,
    accounts: [{ accountIndex: 0, pubkey: A0.pubkey }],
    facts: [],
    keptAsyncStorage: ['persist:SOVRAN'],
    keptSecureStore: [],
    reduxEcash: [{ mintUrl: MINT, amount: 42 }],
  },
  defaultRows: [],
  knownGaps: [],
};
