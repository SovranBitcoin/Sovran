import { ACCOUNTS, PHRASE, reduxPersistRow } from './format';
import type { ReleaseFixture } from './format';

const A0 = ACCOUNTS[0];
// The mint the old app gave a profile it made on demand: helper/redux/cashu/helpers.ts:5@7327ed3b6.
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
 * One profile as `handleComplete` stored it: app/onboard/animate.tsx:117-128@7327ed3b6
 * over what `getProfile` returned (app/onboard/components/fetchAccountData.tsx:45 and :27).
 * Its key is NIP-06 `m/44'/1237'/0'/0/0` (`nip06.accountFromSeedWords(mnemonic, undefined, 0)`,
 * fetchAccountData.tsx:31), so it is ACCOUNTS[0]. There is no `nut13` yet: the wallet seed is
 * the raw 32-byte child key at `m/44'/129372'/0'/<profile id>'/0/0`, derived on each use
 * (helper/cashu/wallet.ts:36-41@7327ed3b6).
 */
const PROFILE = {
  // NDK `fetchProfile()` result.
  profile: {
    name: 'fixture',
    image: PICTURE,
    created_at: 1746180000,
    profileEvent: JSON.stringify({
      kind: 0,
      created_at: 1746180000,
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
 * E2: later 0.0.1 and 0.0.2 builds, 0.0.11 and 0.0.12. The whole install is one
 * redux-persist row, `persist:SOVRAN`, at version 40 with no whitelist
 * (helper/redux/store/index.ts:239-245@7327ed3b6), and nothing else: no other AsyncStorage
 * key and no SecureStore. Every store build from d46779255f (2025-04-27) to e8917dbfdb
 * (2025-05-09) has this key and version.
 *
 * Changed from E1 (957eed9ea, version 30): migration 37 seeds `nostr.search`, and migration
 * 40 rewrites every transaction (amount as a number, `note` to `memo`, `proofs` grouped as
 * `keep`, `send` and `change`, a Lightning receive given a `mintQuote`). A new transaction is
 * written in that form by helper/cashu/pay.ts. A new install starts with no mint and
 * onboarding adds the chosen one (E1 started every profile on the Minibits mint), and
 * counters start at 1, not 0. Three 0.0.2 builds (ae08461e89, 0fa1e397b1, ee709811c5) are
 * version 37: this row before migration 40.
 *
 * `nostr.search` holds the one seeded entry, cut short
 * (helper/redux/nostr/reducer.ts:16-34@7327ed3b6).
 */
export const fixture: ReleaseFixture = {
  epoch: 'E2',
  versions: ['0.0.1', '0.0.2', '0.0.11', '0.0.12'],
  commit: '7327ed3b6',
  surface: 'Redux row at version 40: transactions rewritten, wallet seed is the raw child key',
  asyncStorage: {
    // helper/redux/store/index.ts:239-245@7327ed3b6
    'persist:SOVRAN': reduxPersistRow(40, {
      // helper/redux/settings/reducer.ts:3-9@7327ed3b6; terms at :40-50, written from
      // app/(drawer)/(tabs)/index.tsx:101-106; display_btc (default 1) from
      // components/layout/PrimaryBalance.tsx:42.
      settings: {
        settings: {
          lang: 'en',
          theme: 'dark',
          display_btc: 2,
          termsAccepted: { termsAccepted: true, date: '2025-05-02T10:00:00.000Z' },
        },
      },
      // helper/redux/cashu/reducer.ts:22-33@7327ed3b6 (one entry per nostr profile position).
      cashu: {
        profiles: [
          {
            // app/onboard/animate.tsx:413-414@7327ed3b6
            selectedMint: MINT,
            mints: [MINT],
            // APPEND_PROOFS_V2, helper/redux/cashu/reducer.ts:114-121@7327ed3b6
            proofs: { [MINT]: PROOFS },
            // INCREASE_COUNTER_V2 starts at 1: helper/redux/cashu/reducer.ts:151-158@7327ed3b6
            counters: { [MINT]: { [KEYSET]: 6 } },
            keysets: {},
            transactions: [
              // helper/cashu/pay.ts:502-527@7327ed3b6
              {
                amount: 21,
                date: '2025-05-02T10:05:00.000Z',
                type: 'ecash',
                token: TOKEN,
                transactionType: 'receive',
                unit: 'sat',
                mintUrl: MINT,
                paid: true,
                counter: 1,
                proofs: { keep: PROOFS.slice(0, 3) },
              },
              // helper/cashu/pay.ts:251-263@7327ed3b6; `paid` set by
              // app/lightningReceiveConfirmation.tsx:123-132@7327ed3b6
              {
                request: INVOICE,
                amount: 21,
                mintQuote: {
                  quote: 'fixture-mint-quote-1',
                  request: INVOICE,
                  state: 'UNPAID',
                  expiry: 1746184400,
                },
                date: '2025-05-02T10:10:00.000Z',
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
        // SET_KEYSETS, SET_INFO: helper/redux/cashu/reducer.ts:58-62@7327ed3b6, written by
        // helper/cashu/mint.ts:14-22 and helper/cashu/keys.ts:14-24, which stored the answer of
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
      // helper/redux/bitrefill/reducer.ts:4-6@7327ed3b6
      bitrefill: { events: [] },
      // helper/redux/pricelist/reducer.ts:7-13@7327ed3b6
      pricelist: { usd: { btc: 104250.5 } },
      // helper/redux/lnvpn/reducer.ts:3-5@7327ed3b6
      vpns: { vpns: [] },
      // helper/redux/esim/reducer.ts:3-5@7327ed3b6
      esim: { esims: [] },
      // helper/redux/nostr/reducer.ts:12-40@7327ed3b6; profiles and currentProfile set by
      // app/onboard/animate.tsx:397-398@7327ed3b6.
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
