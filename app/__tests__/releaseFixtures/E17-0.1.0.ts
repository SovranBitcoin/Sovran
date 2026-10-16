import {
  ACCOUNTS,
  IMPORTED,
  PHRASE,
  PHRASE_HASH,
  accountKey,
  reduxPersistRow,
  zustandRow,
} from './format';
import type { ReleaseFixture } from './format';

/**
 * E17: 0.1.0. Every store is declared through `persistConfig` with a schema,
 * at version 1 unless it says otherwise (`mint-store` and `npc-mint-store` are
 * version 2); a `secure_key_index` records the secrets written; nearby
 * messages and the decryption caches are kept.
 *
 * The install: made on 0.1.0 and never updated. It still mounted the redux
 * store, so its row is on disk holding the reducers' starting state. What a
 * mint says about itself, its audit, its reviews and its followers sit in four
 * separate caches, which 0.1.1 later folded into one. A split bill is saved
 * in a store that 0.1.1 stopped reading. Three accounts: derived 0 and 1 and
 * one added by its own nsec. Account 0 is the one in use.
 *
 * Every shape below was read at `88fad9741`, where the app sat at the
 * repository root; the reference beside a row is `path:line@88fad9741` with
 * `G/` = `shared/stores/global/`, `P/` = `shared/stores/profile/`, `L/` =
 * `shared/lib/`, `F/` = `features/`. `persistConfig` wrote version 1 where a
 * store names none (`L/persist/persistConfig.ts:7`).
 */

const A0 = ACCOUNTS[0].pubkey;
const A1 = ACCOUNTS[1].pubkey;
const IMP = IMPORTED.pubkey;

/**
 * An imported account's index: the public key modulo 2^31
 * (`pubkeyToAccountNumber`, `L/nostr/keyDerivation.ts:122`), handed to
 * `addProfile` by the import sheet (`L/popup/popups/actionSheets.tsx:181`).
 */
const IMP_INDEX = 112058190;

/**
 * The imported account's Cashu words: `m/44'/129372'/0'/<IMP_INDEX>'/1/0` of
 * the phrase (`deriveCashuMnemonicForImported`, `L/nostr/keyDerivation.ts:138`),
 * derived with @scure/bip32 outside the app's code.
 */
const IMP_CASHU_MNEMONIC =
  'mouse solar clarify divide eager jungle what roof imitate process sponsor allow situate hockey month cactus street under diary okay error predict method must';

/** `mnemonicToSeedSync(<account's Cashu words>, '')`, hex: what `storeCashuSeed` cached. */
const CASHU_SEED_HEX = {
  0: '1a1721f6118d4acf240ed1674d9f26ab3f504fe2ea9c95741f98b344eacb18421d87ad400927a43369409638272adccd538a96632c1d0858c471ba01183886f0',
  1: '0e5512c019e7448d8bf2f0a4997aee1625986937c3e0360fe09dc2c6c9056690114245bcc1085a8741ad068b9549543ea740e8725674f4bff099f38ede95145f',
  imported:
    '734e9edbc939708db98deb5741ea03dd0a4e39018b0464573c8a9f81eac8fb0b5d25d86ba8d4476e0c117848bbbeeda4f608c7ff6c02dbaefbf9ebdbbef6bb3a',
} as const;

/** 2026-06-20, a month after the first 0.1.0 build; installed 2026-05-21. */
const NOW = 1_781_913_600_000;
const DAY = 86_400_000;
const INSTALLED = NOW - 30 * DAY;

const MINT = 'https://mint.minibits.cash/Bitcoin';
const MINT_B = 'https://mint.coinos.io';
const MINT_C = 'https://21mint.me';
/** The four mint caches keyed a mint without its scheme (`normalizeMintUrlKey`, L/url.ts:58). */
const MINT_KEY = 'mint.minibits.cash/Bitcoin';
const RELAY = 'wss://relay.damus.io';

const hex64 = (pair: string) => pair.repeat(32);
const FRIEND = hex64('ab');
const NOTE = hex64('e1');
const OWN_REACTION = hex64('e3');
const REPOSTED_NOTE = hex64('e5');
const OWN_REPOST = hex64('e6');

const TX = 'send-op-7c1f';
const TX_HISTORY = 'history-entry-41';

const SCAN_A0 = {
  id: `scan-${NOW - 3 * DAY}-4`,
  raw: 'lnbc210n1pfixturezeroexamplezzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
  type: 'lightning',
  source: 'qr',
  inputType: 'bolt11',
  scannedAt: NOW - 3 * DAY,
  transactionId: TX,
};
const SCAN_A0_OLDER = {
  id: `scan-${NOW - 20 * DAY}-2`,
  raw: `nostr:${ACCOUNTS[2].npub}`,
  type: 'npub',
  source: 'paste',
  scannedAt: NOW - 20 * DAY,
};
const SCAN_A1 = {
  id: `scan-${NOW - DAY}-9`,
  raw: MINT_B,
  type: 'mint',
  source: 'deeplink',
  inputType: 'mint-url',
  scannedAt: NOW - DAY,
};
const SCAN_IMPORTED = {
  id: `scan-${NOW - 2 * DAY}-3`,
  raw: 'cashuBfixtureimportedexampletoken',
  type: 'ecash',
  source: 'nfc',
  container: 'ndef-text',
  optionKinds: ['receive'],
  scannedAt: NOW - 2 * DAY,
};

const ROUTSTR_KEY_A0 = `sk-${hex64('91')}`;
const ROUTSTR_KEY_A1 = `sk-${hex64('92')}`;
const SESSION_A0 = {
  id: `${NOW - 5 * DAY}`,
  title: 'How do blinded signatures work?',
  createdAt: NOW - 5 * DAY,
  messages: [
    {
      id: `${NOW - 5 * DAY + 1}`,
      role: 'user',
      content: 'How do blinded signatures work?',
      timestamp: NOW - 5 * DAY + 1,
      parentId: null,
    },
    {
      id: `${NOW - 5 * DAY + 2}`,
      role: 'assistant',
      content: 'The mint signs a value it cannot see, and the wallet unblinds the result.',
      timestamp: NOW - 5 * DAY + 2,
      parentId: `${NOW - 5 * DAY + 1}`,
      thinkingDurationSec: 2.5,
      reasoningContent: 'Explain blinding, signing, unblinding.',
      costSats: 3,
      pending: false,
    },
  ],
  activeChildren: { [`${NOW - 5 * DAY + 1}`]: `${NOW - 5 * DAY + 2}` },
};
const SESSION_A1 = {
  id: `${NOW - DAY}`,
  title: 'New Session',
  createdAt: NOW - DAY,
  messages: [
    {
      id: `${NOW - DAY + 1}`,
      role: 'user',
      content: 'Summarise NUT-13 in one line.',
      timestamp: NOW - DAY + 1,
      parentId: null,
    },
  ],
};

/** `SplitBillGroup`, P/splitBillTransactionsStore.ts:81; ids from `mintLocalId('sb')` :240 and `('p')` :252. */
const SPLIT_BILL = {
  id: `sb-${NOW - 4 * DAY}-6`,
  unit: 'sat',
  mintUrl: MINT,
  totalAmount: 3000,
  title: 'Dinner',
  createdAt: NOW - 4 * DAY,
  state: 'partially-paid',
  participants: [
    {
      id: `p-${NOW - 4 * DAY}-7`,
      source: 'self',
      channel: 'self',
      nickname: 'fixture zero',
      amount: 1000,
      deliveryState: 'sent',
      paymentState: 'paid',
    },
    {
      id: `p-${NOW - 4 * DAY}-8`,
      source: 'nostr',
      channel: 'nostr-dm',
      pubkey: FRIEND,
      nickname: 'Fixture Friend',
      amount: 1000,
      mintQuoteId: 'split-quote-fixture-1',
      bolt11: 'lnbc10u1pfixturesplitbillonezzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
      deliveryState: 'sent',
      paymentState: 'paid',
    },
    {
      id: `p-${NOW - 4 * DAY}-9`,
      source: 'ble',
      channel: 'qr-only',
      peerID: 'a1b2c3d4e5f60718',
      nickname: 'anon4821',
      amount: 1000,
      mintQuoteId: 'split-quote-fixture-2',
      bolt11: 'lnbc10u1pfixturesplitbilltwozzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
      deliveryState: 'pending',
      paymentState: 'pending',
    },
  ],
};

/** NUT-06, as cashu-ts 3.5.0 returned it (`GetInfoResponse`); both caches kept it whole. */
const MINT_INFO = {
  name: 'Minibits',
  pubkey: `02${hex64('3c')}`,
  version: 'Nutshell/0.16.5',
  description: 'Fixture description of a mint',
  icon_url: 'https://mint.minibits.cash/icon.png',
  contact: [{ method: 'email', info: 'support@mint.example' }],
  motd: 'Fixture message of the day',
  nuts: {
    '4': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
    '5': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
    '7': { supported: true },
  },
};

const SWAP_GROUP = {
  id: `swap-${NOW - 9 * DAY}-1`,
  unit: 'sat',
  createdAt: NOW - 9 * DAY,
  title: 'Rebalance',
  state: 'finished',
  legs: [
    {
      id: `leg-${NOW - 9 * DAY}-2`,
      fromMintUrl: MINT,
      toMintUrl: MINT_B,
      amount: 500,
      mintQuoteId: 'mint-quote-fixture-1',
      meltQuoteId: 'melt-quote-fixture-1',
      meltOperationId: 'melt-op-fixture-1',
      localStatus: 'done',
    },
  ],
};

/* eslint-disable no-restricted-syntax -- colours here are stored catalog data, not UI */
const WALLPAPER = {
  eventId: hex64('f1'),
  themeName: 'aurora-01',
  displayName: 'Aurora',
  blossomUrl: `https://blossom.primal.net/${hex64('f2')}.png`,
  thumbUrl: `https://blossom.primal.net/${hex64('f3')}.png`,
  sha256: hex64('f2'),
  fileSize: 482_133,
  dimensions: '1290x2796',
  albumSlug: 'northern-lights',
  // The catalog sends the whole scale; the theme engine reads 0 to 950.
  palette: {
    '0': '#ffffff',
    '50': '#f2fbf9',
    '100': '#d9f3ee',
    '200': '#b2e6dc',
    '300': '#84d3c6',
    '400': '#52b9aa',
    '500': '#1f9d8b',
    '600': '#177e70',
    '700': '#13655a',
    '800': '#0f4f47',
    '900': '#0b2b27',
    '950': '#061a18',
  },
  dominantColors: [{ hex: '#1f9d8b', hue: 171, saturation: 67, lightness: 37 }],
  gradientColors: [
    { hex: '#0b2b27', position: 'dark', hsb: { hue: 173, saturation: 74, brightness: 17 } },
  ],
  createdAt: Math.floor((NOW - 60 * DAY) / 1000),
};
/* eslint-enable no-restricted-syntax */

/** Fields every `settings-store` row of 0.1.0 held: the whole `partialize`, G/settingsStore.ts:335. */
const SETTINGS = {
  language: 'en',
  displayBtc: 2,
  displayCurrency: 'eur',
  experimental: false,
  mockMode: false,
  mockOffline: false,
  mockFailSend: false,
  mockFailMelt: false,
  mockFailPaymentRequest: false,
  whitenoiseEnabled: false,
  mockNoGlass: false,
  termsAccepted: { termsAccepted: true, date: new Date(INSTALLED).toISOString() },
  hasSeenOnboarding: true,
  quickAccessP2PK: true,
  regenerateP2PKOnReceive: false,
  sendLocationEnabled: true,
  minTransferThreshold: 21,
  middlemanRouting: {
    maxHops: 3,
    maxFee: 8,
    minSuccessRate: 0.95,
    requireLastOk: true,
    trustMode: 'allow_untrusted',
  },
};

const SOCIAL_A0 = {
  contactsTags: [
    ['p', FRIEND],
    ['p', A1, RELAY, 'second'],
  ],
  contactsContent: '',
  contactsUpdatedAt: Math.floor((NOW - 6 * DAY) / 1000),
  followingPubkeys: { [FRIEND]: true, [A1]: true },
  // `syncLikesFromRelay`, P/nostrSocialStore.ts:287: the id of the own reaction and its `created_at`.
  likesByEventId: {
    [NOTE]: { reactionEventId: OWN_REACTION, updatedAt: Math.floor((NOW - 6 * DAY) / 1000) },
  },
  repostsByEventId: {
    [REPOSTED_NOTE]: { repostEventId: OWN_REPOST, updatedAt: Math.floor((NOW - 7 * DAY) / 1000) },
  },
  deletedRepostOriginalIds: { [hex64('d1')]: NOW - 30 * DAY },
  optimisticFollowsByPubkey: {},
  optimisticLikesByEventId: {},
  optimisticRepostsByEventId: {},
};

const emptySocial = (following: string) => ({
  contactsTags: [['p', following]],
  contactsContent: '',
  contactsUpdatedAt: Math.floor((NOW - 2 * DAY) / 1000),
  followingPubkeys: { [following]: true },
  likesByEventId: {},
  repostsByEventId: {},
  deletedRepostOriginalIds: {},
  optimisticFollowsByPubkey: {},
  optimisticLikesByEventId: {},
  optimisticRepostsByEventId: {},
});

/** P/mintStore.ts:61, version 2 (:65): the selected mint and nothing else (:67). */
const mintStore = (selectedMint: string) => zustandRow(2, { selectedMint });

/** L/nostr/secureStorage.ts:29 (`CachedDerivedKeys`), written by `storeDerivedKeys` :499. */
const derivedKeys = (account: (typeof ACCOUNTS)[number]) =>
  JSON.stringify({
    npub: account.npub,
    nsec: account.nsec,
    pubkey: account.pubkey,
    privateKeyHex: account.privateKeyHex,
    mnemonicHash: PHRASE_HASH,
  });
/** `storeCashuMnemonic`, L/nostr/secureStorage.ts:510. */
const cashuMnemonic = (value: string) => JSON.stringify({ value, mnemonicHash: PHRASE_HASH });
/** `storeCashuSeed`, L/nostr/secureStorage.ts:541, called from L/cashu/manager.ts:191. */
const cashuSeed = (hex: string) => JSON.stringify({ hex, mnemonicHash: PHRASE_HASH });

const REDUX_ROW = 'persist:SOVRAN';
const SPLIT_BILL_STORE = 'split-bill-transactions-store';

export const fixture: ReleaseFixture = {
  epoch: 'E17',
  versions: ['0.1.0'],
  commit: '88fad9741',
  surface:
    'Schema-backed persistConfig at version 1 (mint-store and npc-mint-store version 2); secure_key_index; nearby messages; decryption caches; four mint caches; split bills',
  asyncStorage: {
    // ── The redux row ─────────────────────────────────────────────────────────
    // 0.1.0 still mounted the redux store (`redux/store/store.deprecated.ts:593`,
    // key `SOVRAN`, version 251 at :596; `app/_layout.tsx` wraps the app in its
    // `PersistGate`). On an install that never had redux data it holds the
    // reducers' starting state: no phrase, no proofs
    // (`redux/{settings,cashu,nostr}/reducer.deprecated.ts`). The bundled `search`
    // sample (`redux/store/migrationTest.deprecated.ts`) is left out to keep the row small.
    [REDUX_ROW]: reduxPersistRow(251, {
      settings: {
        settings: {
          lang: 'en',
          theme: 'dark',
          display_btc: 3,
          passcode: '',
          experimental: false,
          termsAccepted: null,
        },
      },
      cashu: {
        profiles: [{ mints: [], proofs: {}, counters: {}, keysets: {}, transactions: [] }],
        audits: {},
        info: {},
        keys: {},
        keysets: {},
        allocation: {},
      },
      nostr: {
        currentProfile: { id: 0 },
        profiles: [
          {
            id: 0,
            mnemonic: '',
            pubkey: '',
            profile: { created_at: 0, profileEvent: '', name: '', picture: '', image: '' },
            npub: '',
            nsec: '',
            mints: [],
            picture: '',
            root: { xpub: '', xpriv: '' },
            nut13: '',
          },
        ],
        messages: { loaded_messages: [] },
        follows: {},
        contacts: [],
      },
    }),

    // ── Markers ───────────────────────────────────────────────────────────────
    // L/migrations/globalMigrations.ts:221 (the three ids), :241 (sorted array).
    'global-migrations-completed': [
      'index-to-pubkey-keys-v2',
      'legacy-global-theme-to-profile-v1',
      'wallet-lifecycle-stamp-existing-users-v1',
    ],

    // ── Global stores ─────────────────────────────────────────────────────────
    // G/profileStore.ts:222, version 1. An imported row carries `source` and
    // `externalChain: 1` (`addProfile` :122); balances and kind-0 names come from
    // `updateProfileBalance` :179 and `updateProfileMetadata` :202.
    // `cocoMigrationComplete` (:229) is filled only for accounts that had redux
    // ecash to move (`L/migrations/legacyReduxMigrations.ts:194`); this install had none.
    'profile-store': zustandRow(1, {
      activeAccountIndex: 0,
      profiles: [
        {
          accountIndex: 0,
          pubkey: A0,
          addedAt: INSTALLED,
          cachedBalanceSats: 2100,
          cachedDisplayName: 'fixture zero',
          cachedPicture: 'https://m.primal.net/fixture-zero.png',
        },
        { accountIndex: 1, pubkey: A1, addedAt: INSTALLED + 3 * DAY, cachedBalanceSats: 64 },
        {
          accountIndex: IMP_INDEX,
          pubkey: IMP,
          addedAt: INSTALLED + 30 * DAY,
          source: 'imported',
          externalChain: 1,
          cachedBalanceSats: 0,
        },
      ],
      cocoMigrationComplete: {},
    }),
    // G/settingsStore.ts:331, version 1: eighteen fields (:335).
    'settings-store': zustandRow(1, SETTINGS),
    // G/walletLifecycleStore.ts:56, version 1. A wallet made on this device:
    // `markSeedCreatedNow` :47, then `not-needed`.
    'wallet-lifecycle': zustandRow(1, {
      seedCreatedAt: INSTALLED,
      restoreStatus: 'not-needed',
      lastRestoreAt: null,
      lastRestoreError: null,
    }),
    // G/pricelistStore.ts:139, version 1; `setBtcPrices` :93.
    'pricelist-store': zustandRow(1, {
      pricelist: { usd: { btc: 64_250.5 }, eur: { btc: 59_010.25 }, gbp: { btc: 50_880 } },
      lastUpdated: NOW - 600_000,
    }),
    // G/btcMapStore.ts:315, version 1. Both caches hold the API's rows as they came (:129, :137).
    'btcmap-store': zustandRow(1, {
      placesCache: {
        data: [
          { id: 4242, lat: 51.5072, lon: -0.1276, icon: 'local_cafe' },
          { id: 4243, lat: 48.8566, lon: 2.3522, icon: 'restaurant' },
        ],
        timestamp: NOW - 2 * DAY,
      },
      placeDetailsCache: {
        '4242': {
          data: { id: 4242, name: 'Fixture Coffee', address: '1 Example Street' },
          timestamp: NOW - 2 * DAY,
        },
      },
    }),
    // The four mint caches, each version 1 under its bare name. 0.1.1 read them
    // once into `mint-metadata-store` and deleted them.
    // G/mintInfoCache.ts:101; entry :34.
    'mint-info-cache': zustandRow(1, {
      byMintUrl: {
        [MINT_KEY]: { info: MINT_INFO, fetchedAt: NOW - DAY },
        'mint.coinos.io': { info: { name: 'Coinos', nuts: {} }, fetchedAt: NOW - 8 * DAY },
      },
    }),
    // G/auditMintStore.ts:102; entry :12. `auditData` is the auditor's answer
    // (`AuditMintResponse`, `@sovranbitcoin/schemas` 2.0.3, relaxed at L/apiClient.ts:29).
    'audit-mint-store': zustandRow(1, {
      cache: {
        [MINT_KEY]: {
          auditData: {
            id: 12,
            url: MINT,
            info: MINT_INFO,
            name: 'Minibits',
            balance: 4200,
            sum_donations: 0,
            updated_at: new Date(NOW - DAY).toISOString(),
            next_update: new Date(NOW).toISOString(),
            state: 'OK',
            n_errors: 2,
            n_mints: 120,
            n_melts: 118,
            swaps: [
              {
                id: 9001,
                from_id: 12,
                to_id: 31,
                from_url: MINT,
                to_url: MINT_B,
                amount: 21,
                fee: 1,
                created_at: new Date(NOW - 2 * DAY).toISOString(),
                time_taken: 1840,
                state: 'OK',
                error: null,
              },
            ],
          },
          mintInfo: MINT_INFO,
          timestamp: NOW - DAY,
        },
      },
    }),
    // G/kymMintStore.ts:102; entry :11, reviews are `MintRecommendation`.
    'kym-mint-store': zustandRow(1, {
      cache: {
        [MINT_KEY]: {
          score: 4.6,
          recommendations: [
            {
              score: 5,
              comment: 'Fast and reliable',
              pubkey: FRIEND,
              eventId: hex64('7c'),
              created_at: Math.floor((NOW - 9 * DAY) / 1000),
            },
            {
              score: 4,
              comment: 'Good uptime',
              pubkey: hex64('ac'),
              eventId: hex64('7d'),
              created_at: Math.floor((NOW - 12 * DAY) / 1000),
            },
          ],
          timestamp: NOW - DAY,
        },
      },
    }),
    // G/mintProfileStore.ts:71; entry :9.
    'mint-profile-store': zustandRow(1, {
      cache: { [MINT_KEY]: { followers: 4, reputation: 0.8, timestamp: NOW - DAY } },
    }),
    // G/wallpaperStore.ts:305, version 1; entries are the catalog's own rows
    // (`WallpaperCatalogEntry` of `@sovranbitcoin/schemas` 2.0.3), downloads add
    // `localUri` and `downloadedAt` (:46).
    'wallpaper-store': zustandRow(1, {
      catalog: [WALLPAPER],
      albums: [
        {
          slug: 'northern-lights',
          displayName: 'Northern Lights',
          description: '',
          sortOrder: 0,
          topic: 'Nature',
          coverThemeName: 'aurora-01',
          author: null,
        },
      ],
      catalogLastFetched: NOW - DAY,
      downloaded: {
        'aurora-01': {
          ...WALLPAPER,
          localUri: 'file:///data/user/0/money.sovran/files/wallpapers/aurora-01.png',
          downloadedAt: NOW - 15 * DAY,
        },
      },
    }),

    // ── Account 0, the one in use ─────────────────────────────────────────────
    [accountKey('mint-store', A0)]: mintStore(MINT),
    // P/npcMintStore.ts:146, version 2 (:151).
    [accountKey('npc-mint-store', A0)]: zustandRow(2, { mintUrl: MINT }),
    // P/themeStore.ts:59, version 1 (`PersistedThemeStore`, `@sovranbitcoin/schemas` 2.0.3; the three fields at :63).
    [accountKey('theme-store', A0)]: zustandRow(1, {
      activeAlbumSlug: 'northern-lights',
      unitWallpapers: { sat: 'aurora-01' },
      mode: 'light',
    }),
    // P/scanHistoryStore.ts:197, version 1; entry :31, ids from `mintLocalId('scan')` (L/id.ts:16).
    [accountKey('scan-history-store', A0)]: zustandRow(1, { entries: [SCAN_A0, SCAN_A0_OLDER] }),
    // P/searchHistoryStore.ts:93, version 1.
    [accountKey('search-history-store', A0)]: zustandRow(1, {
      recentSearches: {
        contacts: [
          { query: 'fixture friend', timestamp: NOW - 2 * DAY, context: 'contacts' },
          { query: 'jack', timestamp: NOW - 9 * DAY, context: 'contacts' },
        ],
      },
    }),
    // P/sendReachabilityStore.ts:92, version 1.
    [accountKey('send-reachability-store', A0)]: zustandRow(1, {
      byTransactionId: {
        [TX]: { status: 'mint-reachable', mintUrl: MINT, updatedAt: NOW - 3 * DAY },
      },
    }),
    // P/transactionLocationStore.ts:83, version 1.
    [accountKey('transaction-location-store', A0)]: zustandRow(1, {
      locations: {
        [TX_HISTORY]: { latitude: 51.5072, longitude: -0.1276, createdAt: NOW - 3 * DAY },
      },
    }),
    // P/transactionDistributionStore.ts:129, version 1.
    [accountKey('transaction-distribution-store', A0)]: zustandRow(1, {
      distributions: { [TX_HISTORY]: { source: 'share', recordedAt: NOW - 3 * DAY } },
    }),
    // P/routstrStore.ts:535, version 1: five fields (:539). 0.1.0 knew one node, so no row names one.
    [accountKey('routstr-store', A0)]: zustandRow(1, {
      apiKey: ROUTSTR_KEY_A0,
      balance: 41_500,
      selectedModel: 'openai/gpt-4o-mini',
      sessions: [SESSION_A0],
      currentSessionId: SESSION_A0.id,
    }),
    // P/nostrSocialStore.ts:425, version 1: likes and reposts in two maps (:430).
    [accountKey('nostr-social-store', A0)]: zustandRow(1, SOCIAL_A0),
    // P/swapTransactionsStore.ts:314, version 1.
    [accountKey('swap-transactions-store', A0)]: zustandRow(1, {
      groups: { [SWAP_GROUP.id]: SWAP_GROUP },
      quoteIdToGroup: {
        'mint-quote-fixture-1': {
          groupId: SWAP_GROUP.id,
          legId: SWAP_GROUP.legs[0].id,
          kind: 'mint',
        },
        'melt-quote-fixture-1': {
          groupId: SWAP_GROUP.id,
          legId: SWAP_GROUP.legs[0].id,
          kind: 'melt',
        },
      },
    }),
    // P/splitBillTransactionsStore.ts:463, version 1. 0.1.1 removed the store and nothing reads the row.
    [accountKey(SPLIT_BILL_STORE, A0)]: zustandRow(1, {
      groups: { [SPLIT_BILL.id]: SPLIT_BILL },
      quoteIdToSplitBill: {
        'split-quote-fixture-1': {
          groupId: SPLIT_BILL.id,
          participantId: SPLIT_BILL.participants[1].id,
        },
        'split-quote-fixture-2': {
          groupId: SPLIT_BILL.id,
          participantId: SPLIT_BILL.participants[2].id,
        },
      },
    }),
    // P/mintDistributionStore.ts:611, version 1: basis points per mint, per unit.
    [accountKey('mint-distribution-store', A0)]: zustandRow(1, {
      distributions: { sat: { [MINT]: 7000, [MINT_B]: 3000 } },
    }),
    // G/nostrMetadataCache.ts:223, version 1, kept per account (:225); entry :131.
    [accountKey('nostr-metadata-cache', A0)]: zustandRow(1, {
      byPubkey: {
        [FRIEND]: {
          displayName: 'Fixture Friend',
          name: 'friend',
          picture: 'https://m.primal.net/fixture-friend.png',
          nip05: 'friend@example.com',
          lud16: 'friend@example.com',
          about: 'A friend of the fixture',
          fetchedAt: NOW - 2 * DAY,
        },
      },
    }),
    // F/bitchat/stores/bitchatDmMessages.ts:190, version 1; message :84.
    [accountKey('bitchat-dm-messages-store', A0)]: zustandRow(1, {
      byPeer: {
        a1b2c3d4e5f60718: [
          {
            id: 'ble-msg-1',
            content: 'are you at the meetup?',
            sender: 'anon4821',
            senderId: 'a1b2c3d4e5f60718',
            timestamp: NOW - DAY,
            isPrivate: true,
            isOwn: false,
          },
          {
            id: 'ble-msg-2',
            content: 'by the door',
            sender: 'fixture zero',
            senderId: '0f1e2d3c4b5a6978',
            timestamp: NOW - DAY + 30_000,
            isPrivate: true,
            isOwn: true,
            deliveryStatus: 'delivered',
          },
        ],
      },
    }),
    // Decryption caches, one row per account's key: L/cache/createPubkeyScopedCache.ts:86, :129,
    // prefixes at L/nostr/nip04Cache.ts:5. Value `{ value, cachedAt }` per event id; misses by time.
    [`nip04-cache:v1:${A0}`]: {
      [hex64('4a')]: { value: 'see you at the meetup', cachedAt: NOW - 6 * DAY },
    },
    [`nip04-cache-neg:v1:${A0}`]: { [hex64('4b')]: NOW - 6 * DAY },
    // Lightning-address cursor: L/cashu/npc.ts:39 (a number as text), key :58.
    [`npc_since:profile:${A0}`]: String(Math.floor((NOW - DAY) / 1000)),

    // ── Account 1 ─────────────────────────────────────────────────────────────
    [accountKey('mint-store', A1)]: mintStore(MINT_B),
    [accountKey('theme-store', A1)]: zustandRow(1, {
      activeAlbumSlug: null,
      unitWallpapers: { sat: 'sunset' },
      mode: 'dark',
    }),
    [accountKey('scan-history-store', A1)]: zustandRow(1, { entries: [SCAN_A1] }),
    [accountKey('routstr-store', A1)]: zustandRow(1, {
      apiKey: ROUTSTR_KEY_A1,
      balance: 9_000,
      selectedModel: null,
      sessions: [SESSION_A1],
      currentSessionId: SESSION_A1.id,
    }),
    [accountKey('nostr-social-store', A1)]: zustandRow(1, emptySocial(A0)),
    [`npc_since:profile:${A1}`]: String(Math.floor((NOW - 2 * DAY) / 1000)),

    // ── The imported account ──────────────────────────────────────────────────
    [accountKey('mint-store', IMP)]: mintStore(MINT_C),
    [accountKey('theme-store', IMP)]: zustandRow(1, {
      activeAlbumSlug: null,
      unitWallpapers: {},
      mode: 'light',
    }),
    [accountKey('scan-history-store', IMP)]: zustandRow(1, { entries: [SCAN_IMPORTED] }),
    [accountKey('nostr-social-store', IMP)]: zustandRow(1, emptySocial(FRIEND)),
  },
  secureStore: {
    // L/nostr/secureStorage.ts:11 (the key names), :225 (`storeMnemonic`).
    user_mnemonic: PHRASE,
    derived_keys_0: derivedKeys(ACCOUNTS[0]),
    cashu_mnemonic_0: cashuMnemonic(ACCOUNTS[0].cashuMnemonic),
    cashu_seed_0: cashuSeed(CASHU_SEED_HEX[0]),
    derived_keys_1: derivedKeys(ACCOUNTS[1]),
    cashu_mnemonic_1: cashuMnemonic(ACCOUNTS[1].cashuMnemonic),
    cashu_seed_1: cashuSeed(CASHU_SEED_HEX[1]),
    // An imported account keeps its nsec by public key (`storeImportedNsec` :609,
    // from `shared/blocks/DrawerProfileChrome.tsx:92`) and no `derived_keys_`
    // row; its Cashu caches sit under its account index
    // (`shared/providers/NostrKeysProvider.tsx:339`, L/cashu/manager.ts:191).
    [`imported_nsec_${IMP}`]: IMPORTED.nsec,
    [`cashu_mnemonic_${IMP_INDEX}`]: cashuMnemonic(IMP_CASHU_MNEMONIC),
    [`cashu_seed_${IMP_INDEX}`]: cashuSeed(CASHU_SEED_HEX.imported),
    // One per account opened, the imported one under its index
    // (`shared/blocks/MigrationGate.tsx:37`, `setMigrationsComplete` :598).
    migrations_complete_0: 'true',
    migrations_complete_1: 'true',
    [`migrations_complete_${IMP_INDEX}`]: 'true',
    // Every key `secureSet` wrote, in order (:84, `rememberKey` :131).
    secure_key_index: JSON.stringify([
      'user_mnemonic',
      'derived_keys_0',
      'cashu_mnemonic_0',
      'migrations_complete_0',
      'cashu_seed_0',
      'derived_keys_1',
      'cashu_mnemonic_1',
      'migrations_complete_1',
      'cashu_seed_1',
      `imported_nsec_${IMP}`,
      `cashu_mnemonic_${IMP_INDEX}`,
      `migrations_complete_${IMP_INDEX}`,
      `cashu_seed_${IMP_INDEX}`,
    ]),
  },
  // L/cashu/manager.ts:96 (`coco.db` / `coco-<index>.db`); `shared/providers/NostrNDKProvider.tsx`
  // (`nostr` / `nostr-<index>`).
  sqliteDatabases: [
    'coco.db',
    'coco-1.db',
    `coco-${IMP_INDEX}.db`,
    'nostr',
    'nostr-1',
    `nostr-${IMP_INDEX}`,
  ],
  survives: {
    phrase: PHRASE,
    activeAccountIndex: 0,
    accounts: [
      { accountIndex: 0, pubkey: A0 },
      { accountIndex: 1, pubkey: A1 },
      { accountIndex: IMP_INDEX, pubkey: IMP, imported: true },
    ],
    facts: [
      // Global.
      {
        what: 'the accepted terms',
        store: 'settings-store',
        path: ['termsAccepted'],
        equals: SETTINGS.termsAccepted,
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
        equals: 'eur',
      },
      {
        what: 'the bitcoin display format',
        store: 'settings-store',
        path: ['displayBtc'],
        equals: 2,
      },
      {
        what: 'the lock-key shortcut setting',
        store: 'settings-store',
        path: ['quickAccessP2PK'],
        equals: true,
      },
      {
        what: 'the choice to keep one lock key',
        store: 'settings-store',
        path: ['regenerateP2PKOnReceive'],
        equals: false,
      },
      {
        what: 'the choice to record where payments were sent',
        store: 'settings-store',
        path: ['sendLocationEnabled'],
        equals: true,
      },
      {
        what: 'the smallest transfer amount',
        store: 'settings-store',
        path: ['minTransferThreshold'],
        equals: 21,
      },
      {
        what: 'the routing limits',
        store: 'settings-store',
        path: ['middlemanRouting'],
        equals: SETTINGS.middlemanRouting,
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
        equals: INSTALLED,
      },
      {
        what: 'the last known bitcoin price',
        store: 'pricelist-store',
        path: ['pricelist', 'eur', 'btc'],
        equals: 59_010.25,
      },
      {
        what: 'the cached merchant map',
        store: 'btcmap-store',
        path: ['placesCache', 'data', 0, 'id'],
        equals: 4242,
      },
      {
        what: 'the cached merchant details',
        store: 'btcmap-store',
        path: ['placeDetailsCache', '4242', 'data', 'name'],
        equals: 'Fixture Coffee',
      },
      // The four mint caches are read into the one store that replaced them.
      {
        what: 'the cached name of a mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_KEY, 'displayName'],
        equals: 'Minibits',
      },
      {
        what: 'the cached icon of a mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_KEY, 'iconUrl'],
        equals: MINT_INFO.icon_url,
      },
      {
        what: 'what a mint said about itself',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_KEY, 'info'],
        equals: MINT_INFO,
      },
      {
        what: 'when a mint was last asked about itself',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_KEY, 'identityAt'],
        equals: NOW - DAY,
      },
      {
        what: 'the cached audit state of a mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_KEY, 'auditState'],
        equals: 'OK',
      },
      {
        what: 'the cached audit counts of a mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_KEY, 'nMints'],
        equals: 120,
      },
      {
        what: 'the cached review score of a mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_KEY, 'averageScore'],
        equals: 4.6,
      },
      {
        what: 'the cached review count of a mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_KEY, 'reviewCount'],
        equals: 2,
      },
      {
        what: 'the cached follower count of a mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_KEY, 'contactFollowers'],
        equals: 4,
      },
      {
        what: 'the cached reputation of a mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT_KEY, 'contactReputation'],
        equals: 0.8,
      },
      {
        what: 'the cached name of a second mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', 'mint.coinos.io', 'displayName'],
        equals: 'Coinos',
      },
      {
        what: 'that the four mint caches were folded in',
        store: 'mint-metadata-store',
        path: ['legacyMigrated'],
        equals: true,
      },
      {
        what: 'the wallpaper catalog',
        store: 'wallpaper-store',
        path: ['catalog', 0, 'themeName'],
        equals: 'aurora-01',
      },
      // No fact for `downloaded`: the store drops a download whose image file is
      // missing (`verifyIntegrity`), and a fixture cannot put a file on the
      // runner's disk. The image itself needs a device.
      {
        what: 'the cached balance of account 0 in the account list',
        store: 'profile-store',
        path: ['profiles', 0, 'cachedBalanceSats'],
        equals: 2100,
      },
      {
        what: 'the cached name of account 0 in the account list',
        store: 'profile-store',
        path: ['profiles', 0, 'cachedDisplayName'],
        equals: 'fixture zero',
      },
      {
        what: 'that the third account is an imported one',
        store: 'profile-store',
        path: ['profiles', 2, 'source'],
        equals: 'imported',
      },

      // Account 0.
      {
        what: 'the selected mint of account 0',
        store: 'mint-store',
        accountIndex: 0,
        path: ['selectedMint'],
        equals: MINT,
      },
      {
        what: 'the lightning-address mint of account 0',
        store: 'npc-mint-store',
        accountIndex: 0,
        path: ['mintUrl'],
        equals: MINT,
      },
      {
        what: 'the light appearance of account 0',
        store: 'theme-store',
        accountIndex: 0,
        path: ['mode'],
        equals: 'light',
      },
      {
        what: 'the wallpaper of account 0',
        store: 'theme-store',
        accountIndex: 0,
        path: ['unitWallpapers', 'sat'],
        equals: 'aurora-01',
      },
      {
        what: 'the wallpaper album of account 0',
        store: 'theme-store',
        accountIndex: 0,
        path: ['activeAlbumSlug'],
        equals: 'northern-lights',
      },
      {
        what: 'the newest scan of account 0',
        store: 'scan-history-store',
        accountIndex: 0,
        path: ['entries', 0],
        equals: SCAN_A0,
      },
      {
        what: 'the older scan of account 0',
        store: 'scan-history-store',
        accountIndex: 0,
        path: ['entries', 1],
        equals: SCAN_A0_OLDER,
      },
      {
        what: 'the recent searches of account 0',
        store: 'search-history-store',
        accountIndex: 0,
        path: ['recentSearches', 'contacts', 0, 'query'],
        equals: 'fixture friend',
      },
      {
        what: 'whether a sent token of account 0 could reach its mint',
        store: 'send-reachability-store',
        accountIndex: 0,
        path: ['byTransactionId', TX, 'status'],
        equals: 'mint-reachable',
      },
      {
        what: 'where a payment of account 0 was made',
        store: 'transaction-location-store',
        accountIndex: 0,
        path: ['locations', TX_HISTORY, 'latitude'],
        equals: 51.5072,
      },
      {
        what: 'how a token of account 0 was handed over',
        store: 'transaction-distribution-store',
        accountIndex: 0,
        path: ['distributions', TX_HISTORY, 'source'],
        equals: 'share',
      },
      {
        what: 'the Routstr key of account 0',
        store: 'routstr-store',
        accountIndex: 0,
        path: ['apiKey'],
        equals: ROUTSTR_KEY_A0,
      },
      {
        what: 'the Routstr balance of account 0',
        store: 'routstr-store',
        accountIndex: 0,
        path: ['balance'],
        equals: 41_500,
      },
      {
        what: 'the chosen AI model of account 0',
        store: 'routstr-store',
        accountIndex: 0,
        path: ['selectedModel'],
        equals: 'openai/gpt-4o-mini',
      },
      {
        what: 'the chat session of account 0',
        store: 'routstr-store',
        accountIndex: 0,
        path: ['sessions', 0, 'title'],
        equals: SESSION_A0.title,
      },
      {
        what: 'the answer in the chat session of account 0',
        store: 'routstr-store',
        accountIndex: 0,
        path: ['sessions', 0, 'messages', 1, 'content'],
        equals: SESSION_A0.messages[1].content,
      },
      {
        what: 'the open chat session of account 0',
        store: 'routstr-store',
        accountIndex: 0,
        path: ['currentSessionId'],
        equals: SESSION_A0.id,
      },
      {
        what: 'who account 0 follows',
        store: 'nostr-social-store',
        accountIndex: 0,
        path: ['followingPubkeys'],
        equals: { [FRIEND]: true, [A1]: true },
      },
      {
        what: 'the contact list event of account 0',
        store: 'nostr-social-store',
        accountIndex: 0,
        path: ['contactsTags'],
        equals: SOCIAL_A0.contactsTags,
      },
      {
        what: 'the note account 0 liked',
        store: 'nostr-social-store',
        accountIndex: 0,
        path: ['engagementByEventId', NOTE, 'liked', 'ownEventId'],
        equals: OWN_REACTION,
      },
      {
        what: 'the note account 0 reposted',
        store: 'nostr-social-store',
        accountIndex: 0,
        path: ['engagementByEventId', REPOSTED_NOTE, 'reposted', 'ownEventId'],
        equals: OWN_REPOST,
      },
      {
        what: 'the repost account 0 took back',
        store: 'nostr-social-store',
        accountIndex: 0,
        path: ['deletedRepostOriginalIds', hex64('d1')],
        equals: NOW - 30 * DAY,
      },
      {
        what: 'the swap history of account 0',
        store: 'swap-transactions-store',
        accountIndex: 0,
        path: ['groups', SWAP_GROUP.id],
        equals: SWAP_GROUP,
      },
      {
        what: 'the swap quote index of account 0',
        store: 'swap-transactions-store',
        accountIndex: 0,
        path: ['quoteIdToGroup', 'melt-quote-fixture-1', 'kind'],
        equals: 'melt',
      },
      {
        what: 'the mint split of account 0',
        store: 'mint-distribution-store',
        accountIndex: 0,
        path: ['distributions', 'sat'],
        equals: { [MINT]: 7000, [MINT_B]: 3000 },
      },
      {
        what: 'the cached profile of a contact of account 0',
        store: 'nostr-metadata-cache',
        accountIndex: 0,
        path: ['byPubkey', FRIEND, 'displayName'],
        equals: 'Fixture Friend',
      },
      {
        what: 'the nearby messages of account 0',
        store: 'bitchat-dm-messages-store',
        accountIndex: 0,
        path: ['byPeer', 'a1b2c3d4e5f60718', 0, 'content'],
        equals: 'are you at the meetup?',
      },

      // Account 1.
      {
        what: 'the selected mint of account 1',
        store: 'mint-store',
        accountIndex: 1,
        path: ['selectedMint'],
        equals: MINT_B,
      },
      {
        what: 'the wallpaper of account 1',
        store: 'theme-store',
        accountIndex: 1,
        path: ['unitWallpapers', 'sat'],
        equals: 'sunset',
      },
      {
        what: 'the scan of account 1',
        store: 'scan-history-store',
        accountIndex: 1,
        path: ['entries', 0],
        equals: SCAN_A1,
      },
      {
        what: 'the Routstr key of account 1',
        store: 'routstr-store',
        accountIndex: 1,
        path: ['apiKey'],
        equals: ROUTSTR_KEY_A1,
      },
      {
        what: 'the chat session of account 1',
        store: 'routstr-store',
        accountIndex: 1,
        path: ['sessions', 0, 'messages', 0, 'content'],
        equals: 'Summarise NUT-13 in one line.',
      },
      {
        what: 'who account 1 follows',
        store: 'nostr-social-store',
        accountIndex: 1,
        path: ['followingPubkeys'],
        equals: { [A0]: true },
      },

      // The imported account.
      {
        what: 'the selected mint of the imported account',
        store: 'mint-store',
        accountIndex: IMP_INDEX,
        path: ['selectedMint'],
        equals: MINT_C,
      },
      {
        what: 'the light appearance of the imported account',
        store: 'theme-store',
        accountIndex: IMP_INDEX,
        path: ['mode'],
        equals: 'light',
      },
      {
        what: 'the scan of the imported account',
        store: 'scan-history-store',
        accountIndex: IMP_INDEX,
        path: ['entries', 0],
        equals: SCAN_IMPORTED,
      },
      {
        what: 'who the imported account follows',
        store: 'nostr-social-store',
        accountIndex: IMP_INDEX,
        path: ['followingPubkeys'],
        equals: { [FRIEND]: true },
      },
    ],
    keptAsyncStorage: [
      REDUX_ROW,
      // FOLLOWUP(F89): nothing reads split bills since 0.1.1; the row must stay for an importer.
      accountKey(SPLIT_BILL_STORE, A0),
      `nip04-cache:v1:${A0}`,
      `nip04-cache-neg:v1:${A0}`,
      `npc_since:profile:${A0}`,
      `npc_since:profile:${A1}`,
    ],
    keptSecureStore: [
      'user_mnemonic',
      `imported_nsec_${IMP}`,
      'cashu_mnemonic_0',
      'cashu_mnemonic_1',
      `cashu_mnemonic_${IMP_INDEX}`,
    ],
  },
  defaultRows: [],
  knownGaps: [
    // `theme-store` below version 2 is reset on purpose
    // (`migrateThemeStore`, app/shared/stores/profile/themeStore.ts): 0.1.0 wrote version 1.
    ...[
      'theme-store',
      'the light appearance of account 0',
      'the wallpaper of account 0',
      'the wallpaper album of account 0',
      'the wallpaper of account 1',
      'the light appearance of the imported account',
    ].map((what) => ({
      what,
      followUp: 'accepted',
      why: 'Theme choices saved below theme-store version 2 are reset on purpose.',
    })),
  ],
};
