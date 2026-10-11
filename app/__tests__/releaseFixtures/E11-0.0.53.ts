import { ACCOUNTS, PHRASE, reduxPersistRow, zustandRow } from './format';
import type { ReleaseFixture } from './format';

const A0 = ACCOUNTS[0].pubkey;
const MINT = 'https://mint.example/Bitcoin';
/** The cache key `normalizeUrl` made of MINT: stores/auditMintStore.ts:9@99eb79aaa. */
const MINT_CACHE_KEY = 'mint.example/Bitcoin';
const KEYSET = '009a1f293253e41e';
/** `settings-store` holds the name of a background image theme: config/backgroundImageThemes.ts:59@99eb79aaa. */
const THEME = 'deepocean';

/**
 * The root extended keys of PHRASE, as redux migration 25 and the redux-era
 * onboarding stored them (`HDKey.fromMasterSeed(mnemonicToSeedSync(phrase))`):
 * redux/store/index.ts:74@99eb79aaa. Derived with @scure/bip32, outside the app.
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

const SESSION_MESSAGES = [
  {
    id: 'msg-1765706400000',
    role: 'user',
    content: 'What is ecash?',
    timestamp: 1_765_706_400_000,
  },
  {
    id: 'msg-1765706405000',
    role: 'assistant',
    content: 'Ecash is a bearer token a mint signs blind.',
    timestamp: 1_765_706_405_000,
  },
];

const SCAN = {
  id: 'scan-1765706500000-k3j2h1g0f',
  raw: 'lightning:lnbc80n1fixture',
  processed: 'lnbc80n1fixture',
  type: 'lightning',
  source: 'qr',
  scannedAt: 1_765_706_500_000,
  transactionId: 'tx-melt-1',
};

/**
 * E11: 0.0.53 to 0.0.56 and the first 0.0.57 build, at 99eb79aaa. One account,
 * no account list: every zustand store is under its bare key at version 0 (no
 * store declared a version), the phrase is in SecureStore, and the redux row
 * is still written on every launch at version 251 with what the redux era
 * left in it. Scan history gained `transactionId` at this epoch.
 *
 * 0.0.56 builds 31 to 43 and 0.0.57 build 44 (db56061ec6) wrote this surface
 * and, under bare keys as well, `mint-distribution-store`,
 * `search-history-store` and `swap-transactions-store`, with three more
 * settings fields (stores/settingsStore.ts:347@db56061ec6). Those rows are not
 * in this fixture. 0.0.57 builds 45 and 47 (2e780f69e5) have the account list
 * and belong to E12.
 */
export const fixture: ReleaseFixture = {
  epoch: 'E11',
  versions: ['0.0.53', '0.0.54', '0.0.55', '0.0.56', '0.0.57'],
  commit: '99eb79aaa',
  surface: 'Scan history entries carry the transaction they led to',
  asyncStorage: {
    // redux/store/index.ts:589@99eb79aaa: key `SOVRAN`, version 251, no whitelist.
    // redux/store/reducer.ts:24@99eb79aaa: the three reducers left.
    'persist:SOVRAN': reduxPersistRow(251, {
      // redux/settings/reducer.ts:19@99eb79aaa. Migration 152 copied these to
      // `settings-store` and left them here (redux/store/index.ts:560@99eb79aaa).
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
      // redux/cashu/types.ts:35@99eb79aaa. helper/coco/migration.ts:19@99eb79aaa
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
        // Written by migration 150: redux/store/index.ts:504@99eb79aaa.
        allocation: { sat: { [MINT]: 10000 } },
      },
      // redux/nostr/reducer.ts:22@99eb79aaa (the reducer keeps whatever it
      // loads: :82). The profile is what the redux-era onboarding stored:
      // app/onboard/animate.tsx:125@a09fe2d54. Migration 151 copied the phrase
      // to SecureStore and left it here: redux/store/index.ts:506@99eb79aaa.
      nostr: {
        currentProfile: { id: 0 },
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
        messages: { loaded_messages: [] },
        follows: {},
      },
    }),
    // stores/settingsStore.ts:239@99eb79aaa, partialize :242. No version.
    'settings-store': zustandRow(0, {
      theme: THEME,
      language: 'en',
      displayBtc: 3,
      displayCurrency: 'gbp',
      experimental: false,
      // components/blocks/AppGate.tsx:24@99eb79aaa: `new Date().toISOString()`.
      termsAccepted: { termsAccepted: true, date: '2025-06-02T09:30:00.000Z' },
      quickAccessP2PK: true,
      sendLocationEnabled: true,
    }),
    // stores/mintStore.ts:103@99eb79aaa, partialize :106. Keyed by the hex
    // public key: helper/coco/CocoProvider.tsx:74@99eb79aaa.
    'mint-store': zustandRow(0, { selectedMints: { [A0]: MINT } }),
    // stores/pricelistStore.ts:141@99eb79aaa, partialize :144.
    'pricelist-store': zustandRow(0, {
      pricelist: { usd: { btc: 97_250 }, eur: { btc: 92_100 }, gbp: { btc: 76_400 } },
      lastUpdated: 1_765_706_000_000,
    }),
    // stores/routstrStore.ts:392@99eb79aaa, partialize :395.
    'routstr-store': zustandRow(0, {
      apiKey: 'sk-fixture-routstr-key',
      balance: 21_000,
      conversationHistory: SESSION_MESSAGES,
      selectedModel: 'fixture/model-1',
      sessions: [
        // stores/routstrStore.ts:266@99eb79aaa.
        {
          id: 'session-1765706400000',
          title: 'What is ecash?',
          createdAt: 1_765_706_400_000,
          messages: SESSION_MESSAGES,
        },
      ],
      currentSessionId: 'session-1765706400000',
    }),
    // stores/scanHistoryStore.ts:194@99eb79aaa. No partialize: the whole state
    // (:40) without its functions. Entry shape :23, `transactionId` :37.
    'scan-history-store': zustandRow(0, { entries: [SCAN] }),
    // stores/transactionLocationStore.ts:91@99eb79aaa, partialize :93, shape :13.
    'transaction-location-store': zustandRow(0, {
      locations: {
        'tx-melt-1': { latitude: 51.5072, longitude: -0.1276, createdAt: 1_765_706_510_000 },
      },
    }),
    // stores/auditMintStore.ts:110@99eb79aaa, partialize :113, entry :27;
    // `AuditMintResponse` is helper/apiClient.ts:116@99eb79aaa.
    'audit-mint-store': zustandRow(0, {
      cache: {
        [MINT_CACHE_KEY]: {
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
            updated_at: '2025-12-14T09:00:00.000Z',
            next_update: '2025-12-14T10:00:00.000Z',
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
                created_at: '2025-12-14T08:00:00.000Z',
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
          timestamp: 1_765_706_100_000,
        },
      },
    }),
    // stores/kymMintStore.ts:109@99eb79aaa, partialize :112, entry :26;
    // `MintRecommendation` is hooks/coco/useKYMMints.ts:14@99eb79aaa.
    'kym-mint-store': zustandRow(0, {
      cache: {
        [MINT_CACHE_KEY]: {
          score: 4.5,
          recommendations: [
            {
              score: 5,
              comment: 'Reliable',
              pubkey: ACCOUNTS[1].pubkey,
              eventId: 'e'.repeat(64),
              created_at: 1_765_000_000,
            },
            {
              score: 4,
              comment: 'Fast',
              pubkey: ACCOUNTS[2].pubkey,
              eventId: 'f'.repeat(64),
              created_at: 1_765_100_000,
            },
          ],
          timestamp: 1_765_706_200_000,
        },
      },
    }),
    // stores/btcMapStore.ts:346@99eb79aaa, partialize :349, shapes :9 and :20.
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
        timestamp: 1_765_706_300_000,
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
          timestamp: 1_765_706_310_000,
        },
      },
    }),
  },
  // helper/secureStorage.ts:8@99eb79aaa: the one key, the bare phrase (:37).
  secureStore: { user_mnemonic: PHRASE },
  // helper/coco/manager.ts:84@99eb79aaa; providers/NostrNDKProvider.tsx:8@99eb79aaa.
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
      {
        what: 'the display currency',
        store: 'settings-store',
        path: ['displayCurrency'],
        equals: 'gbp',
      },
      {
        what: 'the P2PK shortcut setting',
        store: 'settings-store',
        path: ['quickAccessP2PK'],
        equals: true,
      },
      {
        what: 'the location stamping setting',
        store: 'settings-store',
        path: ['sendLocationEnabled'],
        equals: true,
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
        equals: 'session-1765706400000',
      },
      {
        what: 'the scan',
        store: 'scan-history-store',
        accountIndex: 0,
        path: ['entries', 0, 'raw'],
        equals: SCAN.raw,
      },
      {
        what: 'the transaction the scan led to',
        store: 'scan-history-store',
        accountIndex: 0,
        path: ['entries', 0, 'transactionId'],
        equals: SCAN.transactionId,
      },
      {
        what: 'where a payment was made',
        store: 'transaction-location-store',
        accountIndex: 0,
        path: ['locations', 'tx-melt-1'],
        equals: { latitude: 51.5072, longitude: -0.1276, createdAt: 1_765_706_510_000 },
      },
      {
        what: 'the audit counts of the mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_CACHE_KEY, 'nMints'],
        equals: 41,
      },
      {
        what: 'the review score of the mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_CACHE_KEY, 'averageScore'],
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
