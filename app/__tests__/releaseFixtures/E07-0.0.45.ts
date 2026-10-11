import { ACCOUNTS, PHRASE, reduxPersistRow, zustandRow } from './format';
import type { ReleaseFixture } from './format';

const A0 = ACCOUNTS[0].pubkey;
const MINT = 'https://mint.example/Bitcoin';
const KEYSET = '009a1f293253e41e';
/** `settings-store` holds the name of a background image theme: stores/settingsStore.ts:56@bab1c891f. */
const THEME = 'deepocean';

/**
 * The root extended keys of PHRASE, as redux migration 25 and the redux-era
 * onboarding stored them (`HDKey.fromMasterSeed(mnemonicToSeedSync(phrase))`):
 * redux/store/index.ts:70@bab1c891f. Derived with @scure/bip32, outside the app.
 */
const ROOT = {
  xpub: 'xpub661MyMwAqRbcG86irpRUgrk1Pt3CxrgzWBPBjkD87zPrQjEtGsjDekWJHNcUo9wXVGJg27JXDN98rZJxgBMn77WxCLPYDvhQTNUU4bFmrVq',
  xpriv:
    'xprv9s21ZrQH143K3e2FkntUKioGqrCiZPy98xTawMoWZersXvujjLQy6xBpS81msv7V1wGkMsQjx6jzmPn3VnjpMHB9FLY2wUxZor5BEbptqve',
};

const PROOFS = [
  {
    id: KEYSET,
    amount: 8,
    secret: '407915bc212be61a77e3e6d2aeb4c727980bda51cd06a6afc29e2861768a7837',
    C: '02bc9097997d81afb2cc7346b5e4345a9346bd2a506eb7958598a72f0cf85163ea',
  },
  {
    id: KEYSET,
    amount: 2,
    secret: 'fe15109314e61d7756b0f8ee0f23a624acaa3f4e042f61433c728c7057b931be',
    C: '029e8e5050b890a7d6c0968db16bc1d5d5fa040ea1de284f6ec69d61299f671059',
  },
];

/**
 * E7: 0.0.45, at bab1c891f. The first release with Coco and zustand. One
 * account, no account list: the three zustand stores are under their bare
 * keys at version 0 (none declared a version). Redux migration 151 copied the
 * phrase to SecureStore and 152 copied the settings to `settings-store`; both
 * left the redux row as it was, and it is still written on every launch at
 * version 251. Coco imported the redux mints, proofs and counters into
 * `coco.db` and left them in the row too.
 *
 * 0.0.45 build 25 was made from 4ef992d27e, which has this surface. 0.0.45
 * build 1 (ca5fee2493) also wrote `audit-mint-store`, `kym-mint-store` and
 * `routstr-store` as E8 has them, with these settings.
 */
export const fixture: ReleaseFixture = {
  epoch: 'E7',
  versions: ['0.0.45'],
  commit: 'bab1c891f',
  surface:
    'Redux version 251 moves the phrase to SecureStore and settings to zustand; bare mint, settings and price stores; Coco coco.db',
  asyncStorage: {
    // redux/store/index.ts:559@bab1c891f: key `SOVRAN`, version 251 (:562), no whitelist.
    // redux/store/reducer.ts:14@bab1c891f: the three reducers left.
    'persist:SOVRAN': reduxPersistRow(251, {
      // redux/settings/reducer.ts:18@bab1c891f. Migration 152 copied these to
      // `settings-store` and left them here (redux/store/index.ts:531@bab1c891f).
      settings: {
        settings: {
          lang: 'en',
          theme: 'dark',
          display_btc: 3,
          passcode: '',
          experimental: false,
          termsAccepted: { termsAccepted: true, date: '2025-06-02T09:30:00.000Z' },
        },
      },
      // redux/cashu/types.ts:35@bab1c891f. helper/coco/migration.ts:17@bab1c891f
      // copied mints, proofs and counters into coco.db and left them here.
      cashu: {
        profiles: [
          {
            selectedMint: MINT,
            mints: [MINT],
            proofs: { [MINT]: PROOFS },
            counters: { [MINT]: { [KEYSET]: 14 } },
            keysets: {},
            transactions: [
              {
                amount: 10,
                date: '2025-06-03T12:00:00.000Z',
                type: 'ecash',
                transactionType: 'receive',
                unit: 'sat',
                mintUrl: MINT,
                paid: true,
                token: 'cashuBfixture',
                proofs: { keep: PROOFS },
              },
            ],
          },
        ],
        audits: {},
        info: {},
        keys: {},
        keysets: { [MINT]: [{ id: KEYSET, unit: 'sat', active: true }] },
        // Written by migration 150: redux/store/index.ts:477@bab1c891f.
        allocation: { sat: { [MINT]: 10000 } },
      },
      // redux/nostr/reducer.ts:81@bab1c891f, profile :65. The profile is what
      // the redux-era onboarding stored: app/onboard/animate.tsx:125@a09fe2d54.
      // Migration 151 copied the phrase to SecureStore and left it here:
      // redux/store/index.ts:479@bab1c891f.
      nostr: {
        currentProfile: { id: 0 },
        search: [
          {
            pubkey: ACCOUNTS[2].pubkey,
            profile: {
              created_at: 1_724_764_804,
              profileEvent: '',
              lud16: 'fixture@example.com',
              website: 'https://example.com',
              name: 'searched',
              image: '',
              displayName: 'Searched Person',
              about: 'A profile the search screen kept',
              npub: ACCOUNTS[2].npub,
            },
          },
        ],
        profiles: [
          {
            id: 0,
            pubkey: A0,
            profile: {
              created_at: 1_748_856_600,
              profileEvent: '',
              name: 'fixture',
              picture: '',
              image: '',
            },
            npub: ACCOUNTS[0].npub,
            nsec: ACCOUNTS[0].nsec,
            mints: [MINT],
            mnemonic: PHRASE,
            picture: '',
            root: ROOT,
            nut13: ACCOUNTS[0].cashuMnemonic,
          },
        ],
        // A received direct message, decrypted: :55, added by the case at :207.
        messages: {
          loaded_messages: [],
          [A0]: [
            {
              sender: ACCOUNTS[1].pubkey,
              receiver: A0,
              content: 'See you at the meetup',
              created_at: 1_749_000_000,
              id: 'd'.repeat(64),
              sig: 'a'.repeat(128),
            },
          ],
        },
        follows: {},
        // :42, added by the case at :242.
        contacts: [
          {
            pubkey: ACCOUNTS[1].pubkey,
            profile: {
              pubkey: ACCOUNTS[1].pubkey,
              name: 'contact',
              about: '',
              lud16: 'contact@example.com',
              nip05: '',
              picture: '',
              displayName: 'A Contact',
              display_name: 'A Contact',
              website: '',
              banner: '',
            },
          },
        ],
      },
    }),
    // stores/settingsStore.ts:200@bab1c891f, partialize :203. No version.
    'settings-store': zustandRow(0, {
      theme: THEME,
      language: 'en',
      displayBtc: 3,
      experimental: false,
      // components/blocks/AppGate.tsx:25@bab1c891f: `new Date().toISOString()`.
      termsAccepted: { termsAccepted: true, date: '2025-06-02T09:30:00.000Z' },
    }),
    // stores/mintStore.ts:103@bab1c891f, partialize :106. Keyed by the hex public
    // key: components/blocks/WalletHeader.tsx:66@bab1c891f.
    'mint-store': zustandRow(0, { selectedMints: { [A0]: MINT } }),
    // stores/pricelistStore.ts:137@bab1c891f, partialize :140, shape :5.
    'pricelist-store': zustandRow(0, {
      // Only the dollar price was fetched: stores/pricelistStore.ts:56@bab1c891f.
      pricelist: { usd: { btc: 97_250 } },
      lastUpdated: 1760999600000,
    }),
  },
  // helper/secureStorage.ts:8@bab1c891f: the one key, the bare phrase (:37).
  secureStore: { user_mnemonic: PHRASE },
  // helper/coco/manager.ts:84@bab1c891f. No Nostr cache database yet.
  sqliteDatabases: ['coco.db'],
  survives: {
    phrase: PHRASE,
    activeAccountIndex: 0,
    accounts: [{ accountIndex: 0, pubkey: A0 }],
    facts: [
      {
        what: 'the accepted terms',
        store: 'settings-store',
        path: ['termsAccepted'],
        equals: { termsAccepted: true, date: '2025-06-02T09:30:00.000Z' },
      },
      {
        what: 'the wallpaper theme',
        store: 'theme-store',
        accountIndex: 0,
        path: ['unitWallpapers', 'sat'],
        equals: THEME,
      },
      {
        what: 'the selected mint',
        store: 'mint-store',
        accountIndex: 0,
        path: ['selectedMint'],
        equals: MINT,
      },
      {
        what: 'the cached price',
        store: 'pricelist-store',
        path: ['pricelist', 'usd', 'btc'],
        equals: 97_250,
      },
    ],
    keptAsyncStorage: ['persist:SOVRAN'],
    keptSecureStore: ['user_mnemonic'],
    // The row still holds the proofs Coco copied out of it (the two in PROOFS).
    reduxEcash: [{ mintUrl: MINT, amount: 10 }],
  },
  defaultRows: [],
  knownGaps: [
    {
      what: 'the wallpaper theme',
      followUp: 'accepted',
      why: 'Theme choices made before theme-store version 2 are reset on purpose; with no account list yet, the settings theme is dropped without being moved.',
    },
  ],
};
