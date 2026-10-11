import { ACCOUNTS, PHRASE, reduxPersistRow } from './format';
import type { ReleaseFixture } from './format';

const A0 = ACCOUNTS[0];
// The mint the old app gave a profile it made on demand: helper/redux/cashu/helpers.ts:5@a09fe2d54.
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
 * One profile as `handleComplete` stored it: app/onboard/animate.tsx:125-138@a09fe2d54
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
    created_at: 1750150000,
    profileEvent: JSON.stringify({
      kind: 0,
      created_at: 1750150000,
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
 * E6: 0.0.22 to 0.0.40. The whole install is one redux-persist row, `persist:SOVRAN`, at
 * version 120 with no whitelist (helper/redux/store/index.ts:353-359@a09fe2d54), and nothing
 * else: no other AsyncStorage key and no SecureStore at this commit or at 0.0.40
 * (5697ea86d3). The reducers are the seven of helper/redux/store/reducer.ts:16-24@a09fe2d54.
 *
 * Changed from E5 (d4aa2a883, version 91): migration 101 recomputes every profile's `nut13`
 * from its position in `profiles`, migration 120 removes duplicate proofs, and adding a proof
 * removes exact duplicates instead of proofs with the same secret
 * (helper/redux/cashu/reducer.ts:124-142). The shapes written by onboarding and by a receive
 * are the same.
 *
 * Later builds of this epoch kept the key, the version and the place of the phrase and the
 * proofs, and changed defaults around them. By 0.0.40 (5697ea86d3) a new install also wrote
 * `settings.experimental: false` and `termsAccepted: null` before acceptance, a default
 * `pricelist.usd.btc`, empty `audits`, `info`, `keys` and `keysets` in the cashu slice, and
 * `proofs: {}` instead of `[]` for a profile made on demand
 * (helper/redux/cashu/helpers.ts@5697ea86d3). The builds of 0.0.26 and 0.0.27 (dffd783596,
 * ff8f5bbe5a) carried only migration 120, so a row they upgraded from an older version says
 * 120 without having run migrations 72 to 101.
 *
 * `nostr.search` is cut to one entry; the old app seeded three long ones
 * (helper/redux/nostr/reducer.ts:20-84@a09fe2d54) and merged every profile it looked up.
 * The key and version were checked at each store build of 0.0.22 to 0.0.40.
 */
export const fixture: ReleaseFixture = {
  epoch: 'E6',
  versions: [
    '0.0.22',
    '0.0.24',
    '0.0.25',
    '0.0.26',
    '0.0.27',
    '0.0.28',
    '0.0.29',
    '0.0.30',
    '0.0.32',
    '0.0.33',
    '0.0.34',
    '0.0.35',
    '0.0.37',
    '0.0.38',
    '0.0.40',
  ],
  commit: 'a09fe2d54',
  surface:
    'Redux row at version 120: nut13 recomputed from the profile position, duplicate proofs removed',
  asyncStorage: {
    // helper/redux/store/index.ts:353-359@a09fe2d54
    'persist:SOVRAN': reduxPersistRow(120, {
      // helper/redux/settings/reducer.ts:10-17@a09fe2d54; terms at :48-58, written from
      // app/(drawer)/(tabs)/index.tsx:210-215; display_btc from components/layout/PrimaryBalance.tsx:35.
      settings: {
        settings: {
          lang: 'en',
          theme: 'dark',
          display_btc: 1,
          passcode: '',
          termsAccepted: { termsAccepted: true, date: '2025-06-17T10:00:00.000Z' },
        },
      },
      // helper/redux/cashu/reducer.ts:24-35@a09fe2d54 (one entry per nostr profile position).
      cashu: {
        profiles: [
          {
            // app/onboard/animate.tsx:439-440@a09fe2d54
            selectedMint: MINT,
            mints: [MINT],
            // APPEND_PROOFS_V2, helper/redux/cashu/reducer.ts:124-142@a09fe2d54
            proofs: { [MINT]: PROOFS },
            // INCREASE_COUNTER_V2 starts at 1: helper/redux/cashu/reducer.ts:195-202@a09fe2d54
            counters: { [MINT]: { [KEYSET]: 6 } },
            keysets: {},
            transactions: [
              // helper/cashu/pay.ts:608-630@a09fe2d54
              {
                amount: 21,
                date: '2025-06-17T10:05:00.000Z',
                type: 'ecash',
                token: TOKEN,
                transactionType: 'receive',
                unit: 'sat',
                mintUrl: MINT,
                paid: true,
                counter: 1,
              },
              // helper/cashu/pay.ts:312-325@a09fe2d54; `paid` set by
              // app/lightningReceiveConfirmation.tsx:401-410@a09fe2d54
              {
                request: INVOICE,
                amount: 21,
                mintQuote: {
                  quote: 'fixture-mint-quote-1',
                  request: INVOICE,
                  state: 'UNPAID',
                  expiry: 1750154400,
                },
                date: '2025-06-17T10:10:00.000Z',
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
        // SET_KEYSETS, SET_KEYS, SET_INFO, SET_AUDIT: helper/redux/cashu/reducer.ts:60-71@a09fe2d54,
        // written by helper/cashu/mint.ts:14-25 and helper/cashu/wallet.ts:78-82.
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
        // The audit itself came from the Sovran API and is not in the source.
        audits: { [MINT]: { lastFetched: 1750150000000 } },
      },
      // helper/redux/bitrefill/reducer.ts:4-6@a09fe2d54
      bitrefill: { events: [] },
      // helper/redux/pricelist/reducer.ts:7-13@a09fe2d54
      pricelist: { usd: { btc: 104250.5 } },
      // helper/redux/lnvpn/reducer.ts:3-5@a09fe2d54
      vpns: { vpns: [] },
      // helper/redux/esim/reducer.ts:3-5@a09fe2d54
      esim: { esims: [] },
      // helper/redux/nostr/reducer.ts:16-91@a09fe2d54; profiles and currentProfile set by
      // app/onboard/animate.tsx:423-424@a09fe2d54.
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
