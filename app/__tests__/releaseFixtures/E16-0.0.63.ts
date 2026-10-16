import { ACCOUNTS, IMPORTED, PHRASE, accountKey, reduxPersistRow, zustandRow } from './format';
import type { ReleaseFixture } from './format';

const COMMIT = '28bf7713a';

const A0 = ACCOUNTS[0].pubkey;
const A1 = ACCOUNTS[1].pubkey;
const IMP = IMPORTED.pubkey;

/**
 * The account number of the imported key: the public key modulo 2^31
 * (`pubkeyToAccountNumber`, shared/lib/nostr/keyDerivation.ts:111@28bf7713a).
 * Worked out with BigInt outside the app's code.
 */
const IMPORTED_INDEX = 112058190;

/**
 * This release tagged its key caches with a 31-multiplier string hash in base
 * 36, not the SHA-256 tag of today (`hashMnemonic`,
 * shared/lib/nostr/secureStorage.ts:279@28bf7713a). The values below are that
 * function applied to the phrase and to each account's Cashu phrase, computed
 * outside the app's code.
 */
const OLD_PHRASE_HASH = '-whkeps';
/**
 * The imported account's Cashu phrase: the child key at
 * m/44'/129372'/0'/<IMPORTED_INDEX>'/1/0 as a 24-word phrase
 * (`deriveCashuMnemonicForImported`, shared/lib/nostr/keyDerivation.ts:127@28bf7713a).
 */
const IMPORTED_CASHU_MNEMONIC =
  'mouse solar clarify divide eager jungle what roof imitate process sponsor allow situate hockey month cactus street under diary okay error predict method must';
/** The seed cache is tagged with the hash of the Cashu phrase (shared/lib/cashu/manager.ts:163@28bf7713a). */
const CASHU_SEEDS = {
  0: {
    hex: '1a1721f6118d4acf240ed1674d9f26ab3f504fe2ea9c95741f98b344eacb18421d87ad400927a43369409638272adccd538a96632c1d0858c471ba01183886f0',
    mnemonicHash: '-318eou',
  },
  1: {
    hex: '0e5512c019e7448d8bf2f0a4997aee1625986937c3e0360fe09dc2c6c9056690114245bcc1085a8741ad068b9549543ea740e8725674f4bff099f38ede95145f',
    mnemonicHash: '67u7oz',
  },
  imported: {
    hex: '734e9edbc939708db98deb5741ea03dd0a4e39018b0464573c8a9f81eac8fb0b5d25d86ba8d4476e0c117848bbbeeda4f608c7ff6c02dbaefbf9ebdbbef6bb3a',
    mnemonicHash: 'pazail',
  },
} as const;

const MINT = 'https://mint.minibits.cash/Bitcoin';
const MINT_KEY = 'mint.minibits.cash/Bitcoin'; // normalizeMintUrlKey, shared/lib/url.ts:15@28bf7713a
const SECOND_MINT = 'https://mint.coinos.io';
const IMPORTED_MINT = 'https://mint.lnvoltz.com';
const T = 1_777_000_000_000; // late April 2026, when 0.0.63 was current

const ROUTSTR_KEY = 'sk-fixture-routstr-0063';
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
      thinkingDurationSec: 2,
    },
  ],
};
const SCAN = {
  id: `scan-${T + 2000}-k3j9x2m1q`,
  raw: 'lightning:lnbc210n1fixture',
  processed: 'lnbc210n1fixture',
  type: 'lightning',
  source: 'qr',
  inputType: 'bolt11',
  scannedAt: T + 2000,
  transactionId: 'melt-quote-1',
};
const SECOND_SCAN = {
  id: `scan-${T + 2500}-a8s7d6f5g`,
  raw: ACCOUNTS[0].npub,
  processed: ACCOUNTS[0].npub,
  type: 'npub',
  source: 'paste',
  scannedAt: T + 2500,
};
const FOLLOWED = '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2';
const LIKED_EVENT = '97b889880504d1b0b70277076e51156b3c8d88d27acfa86882667be654aa228d';
const LIKE_EVENT = '5f809e1604d84c58341664d362eb15f3d32e7faf73c9b675228a1ad4250bb80f';

// The colours below are saved catalogue data, not colours this app draws with.
/* eslint-disable no-restricted-syntax */
const WALLPAPER = {
  eventId: 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00',
  themeName: 'alpine-dawn',
  displayName: 'Alpine Dawn',
  blossomUrl: 'https://blossom.primal.net/alpine-dawn.png',
  thumbUrl: 'https://blossom.primal.net/alpine-dawn-thumb.png',
  sha256: 'ab'.repeat(32),
  fileSize: 482_133,
  dimensions: '1290x2796',
  albumSlug: 'mountains',
  palette: { '50': '#f5f7fa', '500': '#5b7a99', '950': '#0b1118' },
  dominantColors: [{ hex: '#5b7a99', hue: 210, saturation: 25, lightness: 48 }],
  gradientColors: [
    { hex: '#0b1118', position: 'dark', hsb: { hue: 212, saturation: 54, brightness: 9 } },
  ],
  createdAt: 1_776_000_000,
};
/* eslint-enable no-restricted-syntax */
const ALBUM = {
  slug: 'mountains',
  displayName: 'Mountains',
  description: 'High places',
  sortOrder: 0,
  topic: 'Nature',
  coverThemeName: 'alpine-dawn',
  author: null,
};

const SPLIT_BILL = {
  groups: {
    [`sb-${T + 3000}-q1w2e3r4`]: {
      id: `sb-${T + 3000}-q1w2e3r4`,
      unit: 'sat',
      mintUrl: MINT,
      totalAmount: 2100,
      title: 'Dinner',
      createdAt: T + 3000,
      state: 'partially-paid',
      participants: [
        {
          id: `p-${T + 3000}-z9y8x7w6`,
          source: 'nostr',
          channel: 'nostr-dm',
          pubkey: FOLLOWED,
          nickname: 'Sovran',
          amount: 1050,
          mintQuoteId: 'split-quote-1',
          bolt11: 'lnbc10500n1fixturesplit',
          expiresAt: T + 3_600_000,
          deliveryState: 'sent',
          paymentState: 'paid',
        },
      ],
    },
  },
  quoteIdToSplitBill: {
    'split-quote-1': {
      groupId: `sb-${T + 3000}-q1w2e3r4`,
      participantId: `p-${T + 3000}-z9y8x7w6`,
    },
  },
};

const SWAP_GROUP_ID = `swap-${T + 4000}-m4n5b6v7`;
const SWAP_LEG_ID = `leg-${T + 4000}-c8x9z0a1`;

/**
 * The redux row. 0.0.63 still mounted the old redux store, so redux-persist
 * kept this row for an install that began before 0.0.45: every reducer of the
 * root (redux/store/reducer.deprecated.ts:14@28bf7713a), version 251
 * (redux/store/store.deprecated.ts:592@28bf7713a). The move to Coco read the
 * proofs and left them in place (shared/lib/cashu/migration.ts:112@28bf7713a).
 */
const REDUX_ROW = reduxPersistRow(251, {
  // redux/settings/reducer.deprecated.ts:18@28bf7713a
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
  // redux/cashu/types.deprecated.ts:35@28bf7713a
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
              secret: 'fixture-secret-0063',
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
  // redux/nostr/reducer.deprecated.ts:22@28bf7713a
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
    contacts: [],
  },
});

/**
 * E16: 0.0.63. Lifecycle, wallpapers, per-account themes, split bills and
 * transaction distribution join the surface. Every per-account store is under
 * `<name>:profile:<pubkey>` (shared/lib/cashu/profileScopedStorage.ts:79@28bf7713a),
 * and no store declares a version, so every row carries 0.
 *
 * Three accounts: 0 and 1 from the phrase, and one added by its secret key.
 */
export const fixture: ReleaseFixture = {
  epoch: 'E16',
  versions: ['0.0.63'],
  commit: COMMIT,
  surface:
    'Wallet lifecycle, wallpaper store, per-account themes, split-bill groups and transaction distribution',
  asyncStorage: {
    // ── Global ───────────────────────────────────────────────────────────────
    // shared/stores/global/profileStore.ts:204@28bf7713a; entry shape :17, imported entry :103
    'profile-store': zustandRow(0, {
      activeAccountIndex: 0,
      profiles: [
        {
          accountIndex: 0,
          pubkey: A0,
          addedAt: T - 40_000_000,
          cachedBalanceSats: 2121,
          cachedDisplayName: 'Fixture',
          cachedPicture: 'https://m.primal.net/fixture.png',
        },
        { accountIndex: 1, pubkey: A1, addedAt: T - 20_000_000, cachedBalanceSats: 64 },
        {
          accountIndex: IMPORTED_INDEX,
          pubkey: IMP,
          addedAt: T - 10_000_000,
          source: 'imported',
          externalChain: 1,
        },
      ],
      cocoMigrationComplete: { 0: true },
    }),
    // shared/stores/global/settingsStore.ts:298@28bf7713a, partialize :300
    'settings-store': zustandRow(0, {
      language: 'en',
      displayBtc: 1,
      displayCurrency: 'gbp',
      experimental: false,
      mockMode: false,
      mockOffline: false,
      mockFailSend: false,
      mockFailMelt: false,
      mockFailPaymentRequest: false,
      termsAccepted: { termsAccepted: true, date: '2025-03-02T10:00:00.000Z' },
      hasSeenOnboarding: true,
      quickAccessP2PK: true,
      regenerateP2PKOnReceive: false,
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
    // shared/stores/global/walletLifecycleStore.ts:52@28bf7713a, partialize :54. An install
    // that upgraded into 0.0.63 was stamped by shared/lib/migrations/globalMigrations.ts:209@28bf7713a.
    'wallet-lifecycle': zustandRow(0, {
      seedCreatedAt: T - 5_000_000,
      restoreStatus: 'not-needed',
      lastRestoreAt: null,
    }),
    // shared/stores/global/wallpaperStore.ts:271@28bf7713a, partialize :273; downloaded entry :146
    'wallpaper-store': zustandRow(0, {
      catalog: [WALLPAPER],
      albums: [ALBUM],
      catalogLastFetched: T - 60_000,
      downloaded: {
        'alpine-dawn': {
          ...WALLPAPER,
          // shared/lib/wallpaperStorage.ts:11@28bf7713a
          localUri:
            'file:///var/mobile/Containers/Data/Application/6F0C1F3E-0063-4A6B-9C1D-FIXTURE00063/Documents/wallpapers/alpine-dawn.png',
          downloadedAt: T - 50_000,
        },
      },
    }),
    // shared/stores/global/pricelistStore.ts:138@28bf7713a, partialize :140
    'pricelist-store': zustandRow(0, {
      pricelist: { usd: { btc: 94_000 }, eur: { btc: 82_500 }, gbp: { btc: 70_250 } },
      lastUpdated: T - 30_000,
    }),
    // shared/stores/global/btcMapStore.ts:275@28bf7713a, partialize :277; shapes :12, :64, :69
    'btcmap-store': zustandRow(0, {
      placesCache: {
        data: [
          {
            id: 4242,
            lat: 51.5072,
            lon: -0.1276,
            icon: 'local_cafe',
            comments: 2,
            updated_at: '2026-04-01T00:00:00Z',
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
            updated_at: '2026-04-01T00:00:00Z',
            name: 'Fixture Coffee',
            address: '1 Example Street, London',
            'osm:payment:lightning': 'yes',
          },
          timestamp: T - 2_900_000,
        },
      },
    }),
    // shared/stores/global/auditMintStore.ts:96@28bf7713a, partialize :99; entry :10
    'audit-mint-store': zustandRow(0, {
      cache: {
        [MINT_KEY]: {
          auditData: {
            id: 7,
            url: MINT,
            name: 'Minibits',
            balance: 1200,
            sum_donations: 0,
            updated_at: '2026-04-20T00:00:00Z',
            next_update: '2026-04-21T00:00:00Z',
            state: 'OK',
            n_errors: 1,
            n_mints: 40,
            n_melts: 38,
            swaps: [],
          },
          mintInfo: {
            name: 'Minibits',
            pubkey: '023e2d2c4f1f2ad3d5b5a5ad7a5b5d0b5f0a8b8b3e1ea1f2f8f6c5e3b6f3b7e9a1',
            version: 'Nutshell/0.16.5',
            description: 'Minibits mint',
            contact: [],
            nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false } },
          },
          timestamp: T - 4_000_000,
        },
      },
    }),
    // shared/stores/global/kymMintStore.ts:99@28bf7713a, partialize :102; entry :9
    'kym-mint-store': zustandRow(0, {
      cache: {
        [MINT_KEY]: {
          score: 4.5,
          recommendations: [
            {
              score: 5,
              comment: 'Reliable',
              pubkey: FOLLOWED,
              eventId: LIKED_EVENT,
              created_at: 1_775_000_000,
            },
          ],
          timestamp: T - 4_100_000,
        },
      },
    }),
    // shared/stores/global/mintProfileStore.ts:67@28bf7713a, partialize :69; entry :7
    'mint-profile-store': zustandRow(0, {
      cache: { [MINT_KEY]: { followers: 1820, reputation: 0.92, timestamp: T - 4_200_000 } },
    }),
    // shared/lib/migrations/globalMigrations.ts:226@28bf7713a (ids), :249 (sorted array)
    'global-migrations-completed': [
      'index-to-pubkey-keys-v2',
      'legacy-global-theme-to-profile-v1',
      'wallet-lifecycle-stamp-existing-users-v1',
    ],
    'persist:SOVRAN': REDUX_ROW,

    // ── Account 0 ────────────────────────────────────────────────────────────
    // shared/stores/profile/mintStore.ts:58@28bf7713a, partialize :60; keyed by public key :28
    [accountKey('mint-store', A0)]: zustandRow(0, { selectedMints: { [A0]: MINT } }),
    // shared/stores/profile/mintDistributionStore.ts:512@28bf7713a, partialize :514; shape :25
    [accountKey('mint-distribution-store', A0)]: zustandRow(0, {
      distributions: { sat: { [MINT]: 7500, [SECOND_MINT]: 2500 } },
    }),
    // shared/stores/profile/npcMintStore.ts:143@28bf7713a, partialize :145
    [accountKey('npc-mint-store', A0)]: zustandRow(0, {
      mintUrls: { [A0]: SECOND_MINT },
      lastSyncedAt: { [A0]: T - 600_000 },
    }),
    // shared/stores/profile/routstrStore.ts:363@28bf7713a, partialize :365; session :22
    [accountKey('routstr-store', A0)]: zustandRow(0, {
      apiKey: ROUTSTR_KEY,
      balance: 21_000,
      conversationHistory: SESSION.messages,
      selectedModel: 'gpt-4o-mini',
      sessions: [SESSION],
      currentSessionId: SESSION.id,
    }),
    // shared/stores/profile/scanHistoryStore.ts:243@28bf7713a; no partialize, so the whole state :49
    [accountKey('scan-history-store', A0)]: zustandRow(0, { entries: [SECOND_SCAN, SCAN] }),
    // shared/stores/profile/searchHistoryStore.ts:140@28bf7713a, partialize :142; entry :12
    [accountKey('search-history-store', A0)]: zustandRow(0, {
      recentSearches: {
        payments: [{ query: 'sovran', timestamp: T - 700_000, context: 'payments' }],
      },
    }),
    // shared/stores/profile/swapTransactionsStore.ts:279@28bf7713a, partialize :281; shapes :32, :55, :66
    [accountKey('swap-transactions-store', A0)]: zustandRow(0, {
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
    // shared/stores/profile/splitBillTransactionsStore.ts:409@28bf7713a, partialize :411; shapes :55, :82, :97
    [accountKey('split-bill-transactions-store', A0)]: zustandRow(0, SPLIT_BILL),
    // shared/stores/profile/transactionLocationStore.ts:100@28bf7713a, partialize :102; shape :16
    [accountKey('transaction-location-store', A0)]: zustandRow(0, {
      locations: {
        'melt-quote-1': { latitude: 51.5072, longitude: -0.1276, createdAt: T + 2100 },
      },
    }),
    // shared/stores/profile/transactionDistributionStore.ts:146@28bf7713a, partialize :148; shape :54
    [accountKey('transaction-distribution-store', A0)]: zustandRow(0, {
      distributions: { 'send-quote-1': { source: 'share', recordedAt: T + 5000 } },
    }),
    // shared/stores/profile/nostrSocialStore.ts:388@28bf7713a, partialize :390; shapes :13 to :51
    [accountKey('nostr-social-store', A0)]: zustandRow(0, {
      contactsTags: [['p', FOLLOWED]],
      contactsContent: '',
      contactsUpdatedAt: 1_776_500_000,
      followingPubkeys: { [FOLLOWED]: true },
      likesByEventId: { [LIKED_EVENT]: { reactionEventId: LIKE_EVENT, updatedAt: T - 900_000 } },
      repostsByEventId: {},
      deletedRepostOriginalIds: {},
      optimisticFollowsByPubkey: {},
      optimisticLikesByEventId: {},
      optimisticRepostsByEventId: {},
    }),
    // shared/stores/profile/themeStore.ts:208@28bf7713a, partialize :210
    [accountKey('theme-store', A0)]: zustandRow(0, {
      activeAlbumSlug: 'mountains',
      unitWallpapers: { sat: 'alpine-dawn' },
      mode: 'dark',
    }),

    // ── Account 1 ────────────────────────────────────────────────────────────
    [accountKey('mint-store', A1)]: zustandRow(0, { selectedMints: { [A1]: SECOND_MINT } }),
    [accountKey('scan-history-store', A1)]: zustandRow(0, {
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
    [accountKey('routstr-store', A1)]: zustandRow(0, {
      apiKey: 'sk-fixture-routstr-0063-second',
      balance: 5_000,
      conversationHistory: [],
      selectedModel: null,
      sessions: [],
      currentSessionId: null,
    }),

    // ── The imported account ─────────────────────────────────────────────────
    [accountKey('mint-store', IMP)]: zustandRow(0, { selectedMints: { [IMP]: IMPORTED_MINT } }),
    [accountKey('search-history-store', IMP)]: zustandRow(0, {
      recentSearches: {
        payments: [{ query: 'fiatjaf', timestamp: T - 100_000, context: 'payments' }],
      },
    }),
  },
  secureStore: {
    // shared/lib/nostr/secureStorage.ts:9@28bf7713a (every key name)
    user_mnemonic: PHRASE,
    // shared/blocks/MigrationGate.tsx:116@28bf7713a, once per account that was opened
    migrations_complete_0: 'true',
    migrations_complete_1: 'true',
    [`migrations_complete_${IMPORTED_INDEX}`]: 'true',
    // shared/providers/NostrKeysProvider.tsx:357@28bf7713a; shape shared/lib/nostr/secureStorage.ts:20
    derived_keys_0: JSON.stringify({
      npub: ACCOUNTS[0].npub,
      nsec: ACCOUNTS[0].nsec,
      pubkey: A0,
      privateKeyHex: ACCOUNTS[0].privateKeyHex,
      mnemonicHash: OLD_PHRASE_HASH,
    }),
    derived_keys_1: JSON.stringify({
      npub: ACCOUNTS[1].npub,
      nsec: ACCOUNTS[1].nsec,
      pubkey: A1,
      privateKeyHex: ACCOUNTS[1].privateKeyHex,
      mnemonicHash: OLD_PHRASE_HASH,
    }),
    // shared/lib/nostr/secureStorage.ts:320@28bf7713a
    cashu_mnemonic_0: JSON.stringify({
      value: ACCOUNTS[0].cashuMnemonic,
      mnemonicHash: OLD_PHRASE_HASH,
    }),
    cashu_mnemonic_1: JSON.stringify({
      value: ACCOUNTS[1].cashuMnemonic,
      mnemonicHash: OLD_PHRASE_HASH,
    }),
    // An imported account has no derived-key cache, only the Cashu phrase
    // (shared/providers/NostrKeysProvider.tsx:315@28bf7713a).
    [`cashu_mnemonic_${IMPORTED_INDEX}`]: JSON.stringify({
      value: IMPORTED_CASHU_MNEMONIC,
      mnemonicHash: OLD_PHRASE_HASH,
    }),
    // shared/lib/nostr/secureStorage.ts:360@28bf7713a, written by shared/lib/cashu/manager.ts:191
    cashu_seed_0: JSON.stringify(CASHU_SEEDS[0]),
    cashu_seed_1: JSON.stringify(CASHU_SEEDS[1]),
    [`cashu_seed_${IMPORTED_INDEX}`]: JSON.stringify(CASHU_SEEDS.imported),
    // shared/lib/nostr/secureStorage.ts:446@28bf7713a: the nsec as text
    [`imported_nsec_${IMP}`]: IMPORTED.nsec,
  },
  // shared/lib/cashu/manager.ts:86@28bf7713a; shared/providers/NostrNDKProvider.tsx:32@28bf7713a
  sqliteDatabases: [
    'coco.db',
    'coco-1.db',
    `coco-${IMPORTED_INDEX}.db`,
    'nostr',
    'nostr-1',
    `nostr-${IMPORTED_INDEX}`,
  ],
  survives: {
    phrase: PHRASE,
    activeAccountIndex: 0,
    accounts: [
      { accountIndex: 0, pubkey: A0 },
      { accountIndex: 1, pubkey: A1 },
      { accountIndex: IMPORTED_INDEX, pubkey: IMP, imported: true },
    ],
    facts: [
      {
        what: 'the accepted terms',
        store: 'settings-store',
        path: ['termsAccepted', 'termsAccepted'],
        equals: true,
      },
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
        what: 'that no restore is needed',
        store: 'wallet-lifecycle',
        path: ['restoreStatus'],
        equals: 'not-needed',
      },
      {
        what: 'when the phrase was made',
        store: 'wallet-lifecycle',
        path: ['seedCreatedAt'],
        equals: T - 5_000_000,
      },
      {
        what: 'the cached name of account 0',
        store: 'profile-store',
        path: ['profiles', 0, 'cachedDisplayName'],
        equals: 'Fixture',
      },
      {
        what: 'that the third account was imported',
        store: 'profile-store',
        path: ['profiles', 2, 'source'],
        equals: 'imported',
      },
      // The downloaded wallpaper has no fact: the current store drops an entry
      // whose image file is missing, and a fixture cannot hold a file.
      {
        what: 'the wallpaper catalogue',
        store: 'wallpaper-store',
        path: ['catalog', 0, 'themeName'],
        equals: 'alpine-dawn',
      },
      {
        what: 'the wallpaper album list',
        store: 'wallpaper-store',
        path: ['albums', 0, 'slug'],
        equals: 'mountains',
      },
      {
        what: 'the last known price',
        store: 'pricelist-store',
        path: ['pricelist', 'gbp', 'btc'],
        equals: 70_250,
      },
      {
        what: 'the follower count of a mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_KEY, 'contactFollowers'],
        equals: 1820,
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
        what: 'the selected mint of the imported account',
        store: 'mint-store',
        accountIndex: IMPORTED_INDEX,
        path: ['selectedMint'],
        equals: IMPORTED_MINT,
      },
      {
        what: 'the mint split of account 0',
        store: 'mint-distribution-store',
        accountIndex: 0,
        path: ['distributions', 'sat', MINT],
        equals: 7500,
      },
      {
        what: 'the lightning address mint of account 0',
        store: 'npc-mint-store',
        accountIndex: 0,
        path: ['mintUrl'],
        equals: SECOND_MINT,
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
        equals: 'sk-fixture-routstr-0063-second',
      },
      {
        what: 'the scan of account 0',
        store: 'scan-history-store',
        accountIndex: 0,
        path: ['entries', 1, 'raw'],
        equals: SCAN.raw,
      },
      {
        what: 'the payment a scan of account 0 led to',
        store: 'scan-history-store',
        accountIndex: 0,
        path: ['entries', 1, 'transactionId'],
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
        what: 'the recent search of the imported account',
        store: 'search-history-store',
        accountIndex: IMPORTED_INDEX,
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
      {
        what: 'how a token of account 0 was handed over',
        store: 'transaction-distribution-store',
        accountIndex: 0,
        path: ['distributions', 'send-quote-1', 'source'],
        equals: 'share',
      },
      {
        what: 'who account 0 follows',
        store: 'nostr-social-store',
        accountIndex: 0,
        path: ['followingPubkeys', FOLLOWED],
        equals: true,
      },
      {
        what: 'the like of account 0',
        store: 'nostr-social-store',
        accountIndex: 0,
        path: ['engagementByEventId', LIKED_EVENT, 'liked', 'ownEventId'],
        equals: LIKE_EVENT,
      },
    ],
    keptAsyncStorage: ['persist:SOVRAN', accountKey('split-bill-transactions-store', A0)],
    keptSecureStore: ['user_mnemonic', `imported_nsec_${IMP}`],
  },
  defaultRows: [],
  knownGaps: [
    {
      what: 'theme-store',
      followUp: 'accepted',
      why: 'Theme choices below theme-store version 2 are reset on purpose.',
    },
  ],
};
