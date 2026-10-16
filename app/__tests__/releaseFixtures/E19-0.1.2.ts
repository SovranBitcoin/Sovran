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
 * E19: 0.1.2 and 0.1.3. The app moved under `app/`; `profile-store` and
 * `theme-store` are version 2, `settings-store` version 4, and
 * `relay-metadata-store` is new. 0.1.3 (`d9ad12c4b`) wrote the same surface.
 *
 * The install: made on 0.1.0, updated through 0.1.1 to 0.1.2, so the redux row
 * and the `migrations_complete_<index>` flags those two releases wrote are
 * still on disk. Three accounts: derived 0 and 1 and one added by its own
 * nsec. Account 1 is the one in use.
 *
 * Every shape below was read at `148ebd085`; the reference beside a row is
 * `path:line@148ebd085` with `G/` = `app/shared/stores/global/`, `P/` =
 * `app/shared/stores/profile/`, `L/` = `app/shared/lib/`, `F/` =
 * `app/features/`. `persistConfig` wrote version 1 where a store names none
 * (`L/persist/persistConfig.ts:7`).
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
 * the phrase (`deriveCashuMnemonicForImported`, `L/nostr/keyDerivation.ts:140`),
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

/** 2026-09-12, the day 0.1.2 was built; the install is older. */
const NOW = 1_789_200_000_000;
const DAY = 86_400_000;
const INSTALLED = NOW - 80 * DAY;

const MINT = 'https://mint.minibits.cash/Bitcoin';
const MINT_B = 'https://mint.coinos.io';
const MINT_C = 'https://21mint.me';
const RELAY = 'wss://relay.damus.io';

const hex64 = (pair: string) => pair.repeat(32);
const FRIEND = hex64('ab');
const STRANGER = hex64('cd');
const SIGNER_APP = hex64('5a');
const NOTE = hex64('e1');
const OWN_NOTE = hex64('e2');
const OWN_REACTION = hex64('e3');
const MUTE_LIST_EVENT = hex64('e4');
const BLOB_SHA = hex64('b1');

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
const ROUTSTR_NODE_A1 = 'https://ai.fixture-node.example';
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

const OWN_EVENT = {
  id: OWN_NOTE,
  kind: 1,
  pubkey: A0,
  content: 'gm from the fixture',
  tags: [['t', 'gm']],
  created_at: Math.floor((NOW - 4 * DAY) / 1000),
};

const SIGNER_CONNECTION = {
  clientPubkey: SIGNER_APP,
  name: 'Fixture Client',
  url: 'https://client.example',
  relays: [RELAY],
  origin: 'nostrconnect',
  status: 'active',
  mode: 'standard',
  encryption: 'nip44',
  pairedAt: NOW - 12 * DAY,
  lastUsedAt: NOW - 2 * DAY,
  requestCount: 14,
  deniedCount: 1,
  grants: {
    'sign_event:1': {
      verdict: 'always',
      origin: 'pairing',
      createdAt: NOW - 12 * DAY,
      lastUsedAt: NOW - 2 * DAY,
      useCount: 9,
    },
    'sign_event:7': { verdict: 'deny', origin: 'prompt', createdAt: NOW - 11 * DAY, useCount: 1 },
  },
  peerDecryptGrants: {
    [FRIEND]: { methods: ['nip44_decrypt'], createdAt: NOW - 10 * DAY, useCount: 2 },
  },
  previousClientPubkeys: [],
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

/** Fields every `settings-store` row of 0.1.2 held: the whole `partialize`, G/settingsStore.ts:424. */
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
  // `acceptLegalDocuments`, G/settingsStore.ts:315: the revisions are sha-256 of the documents.
  legalAcceptance: {
    termsRevision: hex64('7a'),
    privacyRevision: hex64('7b'),
    acceptedAt: new Date(NOW - 20 * DAY).toISOString(),
  },
  hasSeenOnboarding: true,
  quickAccessP2PK: true,
  regenerateP2PKOnReceive: false,
  sendLocationEnabled: true,
  fileLoggingEnabled: false,
  minTransferThreshold: 21,
  middlemanRouting: {
    maxHops: 3,
    maxFee: 8,
    minSuccessRate: 0.95,
    requireLastOk: true,
    trustMode: 'allow_untrusted',
  },
  naggTierEnabled: true,
  primalTierEnabled: true,
  relayTierEnabled: true,
};

const SOCIAL_A0 = {
  contactsTags: [
    ['p', FRIEND],
    ['p', A1, RELAY, 'second'],
  ],
  contactsContent: '',
  contactsUpdatedAt: Math.floor((NOW - 6 * DAY) / 1000),
  followingPubkeys: { [FRIEND]: true, [A1]: true },
  engagementByEventId: {
    [NOTE]: {
      liked: { ownEventId: OWN_REACTION },
      replied: {},
      updatedAt: Math.floor((NOW - 6 * DAY) / 1000),
    },
  },
  deletedRepostOriginalIds: { [hex64('d1')]: NOW - 30 * DAY },
  deletedNoteIds: { [hex64('d2')]: NOW - 31 * DAY },
  optimisticFollowsByPubkey: {},
  optimisticLikesByEventId: {},
  optimisticRepostsByEventId: {},
  optimisticZapsByEventId: {},
  zappedByEventId: { [NOTE]: { totalSats: 210, updatedAt: NOW - 6 * DAY } },
};

const emptySocial = (following: string) => ({
  contactsTags: [['p', following]],
  contactsContent: '',
  contactsUpdatedAt: Math.floor((NOW - 2 * DAY) / 1000),
  followingPubkeys: { [following]: true },
  engagementByEventId: {},
  deletedRepostOriginalIds: {},
  deletedNoteIds: {},
  optimisticFollowsByPubkey: {},
  optimisticLikesByEventId: {},
  optimisticRepostsByEventId: {},
  optimisticZapsByEventId: {},
  zappedByEventId: {},
});

/** P/mintStore.ts:151, version 2. */
const mintStore = (selectedMint: string, more: object = {}) =>
  zustandRow(2, {
    selectedMint,
    activeUnit: 'sat',
    standingQuotes: {},
    receiveMintByMethod: {},
    creqP2pkLock: false,
    creqExcludedMints: {},
    ...more,
  });

/** L/nostr/secureStorage.ts:31 (`CachedDerivedKeys`), written by `storeDerivedKeys` :501. */
const derivedKeys = (account: (typeof ACCOUNTS)[number]) =>
  JSON.stringify({
    npub: account.npub,
    nsec: account.nsec,
    pubkey: account.pubkey,
    privateKeyHex: account.privateKeyHex,
    mnemonicHash: PHRASE_HASH,
  });
/** `storeCashuMnemonic`, L/nostr/secureStorage.ts:512. */
const cashuMnemonic = (value: string) => JSON.stringify({ value, mnemonicHash: PHRASE_HASH });
/** `storeCashuSeed`, L/nostr/secureStorage.ts:543, called from L/cashu/manager.ts:481. */
const cashuSeed = (hex: string) => JSON.stringify({ hex, mnemonicHash: PHRASE_HASH });

const REDUX_ROW = 'persist:SOVRAN';

export const fixture: ReleaseFixture = {
  epoch: 'E19',
  versions: ['0.1.2', '0.1.3'],
  commit: '148ebd085',
  surface:
    'App under app/; profile-store and theme-store version 2, settings-store version 4; relay-metadata-store',
  asyncStorage: {
    // ── Left by 0.1.0 and 0.1.1 ───────────────────────────────────────────────
    // The redux store those releases still mounted (`redux/store/store.deprecated.ts:593@88fad9741`,
    // key `SOVRAN`, version 251) wrote its reducers' starting state on a new
    // install: no phrase, no proofs. 0.1.2 has no redux and never touched the
    // row. The bundled `search` sample (`redux/store/migrationTest.deprecated.ts@88fad9741`)
    // is left out to keep the row small.
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
    // L/migrations/globalMigrations.ts:219 (the three ids), :239 (sorted array).
    'global-migrations-completed': [
      'index-to-pubkey-keys-v2',
      'legacy-global-theme-to-profile-v1',
      'wallet-lifecycle-stamp-existing-users-v1',
    ],

    // ── Global stores ─────────────────────────────────────────────────────────
    // G/profileStore.ts:253, version 2 (:127). An imported row carries `source`
    // and `externalChain: 1` (`addProfile` :185-:196); balances and kind-0 names
    // come from `updateProfileBalance` :224 and `updateProfileMetadata` :233.
    'profile-store': zustandRow(2, {
      activeAccountIndex: 1,
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
    }),
    // G/settingsStore.ts:383, version 4 (:393).
    'settings-store': zustandRow(4, SETTINGS),
    // G/walletLifecycleStore.ts:61, version 1. A wallet made on this device:
    // `markSeedCreatedNow` :52, then `not-needed`.
    'wallet-lifecycle': zustandRow(1, {
      seedCreatedAt: INSTALLED,
      restoreStatus: 'not-needed',
      lastRestoreAt: null,
      lastRestoreError: null,
    }),
    // G/pricelistStore.ts:102, version 1; `setBtcPrices` :65.
    'pricelist-store': zustandRow(1, {
      pricelist: { usd: { btc: 64_250.5 }, eur: { btc: 59_010.25 }, gbp: { btc: 50_880 } },
      lastUpdated: NOW - 600_000,
    }),
    // G/btcMapStore.ts:315, version 1. Both caches hold the API's rows as they came (:130, :137).
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
    // G/mempoolAddressCache.ts:104, version 1; stats are `MempoolAddressStatsSchema`
    // (`wallet/src/chain/mempool.ts:51`).
    'mempool-address-cache': zustandRow(1, {
      byAddress: {
        bc1qfixtureaddress0000000000000000000000000: {
          stats: {
            address: 'bc1qfixtureaddress0000000000000000000000000',
            chain_stats: {
              tx_count: 1,
              funded_txo_count: 1,
              funded_txo_sum: 25_000,
              spent_txo_count: 0,
              spent_txo_sum: 0,
            },
            mempool_stats: {
              tx_count: 0,
              funded_txo_count: 0,
              funded_txo_sum: 0,
              spent_txo_count: 0,
              spent_txo_sum: 0,
            },
          },
          fetchedAt: NOW - 4 * DAY,
        },
      },
    }),
    // G/mintMetadataStore.ts:318, version 1; entry :100. `legacyMigrated` is true
    // once the four older caches were folded in (:327).
    'mint-metadata-store': zustandRow(1, {
      byMintUrl: {
        [MINT]: {
          displayName: 'Minibits',
          iconUrl: 'https://mint.minibits.cash/icon.png',
          description: 'Fixture description of a mint',
          supportedUnits: ['sat'],
          nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false } },
          identityAt: NOW - DAY,
          averageScore: 4.6,
          reviewCount: 31,
          favouriteCount: 12,
          reviewsAt: NOW - DAY,
          auditScore: 0.98,
          auditState: 'OK',
          nMints: 120,
          nMelts: 118,
          nErrors: 2,
          auditAt: NOW - DAY,
          contactFollowers: 4,
          contactReputation: 0.8,
          socialAt: NOW - DAY,
        },
        [MINT_B]: { displayName: 'Coinos', supportedUnits: ['sat'], identityAt: NOW - 8 * DAY },
      },
      legacyMigrated: true,
    }),
    // G/relayMetadataStore.ts:122, version 1; entry :53, `info` is NIP-11 (`L/nostr/nip11.ts:34`).
    'relay-metadata-store': zustandRow(1, {
      byRelayUrl: {
        [RELAY]: {
          info: {
            name: 'damus.io',
            description: 'Fixture relay description',
            pubkey: null,
            contact: null,
            software: 'git+https://github.com/hoytech/strfry.git',
            version: '1.0.4',
            supported_nips: [1, 2, 4, 9, 11, 40, 42, 70],
          },
          fetchedAt: NOW - DAY,
        },
        'wss://relay.offline.example': { failedAt: NOW - DAY },
      },
    }),
    // G/wallpaperStore.ts:294, version 1; entries are the catalog's own rows
    // (`@sovranbitcoin/schemas` 2.2.0 `WallpaperCatalogEntry`), downloads add
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
    // Query caches kept in AsyncStorage under their bare name (`hostScoped`):
    // L/cache/createQueryCacheStore.ts:171 (version 1, entry :76),
    // L/profile/ownProfileStatsStore.ts:14, F/mint/data/mintChangesCache.ts:17.
    'own-profile-stats-cache': zustandRow(1, {
      byKey: {
        [A0]: { data: { followers: 12, follows: 2 }, fetchedAt: NOW - DAY, viewerKey: A0 },
        [A1]: { data: { followers: 1, follows: 1 }, fetchedAt: NOW - DAY, viewerKey: A1 },
      },
    }),
    'mint-changes-cache': zustandRow(1, {
      byKey: {
        global: {
          // `MintChangesResponse`, L/apiClient.ts:124.
          data: {
            trackedMints: 180,
            reachableMints: 171,
            totalChanges: 1,
            changes: [
              {
                mintUrl: MINT_B,
                name: 'Coinos',
                at: Math.floor((NOW - 2 * DAY) / 1000),
                hash: hex64('c7'),
                summary: ['motd changed'],
              },
            ],
          },
          fetchedAt: NOW - DAY,
          viewerKey: '',
        },
      },
    }),

    // ── Account 0 ─────────────────────────────────────────────────────────────
    [accountKey('mint-store', A0)]: mintStore(MINT, {
      activeUnit: 'usd',
      standingQuotes: { [`${MINT}|sat|bolt12`]: 'standing-quote-fixture-1' },
      receiveMintByMethod: { bolt12: MINT },
      creqP2pkLock: true,
      creqExcludedMints: { [MINT_C]: true },
    }),
    // P/npcMintStore.ts:101, version 2.
    [accountKey('npc-mint-store', A0)]: zustandRow(2, { mintUrl: MINT }),
    // P/themeStore.ts:97, version 2 (`PersistedThemeStore`, `@sovranbitcoin/schemas` 2.2.0).
    [accountKey('theme-store', A0)]: zustandRow(2, {
      activeAlbumSlug: 'northern-lights',
      unitWallpapers: { sat: 'aurora-01' },
      mode: 'light',
    }),
    // P/scanHistoryStore.ts:203, version 1; entry :31, ids from `mintLocalId('scan')` (L/id.ts:16).
    [accountKey('scan-history-store', A0)]: zustandRow(1, { entries: [SCAN_A0, SCAN_A0_OLDER] }),
    // P/searchHistoryStore.ts:98, version 1.
    [accountKey('search-history-store', A0)]: zustandRow(1, {
      recentSearches: {
        contacts: [
          { query: 'fixture friend', timestamp: NOW - 2 * DAY, context: 'contacts' },
          { query: 'jack', timestamp: NOW - 9 * DAY, context: 'contacts' },
        ],
      },
    }),
    // P/dataMigrationStore.ts:36, version 1. One step existed
    // (L/migrations/dataMigrations.ts:40), so a migrated account holds level 1.
    [accountKey('data-migration-store', A0)]: zustandRow(1, { level: 1 }),
    // P/sendReachabilityStore.ts:93, version 1.
    [accountKey('send-reachability-store', A0)]: zustandRow(1, {
      byTransactionId: {
        [TX]: { status: 'mint-reachable', mintUrl: MINT, updatedAt: NOW - 3 * DAY },
      },
    }),
    // P/transactionLocationStore.ts:76, version 1.
    [accountKey('transaction-location-store', A0)]: zustandRow(1, {
      locations: {
        [TX_HISTORY]: { latitude: 51.5072, longitude: -0.1276, createdAt: NOW - 3 * DAY },
      },
    }),
    // P/transactionAnnotationStore.ts:50, version 1: string fields per transaction key.
    [accountKey('transaction-annotation-store', A0)]: zustandRow(1, {
      annotations: {
        [TX_HISTORY]: { distributionSource: 'share', note: 'coffee with the fixture' },
      },
    }),
    // P/transactionDistributionStore.ts:135, version 1.
    [accountKey('transaction-distribution-store', A0)]: zustandRow(1, {
      distributions: { [TX_HISTORY]: { source: 'share', recordedAt: NOW - 3 * DAY } },
    }),
    // P/routstrStore.ts:666, version 1. No `nodeBaseUrl`: this account used the built-in node.
    [accountKey('routstr-store', A0)]: zustandRow(1, {
      apiKey: ROUTSTR_KEY_A0,
      balance: 41_500,
      selectedModel: 'openai/gpt-4o-mini',
      sessions: [SESSION_A0],
      currentSessionId: SESSION_A0.id,
      lastKnownLineup: null,
      nodeBaseUrl: null,
    }),
    // P/nostrSocialStore.ts:694, version 2.
    [accountKey('nostr-social-store', A0)]: zustandRow(2, SOCIAL_A0),
    // P/swapTransactionsStore.ts:299, version 1.
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
    // P/mintDistributionStore.ts:466, version 1: basis points per mint, per unit.
    [accountKey('mint-distribution-store', A0)]: zustandRow(1, {
      distributions: { sat: { [MINT]: 7000, [MINT_B]: 3000 } },
    }),
    // P/nutDropRedeemQueueStore.ts:211, version 1.
    [accountKey('nut-drop-redeem-queue', A0)]: zustandRow(1, {
      byTokenHash: {
        [hex64('a7')]: {
          token: 'cashuBfixturenutdroptoken',
          mintUrl: MINT_C,
          amount: 21,
          unit: 'sat',
          status: 'untrusted-mint',
          attempts: 1,
          nextAttemptAt: NOW - DAY,
          receivedAt: NOW - DAY,
          senderPeerID: 'a1b2c3d4e5f60718',
        },
      },
    }),
    // P/ownContentStore.ts:177, version 1.
    [accountKey('own-content-store', A0)]: zustandRow(1, {
      byId: {
        [OWN_NOTE]: {
          event: OWN_EVENT,
          authorPubkey: A0,
          status: 'confirmed',
          updatedAt: NOW - 4 * DAY,
        },
      },
    }),
    // P/ownedMediaStore.ts:164, version 1; key is `<host>|<sha256>` (:36).
    [accountKey('owned-media-store', A0)]: zustandRow(1, {
      byBlob: {
        [`blossom.primal.net|${BLOB_SHA}`]: {
          sha256: BLOB_SHA,
          url: `https://blossom.primal.net/${BLOB_SHA}.jpg`,
          host: 'blossom.primal.net',
          mimeType: 'image/jpeg',
          sourceNoteIds: [OWN_NOTE],
          firstSeen: NOW - 4 * DAY,
          lastSeen: NOW - 4 * DAY,
          deleteState: 'live',
        },
      },
    }),
    // P/recentPeopleStore.ts:156, version 1.
    [accountKey('recent-people-store', A0)]: zustandRow(1, {
      entries: [
        {
          pubkey: FRIEND,
          firstOpenedAt: NOW - 9 * DAY,
          lastOpenedAt: NOW - 2 * DAY,
          reason: 'search',
          displayName: 'Fixture Friend',
        },
      ],
    }),
    // G/nostrMetadataCache.ts:120, version 1, kept per account (:122).
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
    // F/feed/stores/ignoreStore.ts:176, version 1.
    [accountKey('feed-ignore-store', A0)]: zustandRow(1, {
      ignoredPubkeys: [STRANGER],
      ignoredEventIds: [hex64('1e')],
      muteList: {
        id: MUTE_LIST_EVENT,
        createdAt: Math.floor((NOW - 7 * DAY) / 1000),
        tags: [['p', STRANGER]],
        privateTags: [['word', 'airdrop']],
      },
      blockOverrides: { [STRANGER]: true },
      dmFilterEnabled: true,
      dmFilterWords: ['airdrop', 'giveaway'],
    }),
    // F/feed/stores/notificationPolicyStore.ts:66, version 1.
    [accountKey('notification-policy-store', A0)]: zustandRow(1, {
      policy: 'STRICT',
      replyScope: 'THREAD',
    }),
    // F/nostrSigner/data/nip46ConnectionsStore.ts:677, version 1; connection :86.
    [accountKey('nip46-connections-store', A0)]: zustandRow(1, {
      apps: { [SIGNER_APP]: SIGNER_CONNECTION },
    }),
    // F/nostrSigner/data/nip46ActivityStore.ts:152, version 1; entry :56.
    [accountKey('nip46-activity-store', A0)]: zustandRow(1, {
      entries: [
        {
          id: `activity-${NOW - 2 * DAY}-1`,
          clientPubkey: SIGNER_APP,
          method: 'sign_event',
          kind: 1,
          verdict: 'auto_approved_grant',
          summary: { headline: 'Posted a note', line: 'gm from the fixture', refPubkey: A0 },
          contentPreview: 'gm from the fixture',
          eventId: OWN_NOTE,
          at: NOW - 2 * DAY,
        },
      ],
    }),
    // L/nostr/media/mediaServerStore.ts:41, version 1.
    [accountKey('nostr-media-server-store', A0)]: zustandRow(1, {
      server: 'https://nostr.build',
    }),
    // L/nostr/outbox/relayListStore.ts:116, version 1.
    [accountKey('nostr-relay-list-store', A0)]: zustandRow(1, {
      entries: [
        { url: RELAY, read: true, write: true },
        { url: 'wss://nos.lol', read: true, write: false },
      ],
      updatedAt: Math.floor((NOW - 14 * DAY) / 1000),
      hasPublished: true,
      source: 'relay',
    }),
    // F/bitchat/stores/bitchatDmMessages.ts:266, version 1; message :105.
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
    // Lightning-address cursor: L/cashu/npc.ts:63 (a number as text), key :82.
    [`npc_since:profile:${A0}`]: String(Math.floor((NOW - DAY) / 1000)),

    // ── Account 1, the one in use ─────────────────────────────────────────────
    [accountKey('mint-store', A1)]: mintStore(MINT_B),
    [accountKey('theme-store', A1)]: zustandRow(2, {
      activeAlbumSlug: null,
      unitWallpapers: { sat: 'sunset' },
      mode: 'dark',
    }),
    [accountKey('scan-history-store', A1)]: zustandRow(1, { entries: [SCAN_A1] }),
    [accountKey('data-migration-store', A1)]: zustandRow(1, { level: 1 }),
    // This account's node was named by the server lineup (`setServerLineup`, P/routstrStore.ts:232).
    [accountKey('routstr-store', A1)]: zustandRow(1, {
      apiKey: ROUTSTR_KEY_A1,
      balance: 9_000,
      selectedModel: null,
      sessions: [SESSION_A1],
      currentSessionId: SESSION_A1.id,
      lastKnownLineup: null,
      nodeBaseUrl: ROUTSTR_NODE_A1,
    }),
    [accountKey('nostr-social-store', A1)]: zustandRow(2, emptySocial(A0)),
    [accountKey('notification-policy-store', A1)]: zustandRow(1, {
      policy: 'FOLLOWS',
      replyScope: 'DIRECT',
    }),
    [accountKey('nostr-relay-list-store', A1)]: zustandRow(1, {
      entries: [{ url: 'wss://relay.primal.net', read: true, write: true }],
      updatedAt: 0,
      hasPublished: false,
      source: 'local',
    }),
    [`npc_since:profile:${A1}`]: String(Math.floor((NOW - 2 * DAY) / 1000)),

    // ── The imported account ──────────────────────────────────────────────────
    [accountKey('mint-store', IMP)]: mintStore(MINT_C, { activeUnit: 'eur' }),
    [accountKey('theme-store', IMP)]: zustandRow(2, {
      activeAlbumSlug: null,
      unitWallpapers: {},
      mode: 'light',
    }),
    [accountKey('scan-history-store', IMP)]: zustandRow(1, { entries: [SCAN_IMPORTED] }),
    [accountKey('data-migration-store', IMP)]: zustandRow(1, { level: 1 }),
    [accountKey('nostr-social-store', IMP)]: zustandRow(2, emptySocial(FRIEND)),
  },
  secureStore: {
    // L/nostr/secureStorage.ts:15 (the key names), :246 (`storeMnemonic`).
    user_mnemonic: PHRASE,
    derived_keys_0: derivedKeys(ACCOUNTS[0]),
    cashu_mnemonic_0: cashuMnemonic(ACCOUNTS[0].cashuMnemonic),
    cashu_seed_0: cashuSeed(CASHU_SEED_HEX[0]),
    derived_keys_1: derivedKeys(ACCOUNTS[1]),
    cashu_mnemonic_1: cashuMnemonic(ACCOUNTS[1].cashuMnemonic),
    cashu_seed_1: cashuSeed(CASHU_SEED_HEX[1]),
    // An imported account keeps its nsec by public key (`storeImportedNsec` :589,
    // from `app/shared/blocks/DrawerProfileChrome.tsx:99`) and no `derived_keys_`
    // row; its Cashu caches sit under its account index
    // (`app/shared/providers/NostrKeysProvider.tsx:359`, L/cashu/manager.ts:481).
    [`imported_nsec_${IMP}`]: IMPORTED.nsec,
    [`cashu_mnemonic_${IMP_INDEX}`]: cashuMnemonic(IMP_CASHU_MNEMONIC),
    [`cashu_seed_${IMP_INDEX}`]: cashuSeed(CASHU_SEED_HEX.imported),
    // Written by 0.1.0 and 0.1.1 for each account they opened, the imported one under its index
    // (`shared/blocks/MigrationGate.tsx:37@4203ea8ec`, `setMigrationsComplete`
    // `shared/lib/nostr/secureStorage.ts:598@4203ea8ec`); 0.1.2 only deletes them (:578).
    migrations_complete_0: 'true',
    migrations_complete_1: 'true',
    [`migrations_complete_${IMP_INDEX}`]: 'true',
    // Every key `secureSet` wrote, in order (:95, `rememberKey` :128).
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
  // L/cashu/manager.ts (`coco.db` / `coco-<index>.db`), app/shared/providers/NostrNDKProvider.tsx
  // (`nostr` / `nostr-<index>`): pinned in `__tests__/fixtures/persisted-surface-v0.1.3.json`.
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
    activeAccountIndex: 1,
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
        what: 'the legal revisions that were accepted',
        store: 'settings-store',
        path: ['legalAcceptance'],
        equals: SETTINGS.legalAcceptance,
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
      {
        what: 'the cached on-chain address totals',
        store: 'mempool-address-cache',
        path: [
          'byAddress',
          'bc1qfixtureaddress0000000000000000000000000',
          'stats',
          'chain_stats',
          'funded_txo_sum',
        ],
        equals: 25_000,
      },
      {
        what: 'the cached name of a mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT, 'displayName'],
        equals: 'Minibits',
      },
      {
        what: 'the cached review score of a mint',
        store: 'mint-metadata-store',
        path: ['byMintUrl', MINT, 'averageScore'],
        equals: 4.6,
      },
      {
        what: 'that the older mint caches were already folded in',
        store: 'mint-metadata-store',
        path: ['legacyMigrated'],
        equals: true,
      },
      {
        what: 'the cached relay information',
        store: 'relay-metadata-store',
        path: ['byRelayUrl', RELAY, 'info', 'name'],
        equals: 'damus.io',
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
        what: 'the cached follower counts of its own accounts',
        store: 'own-profile-stats-cache',
        path: ['byKey', A0, 'data'],
        equals: { followers: 12, follows: 2 },
      },
      {
        what: 'the cached mint changes',
        store: 'mint-changes-cache',
        path: ['byKey', 'global', 'data', 'changes', 0, 'mintUrl'],
        equals: MINT_B,
      },
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
        what: 'the display unit of account 0',
        store: 'mint-store',
        accountIndex: 0,
        path: ['activeUnit'],
        equals: 'usd',
      },
      {
        what: 'the reusable receive quote of account 0',
        store: 'mint-store',
        accountIndex: 0,
        path: ['standingQuotes', `${MINT}|sat|bolt12`],
        equals: 'standing-quote-fixture-1',
      },
      {
        what: 'the receive mint per method of account 0',
        store: 'mint-store',
        accountIndex: 0,
        path: ['receiveMintByMethod', 'bolt12'],
        equals: MINT,
      },
      {
        what: 'the payment-request lock setting of account 0',
        store: 'mint-store',
        accountIndex: 0,
        path: ['creqP2pkLock'],
        equals: true,
      },
      {
        what: 'the mint account 0 left out of payment requests',
        store: 'mint-store',
        accountIndex: 0,
        path: ['creqExcludedMints', MINT_C],
        equals: true,
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
        what: 'that the side-data import already ran for account 0',
        store: 'data-migration-store',
        accountIndex: 0,
        path: ['level'],
        equals: 1,
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
        what: 'the note on a transaction of account 0',
        store: 'transaction-annotation-store',
        accountIndex: 0,
        path: ['annotations', TX_HISTORY, 'note'],
        equals: 'coffee with the fixture',
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
        what: 'the zap total account 0 sent to a note',
        store: 'nostr-social-store',
        accountIndex: 0,
        path: ['zappedByEventId', NOTE, 'totalSats'],
        equals: 210,
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
        what: 'the unredeemed nearby token of account 0',
        store: 'nut-drop-redeem-queue',
        accountIndex: 0,
        path: ['byTokenHash', hex64('a7'), 'token'],
        equals: 'cashuBfixturenutdroptoken',
      },
      {
        what: 'the own note of account 0',
        store: 'own-content-store',
        accountIndex: 0,
        path: ['byId', OWN_NOTE, 'event'],
        equals: OWN_EVENT,
      },
      {
        what: 'the uploaded media of account 0',
        store: 'owned-media-store',
        accountIndex: 0,
        path: ['byBlob', `blossom.primal.net|${BLOB_SHA}`, 'deleteState'],
        equals: 'live',
      },
      {
        what: 'the recently opened people of account 0',
        store: 'recent-people-store',
        accountIndex: 0,
        path: ['entries', 0, 'pubkey'],
        equals: FRIEND,
      },
      {
        what: 'the cached profile of a contact of account 0',
        store: 'nostr-metadata-cache',
        accountIndex: 0,
        path: ['byPubkey', FRIEND, 'displayName'],
        equals: 'Fixture Friend',
      },
      {
        what: 'who account 0 hides from its feed',
        store: 'feed-ignore-store',
        accountIndex: 0,
        path: ['ignoredPubkeys'],
        equals: [STRANGER],
      },
      {
        what: 'the mute list of account 0',
        store: 'feed-ignore-store',
        accountIndex: 0,
        path: ['muteList', 'id'],
        equals: MUTE_LIST_EVENT,
      },
      {
        what: 'the message filter words of account 0',
        store: 'feed-ignore-store',
        accountIndex: 0,
        path: ['dmFilterWords'],
        equals: ['airdrop', 'giveaway'],
      },
      {
        what: 'that the message filter of account 0 is on',
        store: 'feed-ignore-store',
        accountIndex: 0,
        path: ['dmFilterEnabled'],
        equals: true,
      },
      {
        what: 'the notification policy of account 0',
        store: 'notification-policy-store',
        accountIndex: 0,
        path: ['policy'],
        equals: 'STRICT',
      },
      {
        what: 'the reply scope of account 0',
        store: 'notification-policy-store',
        accountIndex: 0,
        path: ['replyScope'],
        equals: 'THREAD',
      },
      {
        what: 'the app connected to the signer of account 0',
        store: 'nip46-connections-store',
        accountIndex: 0,
        path: ['apps', SIGNER_APP, 'name'],
        equals: 'Fixture Client',
      },
      {
        what: 'the standing permission of that app',
        store: 'nip46-connections-store',
        accountIndex: 0,
        path: ['apps', SIGNER_APP, 'grants', 'sign_event:1', 'verdict'],
        equals: 'always',
      },
      {
        what: 'the standing refusal for that app',
        store: 'nip46-connections-store',
        accountIndex: 0,
        path: ['apps', SIGNER_APP, 'grants', 'sign_event:7', 'verdict'],
        equals: 'deny',
      },
      {
        what: 'the signer activity of account 0',
        store: 'nip46-activity-store',
        accountIndex: 0,
        path: ['entries', 0, 'eventId'],
        equals: OWN_NOTE,
      },
      {
        what: 'the media server of account 0',
        store: 'nostr-media-server-store',
        accountIndex: 0,
        path: ['server'],
        equals: 'https://nostr.build',
      },
      {
        what: 'the relay list of account 0',
        store: 'nostr-relay-list-store',
        accountIndex: 0,
        path: ['entries'],
        equals: [
          { url: RELAY, read: true, write: true },
          { url: 'wss://nos.lol', read: true, write: false },
        ],
      },
      {
        what: 'that the relay list of account 0 was published',
        store: 'nostr-relay-list-store',
        accountIndex: 0,
        path: ['hasPublished'],
        equals: true,
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
        what: 'that the side-data import already ran for account 1',
        store: 'data-migration-store',
        accountIndex: 1,
        path: ['level'],
        equals: 1,
      },
      {
        what: 'the Routstr key of account 1',
        store: 'routstr-store',
        accountIndex: 1,
        path: ['apiKey'],
        equals: ROUTSTR_KEY_A1,
      },
      {
        what: 'the Routstr node of account 1',
        store: 'routstr-store',
        accountIndex: 1,
        path: ['nodeBaseUrl'],
        equals: ROUTSTR_NODE_A1,
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
      {
        what: 'the notification policy of account 1',
        store: 'notification-policy-store',
        accountIndex: 1,
        path: ['policy'],
        equals: 'FOLLOWS',
      },
      {
        what: 'the relay list of account 1',
        store: 'nostr-relay-list-store',
        accountIndex: 1,
        path: ['entries', 0, 'url'],
        equals: 'wss://relay.primal.net',
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
        what: 'the display unit of the imported account',
        store: 'mint-store',
        accountIndex: IMP_INDEX,
        path: ['activeUnit'],
        equals: 'eur',
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
        what: 'that the side-data import already ran for the imported account',
        store: 'data-migration-store',
        accountIndex: IMP_INDEX,
        path: ['level'],
        equals: 1,
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
    // Signer activity is kept for 30 days and this fixture's clock is fixed, so
    // its one entry is always past that age. 0.1.2 dropped it the same way
    // (`pruneExpired`, F/nostrSigner/data/nip46ActivityStore.ts:115).
    {
      what: 'nip46-activity-store',
      followUp: 'accepted',
      why: 'Signer activity older than 30 days is dropped on load, as 0.1.2 did; the fixture entry is older.',
    },
    {
      what: 'the signer activity of account 0',
      followUp: 'accepted',
      why: 'Signer activity older than 30 days is dropped on load, as 0.1.2 did; the fixture entry is older.',
    },
    // Both rows load on the first launch. Every query cache, these two shared
    // ones included, is then emptied when the account changes
    // (`registerAccountScoped`, app/shared/lib/cache/createQueryCacheStore.ts:416),
    // and the empty cache is saved. Both are fetched again from the network.
    {
      what: 'own-profile-stats-cache',
      followUp: 'accepted',
      why: 'Query caches are emptied on every account switch and fetched again; nothing the user made is in them.',
    },
    {
      what: 'the cached follower counts of its own accounts',
      followUp: 'accepted',
      why: 'Query caches are emptied on every account switch and fetched again; nothing the user made is in them.',
    },
    {
      what: 'mint-changes-cache',
      followUp: 'accepted',
      why: 'Query caches are emptied on every account switch and fetched again; nothing the user made is in them.',
    },
    {
      what: 'the cached mint changes',
      followUp: 'accepted',
      why: 'Query caches are emptied on every account switch and fetched again; nothing the user made is in them.',
    },
  ],
};
