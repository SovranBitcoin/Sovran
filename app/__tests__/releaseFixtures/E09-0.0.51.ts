import { ACCOUNTS, PHRASE, reduxPersistRow, zustandRow } from './format';
import type { ReleaseFixture } from './format';

const A0 = ACCOUNTS[0].pubkey;
const MINT = 'https://mint.example/Bitcoin';
const KEYSET = '009a1f293253e41e';
/** `settings-store` holds the name of a background image theme: config/backgroundImageThemes.ts:59@6d67b2ead. */
const THEME = 'deepocean';

/**
 * The root extended keys of PHRASE, as redux migration 25 and the redux-era
 * onboarding stored them (`HDKey.fromMasterSeed(mnemonicToSeedSync(phrase))`):
 * redux/store/index.ts:70@6d67b2ead. Derived with @scure/bip32, outside the app.
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

const SESSION_ID = 'session-1764806400000';
const SESSION_MESSAGES = [
  { id: 'msg-1764806400000', role: 'user', content: 'What is ecash?', timestamp: 1764806400000 },
  {
    id: 'msg-1764806405000',
    role: 'assistant',
    content: 'Ecash is a bearer token a mint signs blind.',
    timestamp: 1764806405000,
  },
];

/**
 * E9: 0.0.51 from build 6 on, at 6d67b2ead. One account, no account list: every
 * zustand store is under its bare key at version 0 (no store declared a
 * version), the phrase is in SecureStore, and the redux row is still written
 * on every launch at version 251 with what the redux era left in it. This
 * epoch added the BTCMap cache.
 *
 * Later 0.0.51 builds wrote more than this: builds 13 to 22 (70b705fd59 to
 * 75636dc94b) persist `quickAccessP2PK` in `settings-store`, and build 23
 * (4722cbb57b) also `sendLocationEnabled` and `transaction-location-store`.
 * Both are part of E10's surface, where they are read from.
 */
export const fixture: ReleaseFixture = {
  epoch: 'E9',
  versions: ['0.0.51'],
  commit: '6d67b2ead',
  surface: 'Adds the BTCMap cache',
  asyncStorage: {
    // redux/store/index.ts:559@6d67b2ead: key `SOVRAN`, version 251 (:562), no whitelist.
    // redux/store/reducer.ts:14@6d67b2ead: the three reducers left.
    'persist:SOVRAN': reduxPersistRow(251, {
      // redux/settings/reducer.ts:18@6d67b2ead. Migration 152 copied these to
      // `settings-store` and left them here (redux/store/index.ts:531@6d67b2ead).
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
      // redux/cashu/types.ts:35@6d67b2ead. helper/coco/migration.ts:18@6d67b2ead
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
        // Written by migration 150: redux/store/index.ts:477@6d67b2ead.
        allocation: { sat: { [MINT]: 10000 } },
      },
      // redux/nostr/reducer.ts:82@6d67b2ead, profile :66. The profile is what
      // the redux-era onboarding stored: app/onboard/animate.tsx:125@a09fe2d54.
      // Migration 151 copied the phrase to SecureStore and left it here:
      // redux/store/index.ts:479@6d67b2ead.
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
        // A received direct message, decrypted: :56, added by the case at :207.
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
        // :43, added by the case at :242.
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
    // stores/settingsStore.ts:209@6d67b2ead, partialize :212. No version.
    'settings-store': zustandRow(0, {
      theme: THEME,
      language: 'en',
      displayBtc: 3,
      displayCurrency: 'gbp',
      experimental: false,
      // components/blocks/AppGate.tsx:25@6d67b2ead: `new Date().toISOString()`.
      termsAccepted: { termsAccepted: true, date: '2025-06-02T09:30:00.000Z' },
    }),
    // stores/mintStore.ts:103@6d67b2ead, partialize :106. Keyed by the hex public
    // key: helper/coco/CocoProvider.tsx:82@6d67b2ead.
    'mint-store': zustandRow(0, { selectedMints: { [A0]: MINT } }),
    // stores/pricelistStore.ts:141@6d67b2ead, partialize :144, shape :5.
    'pricelist-store': zustandRow(0, {
      pricelist: { usd: { btc: 97_250 }, eur: { btc: 92_100 }, gbp: { btc: 76_400 } },
      lastUpdated: 1764806000000,
    }),
    // stores/routstrStore.ts:392@6d67b2ead, partialize :395, state :28.
    'routstr-store': zustandRow(0, {
      apiKey: 'sk-fixture-routstr-key',
      balance: 21_000,
      conversationHistory: SESSION_MESSAGES,
      selectedModel: 'fixture/model-1',
      sessions: [
        // stores/routstrStore.ts:266@6d67b2ead.
        {
          id: SESSION_ID,
          title: 'What is ecash?',
          createdAt: 1764806400000,
          messages: SESSION_MESSAGES,
        },
      ],
      currentSessionId: SESSION_ID,
    }),
    // stores/auditMintStore.ts:90@6d67b2ead, partialize :93, entry :7. The key is the
    // mint URL without a trailing slash (:46). `AuditMintResponse` is
    // helper/apiClient.ts:122@6d67b2ead.
    'audit-mint-store': zustandRow(0, {
      cache: {
        [MINT]: {
          auditData: {
            id: 7,
            url: MINT,
            info: {
              name: 'Fixture mint',
              pubkey: '02'.padEnd(66, 'a'),
              version: 'Nutshell/0.16.5',
            },
            name: 'Fixture mint',
            balance: 1200,
            sum_donations: 0,
            updated_at: '2025-11-29T09:00:00.000Z',
            next_update: '2025-11-29T10:00:00.000Z',
            state: 'OK',
            n_errors: 1,
            n_mints: 41,
            n_melts: 39,
            swaps: [
              {
                id: 1,
                from_id: 7,
                to_id: 9,
                from_url: MINT,
                to_url: 'https://other.mint.example',
                amount: 100,
                fee: 1,
                created_at: '2025-11-29T08:00:00.000Z',
                time_taken: 2100,
                state: 'OK',
                error: null,
              },
            ],
          },
          mintInfo: {
            name: 'Fixture mint',
            pubkey: '02'.padEnd(66, 'a'),
            version: 'Nutshell/0.16.5',
          },
          timestamp: 1764806100000,
        },
      },
    }),
    // stores/kymMintStore.ts:89@6d67b2ead, partialize :92, entry :6, key :45.
    // `MintRecommendation` is hooks/coco/useKYMMints.ts:14@6d67b2ead.
    'kym-mint-store': zustandRow(0, {
      cache: {
        [MINT]: {
          score: 4.5,
          recommendations: [
            {
              score: 5,
              comment: 'Reliable',
              pubkey: ACCOUNTS[1].pubkey,
              eventId: 'e'.repeat(64),
              created_at: 1_764_000_000,
            },
            {
              score: 4,
              comment: 'Fast',
              pubkey: ACCOUNTS[2].pubkey,
              eventId: 'f'.repeat(64),
              created_at: 1_764_100_000,
            },
          ],
          timestamp: 1764806200000,
        },
      },
    }),
    // stores/btcMapStore.ts:346@6d67b2ead, partialize :349, shapes :9 and :20.
    'btcmap-store': zustandRow(0, {
      placesCache: {
        data: [
          {
            id: 4821,
            lat: 51.5072,
            lon: -0.1276,
            icon: 'local_cafe',
            comments: 2,
            deleted_at: null,
            updated_at: '2025-11-30T10:00:00Z',
          },
        ],
        timestamp: 1764806300000,
      },
      placeDetailsCache: {
        4821: {
          data: {
            id: 4821,
            lat: 51.5072,
            lon: -0.1276,
            icon: 'local_cafe',
            updated_at: '2025-11-30T10:00:00Z',
            name: 'Fixture Cafe',
            address: '1 Example Street',
            'osm:payment:lightning': 'yes',
          },
          timestamp: 1764806310000,
        },
      },
    }),
  },
  // helper/secureStorage.ts:8@6d67b2ead: the one key, the bare phrase (:37).
  secureStore: { user_mnemonic: PHRASE },
  // helper/coco/manager.ts:83@6d67b2ead; providers/NostrNDKProvider.tsx:8@6d67b2ead.
  sqliteDatabases: ['coco.db', 'nostr'],
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
      // This release had no "onboarding seen" setting: accepting the terms was the whole of
      // it. The stamp migration takes that as seen and as a wallet made on this install.
      {
        what: 'that onboarding was seen',
        store: 'settings-store',
        path: ['hasSeenOnboarding'],
        equals: true,
      },
      {
        what: 'that no restore is needed',
        store: 'wallet-lifecycle',
        path: ['restoreStatus'],
        equals: 'not-needed',
      },
      {
        what: 'the display currency',
        store: 'settings-store',
        path: ['displayCurrency'],
        equals: 'gbp',
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
        path: ['pricelist', 'gbp', 'btc'],
        equals: 76_400,
      },
      {
        what: 'the Routstr key',
        store: 'routstr-store',
        accountIndex: 0,
        path: ['apiKey'],
        equals: 'sk-fixture-routstr-key',
      },
      {
        what: 'the Routstr balance',
        store: 'routstr-store',
        accountIndex: 0,
        path: ['balance'],
        equals: 21_000,
      },
      {
        what: 'the saved chat',
        store: 'routstr-store',
        accountIndex: 0,
        path: ['sessions', 0, 'messages', 1, 'content'],
        equals: 'Ecash is a bearer token a mint signs blind.',
      },
      {
        what: 'the open chat',
        store: 'routstr-store',
        accountIndex: 0,
        path: ['currentSessionId'],
        equals: SESSION_ID,
      },
      {
        what: 'the audit counts of the mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT, 'nMints'],
        equals: 41,
      },
      {
        what: 'the review score of the mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT, 'averageScore'],
        equals: 4.5,
      },
      {
        what: 'the cached map places',
        store: 'btcmap-store',
        path: ['placesCache', 'data', 0, 'id'],
        equals: 4821,
      },
      {
        what: 'the cached place details',
        store: 'btcmap-store',
        path: ['placeDetailsCache', '4821', 'data', 'name'],
        equals: 'Fixture Cafe',
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
