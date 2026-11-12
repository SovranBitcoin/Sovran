import { fixture as previous } from './E19-0.1.2';
import upgraded from './E20-0.1.4.upgraded.json';
import records from './E20-0.1.4.records.json';
import { ACCOUNTS, PHRASE_HASH, accountKey, zustandRow } from './format';
import type { ReleaseFixture } from './format';

const A0 = ACCOUNTS[0].pubkey;
const A1 = ACCOUNTS[1].pubkey;
const MINT = 'https://mint.example/Bitcoin';
const TESTNUT = 'https://testnut.cashu.space';

const disk: Readonly<Record<string, unknown>> = upgraded.asyncStorage;

/** A row of the upgraded disk with the fields 0.1.4 adds given values. */
function withState(key: string, added: object): { state: object; version: number } {
  const row = disk[key] as { state: object; version: number };
  return zustandRow(row.version, { ...row.state, ...added });
}

/**
 * Rows this build's own code wrote outside the store registry, on top of the
 * upgraded disk: a Whitenoise group state and DM index entry, the
 * nearby-payment journal and one Routstr SDK recovery record in their secure
 * vaults, and the vault index those writes updated. `E20-0.1.4.records.json`;
 * regenerate it with `WRITE_E20_RECORDS=1 bun run test --
 * __tests__/releaseFixtureE20Records.test.ts --runInBand` while 0.1.4 is
 * unreleased, never after. That test also reads them back after the launch.
 */
const written: { asyncStorage: Record<string, string>; secureStore: Record<string, string> } =
  records;
const keptWritten = (keys: Record<string, string>) =>
  Object.keys(keys).filter((key) => key !== 'secure_key_index');

const PROFILES = (disk['profile-store'] as { state: { profiles: { accountIndex: number }[] } })
  .state.profiles;
const IMPORTED_INDEX = 112_058_190;
const SWAP_GROUP = 'swap-1788422400000-1';
const SWAP_A0 = disk[accountKey('swap-transactions-store', A0)] as {
  state: { groups: Record<string, { legs: object[] }> };
  version: number;
};
const SWAP_GROUP_A0 = {
  ...SWAP_A0.state.groups[SWAP_GROUP],
  legs: [{ ...SWAP_A0.state.groups[SWAP_GROUP].legs[0], mintOperationId: 'mint-op-fixture-1' }],
};

const LAST_KNOWN_VERSION = { version: '0.1.5', minVersion: '0.1.2', fetchedAt: 1_790_000_000_000 };
const PROVIDER = {
  baseUrl: 'https://node.example',
  name: 'Fixture node',
  pubkey: 'c'.repeat(64),
  followers: 12,
  followersSource: 'graph',
  modelCount: 3,
  encryptedModelCount: 1,
  minMessageSats: 2,
  mints: [MINT],
  status: 'online',
  latencyMs: 180,
};
const LAST_MESSAGE = { protocol: 'nip17', atSeconds: 1_789_900_000, isOwn: true };
const OLD_QUOTE = {
  mintUrl: MINT,
  amount: 21,
  unit: 'sat',
  status: 'nothing-to-claim',
  attempts: 1,
  nextAttemptAt: 0,
};
const OWN_PROFILE = {
  content: { name: 'Fixture', about: 'Written by the release fixture.' },
  createdAt: 1_789_000_000,
  eventId: 'e'.repeat(64),
};
const VERTEX_BUDGET = zustandRow(1, { day: '2026-10-01', used: 3 });
/**
 * Signer activity older than 30 days is dropped on load, so a dated entry
 * would age out of this test. This one is from a phone whose clock was set to
 * 2100: the entry is read back for as long as the test is run.
 */
const SIGNER_ACTIVITY = {
  id: 'activity-4102444800000-1',
  clientPubkey: 'd'.repeat(64),
  method: 'sign_event',
  kind: 1,
  verdict: 'auto_approved_grant',
  summary: { headline: 'Posted a note', line: 'gm from the fixture', refPubkey: A0 },
  contentPreview: 'gm from the fixture',
  eventId: 'f'.repeat(64),
  at: 4_102_444_800_000,
};

/** What 0.1.2 held that this build is known not to keep; those facts stay with E19. */
const notKept = new Set(previous.knownGaps.map((gap) => gap.what));

/**
 * E20: 0.1.4, the release candidate. Set `commit` to the release commit when
 * it is cut.
 *
 * The disk is `E20-0.1.4.upgraded.json`: what this build's own persist and
 * SecureStore code left after starting three times over the 0.1.2 fixture,
 * with every account opened. That gives each store 0.1.2 had its 0.1.4 row,
 * the Routstr key its secure vault and the BTCMap cache its file. Regenerate
 * it with `WRITE_UPGRADED_DISK=E19-0.1.2:E20-0.1.4 bun run release-fixture:upgrade`
 * while 0.1.4 is unreleased, never after.
 *
 * Written here by hand, from the stores at this commit: the fields 0.1.4 adds
 * to a store 0.1.2 had, and a row for each store 0.1.4 adds.
 */
export const fixture: ReleaseFixture = {
  epoch: 'E20',
  versions: ['0.1.4'],
  commit: '5651d4720',
  surface:
    'Routstr version 3 and its secure vault; BTCMap in a cache file; unreadable blobs kept aside; new stores',
  asyncStorage: {
    ...disk,
    ...written.asyncStorage,
    // shared/stores/global/profileStore.ts:131,134@87b8afffe: every account's
    // wallet database was opened on this install (`setWalletDatabaseCreated`
    // :324); the imported account records `hashMnemonic` of the phone's phrase
    // (`recordWalletPhraseFingerprint` :273, imported rows only).
    'profile-store': withState('profile-store', {
      profiles: PROFILES.map((profile) => ({
        ...profile,
        walletDatabaseCreated: true,
        ...(profile.accountIndex === IMPORTED_INDEX
          ? { walletPhraseFingerprint: PHRASE_HASH }
          : {}),
      })),
    }),
    // shared/stores/profile/swapTransactionsStore.ts:162,279@87b8afffe: the
    // mint operation of a swap leg, tagged with its quote.
    [accountKey('swap-transactions-store', A0)]: zustandRow(SWAP_A0.version, {
      ...SWAP_A0.state,
      groups: { ...SWAP_A0.state.groups, [SWAP_GROUP]: SWAP_GROUP_A0 },
    }),
    // shared/stores/global/settingsStore.ts: PersistedSettings
    // shared/stores/profile/nutDropRedeemQueueStore.ts (`recoveredCopy`): which
    // set-aside copy of the queue was merged back in; none on this install.
    ...Object.fromEntries(
      Object.keys(disk)
        .filter((key) => key.startsWith('nut-drop-redeem-queue:profile:'))
        .map((key) => [key, withState(key, { recoveredCopy: null })])
    ),
    'settings-store': withState('settings-store', {
      lastKnownAppVersion: LAST_KNOWN_VERSION,
      vertexCreditsEnabled: false,
      primalHostsDisabled: ['wss://cache2.primal.net/v1'],
    }),
    // shared/stores/global/pricelistStore.ts: serverUpdatedAt
    'pricelist-store': withState('pricelist-store', { serverUpdatedAt: 1_789_199_340 }),
    // shared/stores/global/walletLifecycleStore.ts: recoveryPhraseVerified*
    'wallet-lifecycle': withState('wallet-lifecycle', {
      recoveryPhraseVerifiedAt: 1_789_000_000_000,
      recoveryPhraseVerifiedRevision: 1,
    }),
    // shared/stores/profile/aiProviderDirectoryStore.ts: PersistedAiProviderDirectory
    [accountKey('ai-provider-directory-store', A0)]: zustandRow(1, {
      providers: [PROVIDER],
      fetchedAt: 1_789_950_000_000,
    }),
    // shared/stores/global/ctaStore.ts: the schema in its persist options
    'cta-store': zustandRow(1, {
      dismissed: {
        'backup-recovery-phrase': { at: 1_789_100_000_000, revision: 1 },
        'claim-old-ecash:snooze': { at: 1_789_200_000_000, revision: 1, version: '0.1.4' },
      },
    }),
    // shared/stores/profile/dmLastMessageStore.ts: PersistedDmLastMessageStore
    [accountKey('dm-last-message-store', A0)]: zustandRow(1, { byPeer: { [A1]: LAST_MESSAGE } }),
    // shared/stores/global/legacyEcashStore.ts: PersistedLegacyEcash;
    // wallet/src/legacy-ecash/records.ts: LegacyQuoteRecordSchema
    'legacy-ecash-store': zustandRow(1, {
      groups: {},
      quotes: { ['4f'.repeat(32)]: OLD_QUOTE },
      rowRemoved: null,
    }),
    // shared/stores/global/mintTestnutStore.ts: PersistedMintTestnutStore
    'mint-testnut-store': zustandRow(1, {
      byMintUrl: {
        [TESTNUT]: { testnut: true, probedAt: 1_789_300_000_000, checkedAt: 1_789_300_000_000 },
        [MINT]: { testnut: false, checkedAt: 1_789_300_000_001 },
      },
    }),
    // shared/stores/profile/ownProfileMetadataStore.ts: the schema in its persist options
    [accountKey('own-profile-metadata-store', A0)]: zustandRow(1, {
      latest: OWN_PROFILE,
      history: { name: [{ value: 'An earlier name', createdAt: 1_788_000_000 }] },
    }),
    // features/nostrSigner/data/nip46ActivityStore.ts: as 0.1.2 wrote it (E19)
    [accountKey('nip46-activity-store', A0)]: zustandRow(1, { entries: [SIGNER_ACTIVITY] }),
    // shared/stores/profile/vertexBudgetStore.ts: schema. Made per account on
    // demand, so no store reads it at startup; it must be left as it is.
    [accountKey('vertex-budget-store', A0)]: VERTEX_BUDGET,
    [accountKey('vertex-budget-store', A1)]: zustandRow(1, { day: '2026-10-02', used: 1 }),
  },
  secureStore: { ...upgraded.secureStore, ...written.secureStore },
  files: upgraded.files,
  sqliteDatabases: previous.sqliteDatabases,
  survives: {
    ...previous.survives,
    facts: [
      ...previous.survives.facts
        .filter((fact) => !notKept.has(fact.what))
        // The group now holds the mint operation of its leg.
        .map((fact) =>
          fact.what === 'the swap history of account 0' ? { ...fact, equals: SWAP_GROUP_A0 } : fact
        ),
      {
        what: 'the newest version it was told of',
        store: 'settings-store',
        path: ['lastKnownAppVersion'],
        equals: LAST_KNOWN_VERSION,
      },
      {
        what: 'that reputation lookups were turned off',
        store: 'settings-store',
        path: ['vertexCreditsEnabled'],
        equals: false,
      },
      {
        what: 'the cache host that was turned off',
        store: 'settings-store',
        path: ['primalHostsDisabled'],
        equals: ['wss://cache2.primal.net/v1'],
      },
      {
        what: 'when the server last priced bitcoin',
        store: 'pricelist-store',
        path: ['serverUpdatedAt'],
        equals: 1_789_199_340,
      },
      {
        what: 'when the phrase was checked',
        store: 'wallet-lifecycle',
        path: ['recoveryPhraseVerifiedAt'],
        equals: 1_789_000_000_000,
      },
      {
        what: 'which backup flow checked the phrase',
        store: 'wallet-lifecycle',
        path: ['recoveryPhraseVerifiedRevision'],
        equals: 1,
      },
      {
        what: 'the AI provider list of account 0',
        store: 'ai-provider-directory-store',
        accountIndex: 0,
        path: ['providers', 0],
        equals: PROVIDER,
      },
      {
        what: 'when the AI provider list of account 0 was read',
        store: 'ai-provider-directory-store',
        accountIndex: 0,
        path: ['fetchedAt'],
        equals: 1_789_950_000_000,
      },
      {
        what: 'that the backup reminder was dismissed',
        store: 'cta-store',
        path: ['dismissed', 'backup-recovery-phrase'],
        equals: { at: 1_789_100_000_000, revision: 1 },
      },
      {
        what: 'that the old ecash reminder was put off',
        store: 'cta-store',
        path: ['dismissed', 'claim-old-ecash:snooze'],
        equals: { at: 1_789_200_000_000, revision: 1, version: '0.1.4' },
      },
      {
        what: 'the last message with a contact of account 0',
        store: 'dm-last-message-store',
        accountIndex: 0,
        path: ['byPeer', A1],
        equals: LAST_MESSAGE,
      },
      {
        what: 'the record of an old Lightning receive that was looked at',
        store: 'legacy-ecash-store',
        path: ['quotes', '4f'.repeat(32)],
        equals: OLD_QUOTE,
      },
      {
        what: 'that a mint was found to be a test mint',
        store: 'mint-testnut-store',
        path: ['byMintUrl', TESTNUT, 'testnut'],
        equals: true,
      },
      {
        what: 'that a mint was found not to be a test mint',
        store: 'mint-testnut-store',
        path: ['byMintUrl', MINT],
        equals: { testnut: false, checkedAt: 1_789_300_000_001 },
      },
      {
        what: 'what a signer app did for account 0',
        store: 'nip46-activity-store',
        accountIndex: 0,
        path: ['entries', 0],
        equals: SIGNER_ACTIVITY,
      },
      {
        what: 'the published profile of account 0',
        store: 'own-profile-metadata-store',
        accountIndex: 0,
        path: ['latest'],
        equals: OWN_PROFILE,
      },
      {
        what: 'an earlier name of account 0',
        store: 'own-profile-metadata-store',
        accountIndex: 0,
        path: ['history', 'name', 0, 'value'],
        equals: 'An earlier name',
      },
      ...PROFILES.map((profile, position) => ({
        what: `that the wallet database of account ${profile.accountIndex} was made here`,
        store: 'profile-store',
        path: ['profiles', position, 'walletDatabaseCreated'],
        equals: true,
      })),
      {
        what: 'which phrase the wallet of the imported account was made from',
        store: 'profile-store',
        path: [
          'profiles',
          PROFILES.findIndex((profile) => profile.accountIndex === IMPORTED_INDEX),
          'walletPhraseFingerprint',
        ],
        equals: PHRASE_HASH,
      },
      {
        what: 'the mint operation of a swap of account 0',
        store: 'swap-transactions-store',
        accountIndex: 0,
        path: ['groups', SWAP_GROUP, 'legs', 0, 'mintOperationId'],
        equals: 'mint-op-fixture-1',
      },
    ],
    keptAsyncStorage: [
      ...previous.survives.keptAsyncStorage,
      accountKey('vertex-budget-store', A0),
      accountKey('vertex-budget-store', A1),
      // Whitenoise keys its rows by account index; nothing reads them at startup.
      ...keptWritten(written.asyncStorage),
    ],
    // The journal and SDK vaults: nothing reads them at startup.
    keptSecureStore: [...previous.survives.keptSecureStore, ...keptWritten(written.secureStore)],
  },
  defaultRows: ['mint-changes-cache', 'mint-discover-cache', 'own-profile-stats-cache'],
  knownGaps: [],
};
