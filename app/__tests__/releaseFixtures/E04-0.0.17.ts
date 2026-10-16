import { ACCOUNTS, PHRASE, reduxPersistRow } from './format';
import type { ReleaseFixture } from './format';

const A0 = ACCOUNTS[0];
// The mint the old app gave a profile it made on demand: helper/redux/cashu/helpers.ts:5@47dda63e7.
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
 * One profile as `handleComplete` stored it: app/onboard/animate.tsx:125-138@47dda63e7
 * over what `getProfile` returned (app/onboard/components/fetchAccountData.tsx:45 and :27).
 * Its key is NIP-06 `m/44'/1237'/0'/0/0` (`nip06.accountFromSeedWords(mnemonic, undefined, 0)`,
 * fetchAccountData.tsx:31), so it is ACCOUNTS[0]. `nut13` is the 24 words made from the child
 * key at `m/44'/129372'/0'/<profile position>'/0/0` (animate.tsx:120-123), which for position 0
 * is ACCOUNTS[0].cashuMnemonic.
 */
const PROFILE = {
  // NDK `fetchProfile()` result.
  profile: {
    name: 'fixture',
    image: PICTURE,
    created_at: 1747990000,
    profileEvent: JSON.stringify({
      kind: 0,
      created_at: 1747990000,
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
 * E4: 0.0.13 (its last build), 0.0.15 to 0.0.18 and 0.0.20. The whole install is one
 * redux-persist row, `persist:SOVRAN`, at version 74 with no whitelist
 * (helper/redux/store/index.ts:274-280@47dda63e7), and nothing else: no other AsyncStorage
 * key and no SecureStore.
 *
 * Changed from E3 (26162bd91, version 72): the nostr slice gains `contacts`, settings gain
 * `passcode`, and migration 74 leaves the state as it is. The cashu slice, the profile written
 * by onboarding and the wallet seed (`nut13`, helper/cashu/wallet.ts:43-47) are the same.
 *
 * Builds in this epoch that differ from this commit:
 * - 4fb2b47ce1 (0.0.13 build 2025-05-22, 0.0.15, 0.0.16) is version 73 with these reducers.
 *   Its migration 73 called lodash/fp `_.set(state, ['nostr', 'contacts'], [])`, arguments in
 *   the wrong order, which returns an array in place of the state; an install upgraded by
 *   that build restarted from the initial state. A row it wrote has this shape.
 * - 54d601669e (a 0.0.18 build and 0.0.20) is still version 74 and already caches mint keys
 *   under `cashu.keys` and drops a proof whose secret is held, as E5 does.
 *
 * `nostr.search` is cut to one entry; the old app seeded three long ones
 * (helper/redux/nostr/reducer.ts:20-84@47dda63e7) and merged every profile it looked up.
 */
export const fixture: ReleaseFixture = {
  epoch: 'E4',
  versions: ['0.0.13', '0.0.15', '0.0.16', '0.0.17', '0.0.18', '0.0.20'],
  commit: '47dda63e7',
  surface: 'Redux row at version 74: contacts in the nostr slice, a passcode setting',
  asyncStorage: {
    // helper/redux/store/index.ts:274-280@47dda63e7
    'persist:SOVRAN': reduxPersistRow(74, {
      // helper/redux/settings/reducer.ts:10-17@47dda63e7; terms at :48-58, written from
      // app/(drawer)/(tabs)/index.tsx:115-120; display_btc (default 1) from
      // components/layout/PrimaryBalance.tsx:42.
      settings: {
        settings: {
          lang: 'en',
          theme: 'dark',
          display_btc: 2,
          passcode: '',
          termsAccepted: { termsAccepted: true, date: '2025-05-23T10:00:00.000Z' },
        },
      },
      // helper/redux/cashu/reducer.ts:22-33@47dda63e7 (one entry per nostr profile position).
      cashu: {
        profiles: [
          {
            // app/onboard/animate.tsx:439-440@47dda63e7
            selectedMint: MINT,
            mints: [MINT],
            // APPEND_PROOFS_V2, helper/redux/cashu/reducer.ts:114-121@47dda63e7
            proofs: { [MINT]: PROOFS },
            // INCREASE_COUNTER_V2 starts at 1: helper/redux/cashu/reducer.ts:156-163@47dda63e7
            counters: { [MINT]: { [KEYSET]: 6 } },
            keysets: {},
            transactions: [
              // helper/cashu/pay.ts:511-536@47dda63e7
              {
                amount: 21,
                date: '2025-05-23T10:05:00.000Z',
                type: 'ecash',
                token: TOKEN,
                transactionType: 'receive',
                unit: 'sat',
                mintUrl: MINT,
                paid: true,
                counter: 1,
              },
              // helper/cashu/pay.ts:253-265@47dda63e7; `paid` set by
              // app/lightningReceiveConfirmation.tsx:123-132@47dda63e7
              {
                request: INVOICE,
                amount: 21,
                mintQuote: {
                  quote: 'fixture-mint-quote-1',
                  request: INVOICE,
                  state: 'UNPAID',
                  expiry: 1747994400,
                },
                date: '2025-05-23T10:10:00.000Z',
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
        // SET_KEYSETS, SET_INFO: helper/redux/cashu/reducer.ts:58-62@47dda63e7, written by
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
      // helper/redux/bitrefill/reducer.ts:4-6@47dda63e7
      bitrefill: { events: [] },
      // helper/redux/pricelist/reducer.ts:7-13@47dda63e7
      pricelist: { usd: { btc: 104250.5 } },
      // helper/redux/lnvpn/reducer.ts:3-5@47dda63e7
      vpns: { vpns: [] },
      // helper/redux/esim/reducer.ts:3-5@47dda63e7
      esim: { esims: [] },
      // helper/redux/nostr/reducer.ts:16-91@47dda63e7; profiles and currentProfile set by
      // app/onboard/animate.tsx:423-424@47dda63e7.
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
