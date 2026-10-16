import { ACCOUNTS, PHRASE, reduxPersistRow } from './format';
import type { ReleaseFixture } from './format';

const A0 = ACCOUNTS[0];
// The mint the old app gave a profile it made on demand: helper/redux/cashu/helpers.ts:5@26162bd91.
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
 * One profile as `handleComplete` stored it: app/onboard/animate.tsx:124-137@26162bd91
 * over what `getProfile` returned (app/onboard/components/fetchAccountData.tsx:45 and :27).
 * Its key is NIP-06 `m/44'/1237'/0'/0/0` (`nip06.accountFromSeedWords(mnemonic, undefined, 0)`,
 * fetchAccountData.tsx:31), so it is ACCOUNTS[0]. `nut13` is the 24 words made from the child
 * key at `m/44'/129372'/0'/<profile position>'/0/0` (animate.tsx:119-122), which for position 0
 * is ACCOUNTS[0].cashuMnemonic.
 */
const PROFILE = {
  // NDK `fetchProfile()` result.
  profile: {
    name: 'fixture',
    image: PICTURE,
    created_at: 1747470000,
    profileEvent: JSON.stringify({
      kind: 0,
      created_at: 1747470000,
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
  nut13: A0.cashuMnemonic,
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
 * E3: the last 0.0.12 build, 0.0.13 and the first 0.0.15 build. The whole install is one
 * redux-persist row, `persist:SOVRAN`, at version 72 with no whitelist
 * (helper/redux/store/index.ts:270-276@26162bd91), and nothing else: no other AsyncStorage
 * key and no SecureStore. The store builds at version 72 are 3bc6663dff (0.0.12, 0.0.13) and
 * dfd76b0c87 (0.0.15).
 *
 * Changed from E2 (7327ed3b6, version 40): the wallet seed is the BIP39 seed of the stored
 * `nut13` phrase (helper/cashu/wallet.ts:43-47) where E2 used the raw 32-byte child key;
 * onboarding stores `nut13` on the profile (app/onboard/animate.tsx:119-136) and migration
 * 72 adds it to a profile without one, both from the child key at
 * `m/44'/129372'/0'/<profile position>'/0/0`.
 *
 * `nostr.search` is cut to one entry; the old app seeded three long ones
 * (helper/redux/nostr/reducer.ts:18-82@26162bd91) and merged every profile it looked up.
 */
export const fixture: ReleaseFixture = {
  epoch: 'E3',
  versions: ['0.0.12', '0.0.13', '0.0.15'],
  commit: '26162bd91',
  surface: 'Redux row at version 72: a nut13 phrase on each profile becomes the wallet seed',
  asyncStorage: {
    // helper/redux/store/index.ts:270-276@26162bd91
    'persist:SOVRAN': reduxPersistRow(72, {
      // helper/redux/settings/reducer.ts:9-15@26162bd91; terms at :46-56, written from
      // app/(drawer)/(tabs)/index.tsx:104-109; display_btc (default 1) from
      // components/layout/PrimaryBalance.tsx:42.
      settings: {
        settings: {
          lang: 'en',
          theme: 'dark',
          display_btc: 2,
          termsAccepted: { termsAccepted: true, date: '2025-05-17T10:00:00.000Z' },
        },
      },
      // helper/redux/cashu/reducer.ts:22-33@26162bd91 (one entry per nostr profile position).
      cashu: {
        profiles: [
          {
            // app/onboard/animate.tsx:424-425@26162bd91
            selectedMint: MINT,
            mints: [MINT],
            // APPEND_PROOFS_V2, helper/redux/cashu/reducer.ts:114-121@26162bd91
            proofs: { [MINT]: PROOFS },
            // INCREASE_COUNTER_V2 starts at 1: helper/redux/cashu/reducer.ts:156-163@26162bd91
            counters: { [MINT]: { [KEYSET]: 6 } },
            keysets: {},
            transactions: [
              // helper/cashu/pay.ts:511-536@26162bd91
              {
                amount: 21,
                date: '2025-05-17T10:05:00.000Z',
                type: 'ecash',
                token: TOKEN,
                transactionType: 'receive',
                unit: 'sat',
                mintUrl: MINT,
                paid: true,
                counter: 1,
              },
              // helper/cashu/pay.ts:253-265@26162bd91; `paid` set by
              // app/lightningReceiveConfirmation.tsx:123-132@26162bd91
              {
                request: INVOICE,
                amount: 21,
                mintQuote: {
                  quote: 'fixture-mint-quote-1',
                  request: INVOICE,
                  state: 'UNPAID',
                  expiry: 1747474400,
                },
                date: '2025-05-17T10:10:00.000Z',
                type: 'lightning',
                paid: true,
                transactionType: 'receive',
                unit: 'sat',
                mintUrl: MINT,
                paymentRequest: 'creqAfixture-request',
                unifiedRequest: 'creqAfixture-unified',
              },
            ],
          },
        ],
        // SET_KEYSETS, SET_INFO: helper/redux/cashu/reducer.ts:58-62@26162bd91, written by
        // helper/cashu/keys.ts:20-25 and helper/cashu/mint.ts:14-22.
        keysets: { [MINT]: [{ id: KEYSET, unit: 'sat', active: true, input_fee_ppk: 0 }] },
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
      // helper/redux/bitrefill/reducer.ts:4-6@26162bd91
      bitrefill: { events: [] },
      // helper/redux/pricelist/reducer.ts:7-13@26162bd91
      pricelist: { usd: { btc: 104250.5 } },
      // helper/redux/lnvpn/reducer.ts:3-5@26162bd91
      vpns: { vpns: [] },
      // helper/redux/esim/reducer.ts:3-5@26162bd91
      esim: { esims: [] },
      // helper/redux/nostr/reducer.ts:14-88@26162bd91; profiles and currentProfile set by
      // app/onboard/animate.tsx:408-409@26162bd91.
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
