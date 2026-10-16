import { ACCOUNTS, PHRASE, reduxPersistRow } from './format';
import type { ReleaseFixture } from './format';

const A0 = ACCOUNTS[0];
// The mint the old app gave a profile it made on demand: helper/redux/cashu/helpers.ts:5@d4aa2a883.
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
 * One profile as `handleComplete` stored it: app/onboard/animate.tsx:125-138@d4aa2a883
 * over what `getProfile` returned (app/onboard/components/fetchAccountData.tsx:39 and :21).
 * Its key is NIP-06 `m/44'/1237'/0'/0/0` (`nip06.accountFromSeedWords(mnemonic, undefined, 0)`,
 * fetchAccountData.tsx:25), so it is ACCOUNTS[0]. `nut13` is the 24 words made from the child
 * key at `m/44'/129372'/0'/<profile position>'/0/0` (animate.tsx:120-123), which for position 0
 * is ACCOUNTS[0].cashuMnemonic.
 */
const PROFILE = {
  // NDK `fetchProfile()` result.
  profile: {
    name: 'fixture',
    image: PICTURE,
    created_at: 1749630000,
    profileEvent: JSON.stringify({
      kind: 0,
      created_at: 1749630000,
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
 * E5: 0.0.21. The whole install is one redux-persist row, `persist:SOVRAN`, at version 91
 * with no whitelist (helper/redux/store/index.ts:321-327@d4aa2a883), and nothing else: no
 * other AsyncStorage key and no SecureStore. The one store build of 0.0.21 (20f1bf5044) has
 * the same key and version.
 *
 * Changed from E4 (47dda63e7, version 74): migration 91 gives a profile without `nut13` one
 * made from its position in `profiles`; the cashu slice gains `keys` and `audits`
 * (helper/redux/cashu/reducer.ts:63-71); adding a proof drops one whose secret is already
 * held instead of appending (reducer.ts:124-131); a Lightning receive records `memo`; the
 * default `display_btc` is 3, not 1. The wallet takes its seed from `nut13` as before
 * (helper/cashu/wallet.ts:65-70).
 *
 * `nostr.search` is cut to one entry; the old app seeded three long ones
 * (helper/redux/nostr/reducer.ts:20-84@d4aa2a883) and merged every profile it looked up.
 * The mint audit (helper/cashu/wallet.ts:76-77@d4aa2a883) is whatever the Sovran API
 * returned, which is not in the source, so `audits` is left out.
 */
export const fixture: ReleaseFixture = {
  epoch: 'E5',
  versions: ['0.0.21'],
  commit: 'd4aa2a883',
  surface:
    'Redux row at version 91: nut13 backfilled, counters per keyset, mint keys and audits cached',
  asyncStorage: {
    // helper/redux/store/index.ts:321-327@d4aa2a883
    'persist:SOVRAN': reduxPersistRow(91, {
      // helper/redux/settings/reducer.ts:10-17@d4aa2a883; terms at :48-58, written from
      // app/(drawer)/(tabs)/index.tsx:210-215; display_btc from components/layout/PrimaryBalance.tsx:31.
      settings: {
        settings: {
          lang: 'en',
          theme: 'dark',
          display_btc: 1,
          passcode: '',
          termsAccepted: { termsAccepted: true, date: '2025-06-11T10:00:00.000Z' },
        },
      },
      // helper/redux/cashu/reducer.ts:24-35@d4aa2a883 (one entry per nostr profile position).
      cashu: {
        profiles: [
          {
            // app/onboard/animate.tsx:439-440@d4aa2a883
            selectedMint: MINT,
            mints: [MINT],
            // APPEND_PROOFS_V2, helper/redux/cashu/reducer.ts:124-131@d4aa2a883
            proofs: { [MINT]: PROOFS },
            // INCREASE_COUNTER_V2 starts at 1: helper/redux/cashu/reducer.ts:184-191@d4aa2a883
            counters: { [MINT]: { [KEYSET]: 6 } },
            keysets: {},
            transactions: [
              // helper/cashu/pay.ts:608-630@d4aa2a883
              {
                amount: 21,
                date: '2025-06-11T10:05:00.000Z',
                type: 'ecash',
                token: TOKEN,
                transactionType: 'receive',
                unit: 'sat',
                mintUrl: MINT,
                paid: true,
                counter: 1,
              },
              // helper/cashu/pay.ts:312-325@d4aa2a883; `paid` set by
              // app/lightningReceiveConfirmation.tsx:195-203@d4aa2a883
              {
                request: INVOICE,
                amount: 21,
                mintQuote: {
                  quote: 'fixture-mint-quote-1',
                  request: INVOICE,
                  state: 'UNPAID',
                  expiry: 1749634400,
                },
                date: '2025-06-11T10:10:00.000Z',
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
        // SET_KEYSETS, SET_KEYS, SET_INFO: helper/redux/cashu/reducer.ts:60-67@d4aa2a883,
        // written by helper/cashu/mint.ts:14-25.
        keysets: { [MINT]: [{ id: KEYSET, unit: 'sat', active: true, input_fee_ppk: 0 }] },
        keys: {
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
      // helper/redux/bitrefill/reducer.ts:4-6@d4aa2a883
      bitrefill: { events: [] },
      // helper/redux/pricelist/reducer.ts:7-13@d4aa2a883
      pricelist: { usd: { btc: 104250.5 } },
      // helper/redux/lnvpn/reducer.ts:3-5@d4aa2a883
      vpns: { vpns: [] },
      // helper/redux/esim/reducer.ts:3-5@d4aa2a883
      esim: { esims: [] },
      // helper/redux/nostr/reducer.ts:16-91@d4aa2a883; profiles and currentProfile set by
      // app/onboard/animate.tsx:423-424@d4aa2a883.
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
        contacts: [],
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
