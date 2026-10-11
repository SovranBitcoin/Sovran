import { ACCOUNTS, PHRASE, reduxPersistRow, zustandRow } from './format';
import type { ReleaseFixture } from './format';

const COMMIT = '59a27ff7a';

const A0 = ACCOUNTS[0].pubkey;
const A1 = ACCOUNTS[1].pubkey;

/**
 * The key of account 1's copy of a per-account store: account 0 used the bare
 * name, every other account `<name>:profile:<account number>`
 * (helper/profileScopedStorage.ts:35@59a27ff7a).
 */
const account1 = (store: string) => `${store}:profile:1`;

const MINT = 'https://mint.minibits.cash/Bitcoin';
const MINT_KEY = 'mint.minibits.cash/Bitcoin'; // normalizeUrl, stores/auditMintStore.ts:9@59a27ff7a
const MINT_PUBKEY = '023e2d2c4f1f2ad3d5b5a5ad7a5b5d0b5f0a8b8b3e1ea1f2f8f6c5e3b6f3b7e9a1';
const SECOND_MINT = 'https://mint.coinos.io';
const T = 1_771_200_000_000; // mid February 2026, when 0.0.58 was current

const ROUTSTR_KEY = 'sk-fixture-routstr-0058';
const SESSION = {
  id: `session-${T + 1000}`,
  title: 'How do ecash mints work?',
  createdAt: T + 1000,
  messages: [
    { id: 'user-1', role: 'user', content: 'How do ecash mints work?', timestamp: T + 1001 },
    {
      id: 'assistant-1',
      role: 'assistant',
      content: 'A mint signs blinded tokens that it later redeems.',
      timestamp: T + 1002,
    },
  ],
};
const SCAN = {
  id: `scan-${T + 2000}-k3j9x2m1q`,
  raw: 'lightning:lnbc210n1fixture',
  processed: 'lnbc210n1fixture',
  type: 'lightning',
  source: 'qr',
  scannedAt: T + 2000,
  transactionId: 'melt-quote-1',
};

const REVIEWER = '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2';
const REVIEW_EVENT = '97b889880504d1b0b70277076e51156b3c8d88d27acfa86882667be654aa228d';

const SWAP_GROUP_ID = `swap-${T + 4000}-m4n5b6v7`;
const SWAP_LEG_ID = `leg-${T + 4000}-c8x9z0a1`;

/**
 * The redux row. 0.0.58 still mounted the redux store, so redux-persist kept
 * this row for an install that began before 0.0.45: every reducer of the root
 * (redux/store/reducer.ts:16@59a27ff7a), version 251
 * (redux/store/index.ts:589@59a27ff7a). The move to Coco read the proofs and
 * left them in place (helper/coco/migration.ts:122@59a27ff7a).
 */
const REDUX_ROW = reduxPersistRow(251, {
  // redux/settings/reducer.ts:18@59a27ff7a
  settings: {
    settings: {
      lang: 'en',
      theme: 'dark',
      display_btc: 3,
      passcode: '',
      experimental: false,
      termsAccepted: { termsAccepted: true, date: '2025-03-02T10:00:00.000Z' },
    },
  },
  // redux/cashu/types.ts:35@59a27ff7a
  cashu: {
    profiles: [
      {
        selectedMint: MINT,
        mints: [MINT],
        proofs: {
          [MINT]: [
            {
              id: '00500550f0494146',
              amount: 8,
              secret: 'fixture-secret-0058',
              C: '02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2',
            },
          ],
        },
        counters: { [MINT]: { '00500550f0494146': 12 } },
        keysets: {},
        transactions: [],
      },
    ],
    audits: {},
    info: {},
    keys: {},
    keysets: {},
    allocation: { sat: { [MINT]: 10000 } },
  },
  // redux/nostr/reducer.ts:22@59a27ff7a
  nostr: {
    currentProfile: { id: 0 },
    profiles: [
      {
        id: 0,
        mnemonic: PHRASE,
        pubkey: A0,
        profile: { created_at: 0, profileEvent: '', name: '', picture: '', image: '' },
        npub: ACCOUNTS[0].npub,
        nsec: ACCOUNTS[0].nsec,
        mints: [],
        picture: '',
        root: {
          xpub: 'xpub661MyMwAqRbcG86irpRUgrk1Pt3CxrgzWBPBjkD87zPrQjEtGsjDekWJHNcUo9wXVGJg27JXDN98rZJxgBMn77WxCLPYDvhQTNUU4bFmrVq',
          xpriv:
            'xprv9s21ZrQH143K3e2FkntUKioGqrCiZPy98xTawMoWZersXvujjLQy6xBpS81msv7V1wGkMsQjx6jzmPn3VnjpMHB9FLY2wUxZor5BEbptqve',
        },
        nut13: ACCOUNTS[0].cashuMnemonic,
      },
    ],
    messages: { loaded_messages: [] },
    follows: {},
  },
});

/**
 * E12: 0.0.58, and the last builds of 0.0.57 (2e780f69e5, whose stores are the
 * same files). The first release with more than one account: `profile-store`
 * lists them, account 0 stays under the bare store names and account 1 is
 * under `<name>:profile:1`. Mint distributions, search history and swaps join
 * the surface. No store declares a version, so every row carries 0.
 * SecureStore holds the phrase and nothing else. This release had no
 * "onboarding seen" setting.
 *
 * Two accounts from the phrase; account 1 is the one in use.
 */
export const fixture: ReleaseFixture = {
  epoch: 'E12',
  versions: ['0.0.57', '0.0.58'],
  commit: COMMIT,
  surface:
    'Account list; account 0 under bare keys, others under :profile:<index>; mint distributions, search history, swaps',
  asyncStorage: {
    // ── Global ───────────────────────────────────────────────────────────────
    // stores/profileStore.ts:119@59a27ff7a, partialize :121; entry :16
    'profile-store': zustandRow(0, {
      activeAccountIndex: 1,
      profiles: [
        { accountIndex: 0, pubkey: A0, addedAt: T - 40_000_000, cachedBalanceSats: 2121 },
        { accountIndex: 1, pubkey: A1, addedAt: T - 20_000_000, cachedBalanceSats: 64 },
      ],
    }),
    // stores/settingsStore.ts:344@59a27ff7a, partialize :347
    'settings-store': zustandRow(0, {
      theme: 'navy',
      language: 'en',
      displayBtc: 1,
      displayCurrency: 'gbp',
      experimental: false,
      mockMode: false,
      termsAccepted: { termsAccepted: true, date: '2025-03-02T10:00:00.000Z' },
      quickAccessP2PK: true,
      sendLocationEnabled: true,
      minTransferThreshold: 21,
      middlemanRouting: {
        maxHops: 1,
        maxFee: 3,
        minSuccessRate: 0.95,
        requireLastOk: true,
        trustMode: 'trusted_only',
      },
    }),
    // stores/pricelistStore.ts:141@59a27ff7a, partialize :144
    'pricelist-store': zustandRow(0, {
      pricelist: { usd: { btc: 94_000 }, eur: { btc: 82_500 }, gbp: { btc: 70_250 } },
      lastUpdated: T - 30_000,
    }),
    // stores/btcMapStore.ts:346@59a27ff7a, partialize :349; shapes :9, :61, :66
    'btcmap-store': zustandRow(0, {
      placesCache: {
        data: [
          {
            id: 4242,
            lat: 51.5072,
            lon: -0.1276,
            icon: 'local_cafe',
            comments: 2,
            updated_at: '2026-02-01T00:00:00Z',
          },
        ],
        timestamp: T - 3_000_000,
      },
      placeDetailsCache: {
        4242: {
          data: {
            id: 4242,
            lat: 51.5072,
            lon: -0.1276,
            icon: 'local_cafe',
            updated_at: '2026-02-01T00:00:00Z',
            name: 'Fixture Coffee',
            address: '1 Example Street, London',
            'osm:payment:lightning': 'yes',
          },
          timestamp: T - 2_900_000,
        },
      },
    }),
    // stores/auditMintStore.ts:110@59a27ff7a, partialize :113; entry :27, response helper/apiClient.ts:117
    'audit-mint-store': zustandRow(0, {
      cache: {
        [MINT_KEY]: {
          auditData: {
            id: 7,
            url: MINT,
            info: { name: 'Minibits', pubkey: MINT_PUBKEY, version: 'Nutshell/0.16.5' },
            name: 'Minibits',
            balance: 1200,
            sum_donations: 0,
            updated_at: '2026-02-20T00:00:00Z',
            next_update: '2026-02-21T00:00:00Z',
            state: 'OK',
            n_errors: 1,
            n_mints: 40,
            n_melts: 38,
            swaps: [],
          },
          mintInfo: {
            name: 'Minibits',
            pubkey: MINT_PUBKEY,
            version: 'Nutshell/0.16.5',
            description: 'Minibits mint',
            contact: [],
            nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false } },
          },
          timestamp: T - 4_000_000,
        },
      },
    }),
    // stores/kymMintStore.ts:109@59a27ff7a, partialize :112; entry :26, review hooks/coco/useKYMMints.ts:14
    'kym-mint-store': zustandRow(0, {
      cache: {
        [MINT_KEY]: {
          score: 4.5,
          recommendations: [
            {
              score: 5,
              comment: 'Reliable',
              pubkey: REVIEWER,
              eventId: REVIEW_EVENT,
              created_at: 1_770_000_000,
            },
          ],
          timestamp: T - 4_100_000,
        },
      },
    }),
    'persist:SOVRAN': REDUX_ROW,

    // ── Account 0, under the bare names ──────────────────────────────────────
    // stores/mintStore.ts:105@59a27ff7a, partialize :108; keyed by public key :7
    'mint-store': zustandRow(0, { selectedMints: { [A0]: MINT } }),
    // stores/mintDistributionStore.ts:505@59a27ff7a, partialize :507; shape :22
    'mint-distribution-store': zustandRow(0, {
      distributions: { sat: { [MINT]: 7500, [SECOND_MINT]: 2500 } },
    }),
    // stores/routstrStore.ts:394@59a27ff7a, partialize :397; session :15, message :8
    'routstr-store': zustandRow(0, {
      apiKey: ROUTSTR_KEY,
      balance: 21_000,
      conversationHistory: SESSION.messages,
      selectedModel: 'gpt-4o-mini',
      sessions: [SESSION],
      currentSessionId: SESSION.id,
    }),
    // stores/scanHistoryStore.ts:209@59a27ff7a; no partialize, so the whole state :42; entry :25
    'scan-history-store': zustandRow(0, { entries: [SCAN] }),
    // stores/searchHistoryStore.ts:136@59a27ff7a, partialize :138; entry :11
    'search-history-store': zustandRow(0, {
      recentSearches: {
        payments: [{ query: 'sovran', timestamp: T - 700_000, context: 'payments' }],
      },
    }),
    // stores/swapTransactionsStore.ts:261@59a27ff7a, partialize :263; shapes :31, :54, :65
    'swap-transactions-store': zustandRow(0, {
      groups: {
        [SWAP_GROUP_ID]: {
          id: SWAP_GROUP_ID,
          unit: 'sat',
          createdAt: T + 4000,
          title: 'Rebalance',
          state: 'finished',
          legs: [
            {
              id: SWAP_LEG_ID,
              fromMintUrl: MINT,
              toMintUrl: SECOND_MINT,
              amount: 500,
              mintQuoteId: 'swap-mint-quote-1',
              meltQuoteId: 'swap-melt-quote-1',
              meltOperationId: 'swap-melt-op-1',
              localStatus: 'done',
            },
          ],
        },
      },
      quoteIdToGroup: {
        'swap-mint-quote-1': { groupId: SWAP_GROUP_ID, legId: SWAP_LEG_ID, kind: 'mint' },
        'swap-melt-quote-1': { groupId: SWAP_GROUP_ID, legId: SWAP_LEG_ID, kind: 'melt' },
      },
    }),
    // stores/transactionLocationStore.ts:93@59a27ff7a, partialize :95; shape :15
    'transaction-location-store': zustandRow(0, {
      locations: {
        'melt-quote-1': { latitude: 51.5072, longitude: -0.1276, createdAt: T + 2100 },
      },
    }),

    // ── Account 1, the one in use, under `<name>:profile:1` ──────────────────
    [account1('mint-store')]: zustandRow(0, { selectedMints: { [A1]: SECOND_MINT } }),
    [account1('routstr-store')]: zustandRow(0, {
      apiKey: 'sk-fixture-routstr-0058-second',
      balance: 5_000,
      conversationHistory: [],
      selectedModel: null,
      sessions: [],
      currentSessionId: null,
    }),
    [account1('scan-history-store')]: zustandRow(0, {
      entries: [
        {
          id: `scan-${T + 6000}-h1j2k3l4m`,
          raw: 'cashuBfixturetoken',
          processed: 'cashuBfixturetoken',
          type: 'ecash',
          source: 'nfc',
          scannedAt: T + 6000,
        },
      ],
    }),
    [account1('search-history-store')]: zustandRow(0, {
      recentSearches: {
        payments: [{ query: 'fiatjaf', timestamp: T - 100_000, context: 'payments' }],
      },
    }),
  },
  secureStore: {
    // helper/secureStorage.ts:7@59a27ff7a: the phrase is the only key this release wrote
    user_mnemonic: PHRASE,
  },
  // helper/coco/manager.ts:55@59a27ff7a; one Nostr cache for every account,
  // providers/NostrNDKProvider.tsx:8@59a27ff7a
  sqliteDatabases: ['coco.db', 'coco-1.db', 'nostr'],
  survives: {
    phrase: PHRASE,
    activeAccountIndex: 1,
    accounts: [
      { accountIndex: 0, pubkey: A0 },
      { accountIndex: 1, pubkey: A1 },
    ],
    facts: [
      {
        what: 'the accepted terms',
        store: 'settings-store',
        path: ['termsAccepted', 'termsAccepted'],
        equals: true,
      },
      // This release had no such setting: accepting the terms was the whole of
      // onboarding (components/blocks/AppGate.tsx:24@59a27ff7a). The current build reads the
      // missing flag as "not seen", so its migration does not stamp the wallet
      // lifecycle and its gate takes the install for a reinstall.
      {
        what: 'that onboarding was seen',
        store: 'settings-store',
        path: ['hasSeenOnboarding'],
        equals: true,
      },
      {
        what: 'the display currency',
        store: 'settings-store',
        path: ['displayCurrency'],
        equals: 'gbp',
      },
      {
        what: 'the bitcoin display format',
        store: 'settings-store',
        path: ['displayBtc'],
        equals: 1,
      },
      {
        what: 'the choice to stamp sends with a location',
        store: 'settings-store',
        path: ['sendLocationEnabled'],
        equals: true,
      },
      {
        what: 'the rebalance routing limits',
        store: 'settings-store',
        path: ['middlemanRouting', 'maxHops'],
        equals: 1,
      },
      {
        what: 'the cached balance of account 0',
        store: 'profile-store',
        path: ['profiles', 0, 'cachedBalanceSats'],
        equals: 2121,
      },
      {
        what: 'the last known price',
        store: 'pricelist-store',
        path: ['pricelist', 'gbp', 'btc'],
        equals: 70_250,
      },
      {
        what: 'the review score of a mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_KEY, 'averageScore'],
        equals: 4.5,
      },
      {
        what: 'the audit result of a mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_KEY, 'nMints'],
        equals: 40,
      },
      {
        what: 'the cached map place',
        store: 'btcmap-store',
        path: ['placeDetailsCache', '4242', 'data', 'name'],
        equals: 'Fixture Coffee',
      },
      {
        what: 'the selected mint of account 0',
        store: 'mint-store',
        accountIndex: 0,
        path: ['selectedMint'],
        equals: MINT,
      },
      {
        what: 'the selected mint of account 1',
        store: 'mint-store',
        accountIndex: 1,
        path: ['selectedMint'],
        equals: SECOND_MINT,
      },
      {
        what: 'the mint split of account 0',
        store: 'mint-distribution-store',
        accountIndex: 0,
        path: ['distributions', 'sat', MINT],
        equals: 7500,
      },
      {
        what: 'the Routstr key of account 0',
        store: 'routstr-store',
        accountIndex: 0,
        path: ['apiKey'],
        equals: ROUTSTR_KEY,
      },
      {
        what: 'the Routstr balance of account 0',
        store: 'routstr-store',
        accountIndex: 0,
        path: ['balance'],
        equals: 21_000,
      },
      {
        what: 'the chat session of account 0',
        store: 'routstr-store',
        accountIndex: 0,
        path: ['sessions', 0, 'messages', 1, 'content'],
        equals: 'A mint signs blinded tokens that it later redeems.',
      },
      {
        what: 'the open chat session of account 0',
        store: 'routstr-store',
        accountIndex: 0,
        path: ['currentSessionId'],
        equals: SESSION.id,
      },
      {
        what: 'the Routstr key of account 1',
        store: 'routstr-store',
        accountIndex: 1,
        path: ['apiKey'],
        equals: 'sk-fixture-routstr-0058-second',
      },
      {
        what: 'the scan of account 0',
        store: 'scan-history-store',
        accountIndex: 0,
        path: ['entries', 0, 'raw'],
        equals: SCAN.raw,
      },
      {
        what: 'the payment a scan of account 0 led to',
        store: 'scan-history-store',
        accountIndex: 0,
        path: ['entries', 0, 'transactionId'],
        equals: 'melt-quote-1',
      },
      {
        what: 'the scan of account 1',
        store: 'scan-history-store',
        accountIndex: 1,
        path: ['entries', 0, 'raw'],
        equals: 'cashuBfixturetoken',
      },
      {
        what: 'the recent search of account 0',
        store: 'search-history-store',
        accountIndex: 0,
        path: ['recentSearches', 'payments', 0, 'query'],
        equals: 'sovran',
      },
      {
        what: 'the recent search of account 1',
        store: 'search-history-store',
        accountIndex: 1,
        path: ['recentSearches', 'payments', 0, 'query'],
        equals: 'fiatjaf',
      },
      {
        what: 'the swap of account 0',
        store: 'swap-transactions-store',
        accountIndex: 0,
        path: ['groups', SWAP_GROUP_ID, 'legs', 0, 'meltQuoteId'],
        equals: 'swap-melt-quote-1',
      },
      {
        what: 'where a payment of account 0 was made',
        store: 'transaction-location-store',
        accountIndex: 0,
        path: ['locations', 'melt-quote-1', 'latitude'],
        equals: 51.5072,
      },
    ],
    keptAsyncStorage: ['persist:SOVRAN'],
    keptSecureStore: ['user_mnemonic'],
  },
  defaultRows: [],
  knownGaps: [
    {
      what: 'that onboarding was seen',
      followUp: 'F100',
      why: 'These releases had no onboarding flag; accepting the terms was the whole of it, and this build reads the missing flag as not seen.',
    },
  ],
};
