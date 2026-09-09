/**
 * Synthetic upgrade fixtures from v0.1.0 (d23d0723, June 8), not device data.
 * Exercise the current persist options in Zustand's migrate-then-merge order.
 * Keep these release inputs fixed when development schemas change.
 */
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNpcMintStore } from '@/shared/stores/profile/npcMintStore';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { useThemeStore } from '@/shared/stores/profile/themeStore';
import { useRecentPeopleStore } from '@/shared/stores/profile/recentPeopleStore';
import { useNotificationPolicyStore } from '@/features/feed/stores/notificationPolicyStore';
import { log } from '@/shared/lib/logger';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  applyFileLogging: jest.fn(),
  redactError: (error: unknown) => error,
}));

async function upgrade<T>(
  store: {
    getInitialState(): T;
    persist: {
      getOptions(): {
        version?: number;
        migrate?: (state: unknown, version: number) => unknown;
        merge?: (state: unknown, current: T) => T;
      };
    };
  },
  version: number,
  state: unknown
): Promise<T> {
  const options = store.persist.getOptions();
  const diskState: unknown = JSON.parse(JSON.stringify(state));
  const migrated =
    version === options.version ? diskState : await options.migrate?.(diskState, version);
  if (!options.merge) throw new Error('missing persisted schema merge');
  return options.merge(migrated, store.getInitialState());
}

const PUBKEY = 'ab'.repeat(32);
const EVENT_ID = 'cd'.repeat(32);
const MINT = 'https://mint.example/Bitcoin';

describe('v0.1.0 -> current release persistence', () => {
  beforeEach(() => jest.mocked(log.warn).mockClear());
  afterEach(() => expect(log.warn).not.toHaveBeenCalled());

  it('preserves derived and imported profiles and the selected account', async () => {
    const profiles = [
      { accountIndex: 0, pubkey: PUBKEY, addedAt: 1, cachedBalanceSats: 42 },
      { accountIndex: 1, pubkey: EVENT_ID, addedAt: 2, source: 'imported', externalChain: 1 },
    ];
    const next = await upgrade(useProfileStore, 1, {
      profiles,
      activeAccountIndex: 1,
      cocoMigrationComplete: { 0: true, 1: true },
    });
    expect(next.profiles).toEqual(profiles);
    expect(next.activeAccountIndex).toBe(1);
    expect(next).not.toHaveProperty('cocoMigrationComplete');
    expect(next.addProfile).toBe(useProfileStore.getInitialState().addProfile);
  });

  it('preserves consent, onboarding and preferences while removing the retired avatar picker', async () => {
    const termsAccepted = { termsAccepted: true, date: '2026-06-08' };
    const next = await upgrade(useSettingsStore, 3, {
      termsAccepted,
      hasSeenOnboarding: true,
      displayCurrency: 'gbp',
      displayBtc: 8,
      minTransferThreshold: 19,
      regenerateP2PKOnReceive: false,
      sendLocationEnabled: true,
      avatarFallbackVariant: 'pixel',
    });
    expect(next).toMatchObject({
      termsAccepted,
      hasSeenOnboarding: true,
      displayCurrency: 'gbp',
      displayBtc: 8,
      minTransferThreshold: 19,
      regenerateP2PKOnReceive: false,
      sendLocationEnabled: true,
    });
    expect(next).not.toHaveProperty('avatarFallbackVariant');
  });

  it('preserves the wallet restore decision', async () => {
    const state = {
      seedCreatedAt: 1,
      restoreStatus: 'complete',
      lastRestoreAt: 2,
      lastRestoreError: null,
    };
    expect(await upgrade(useWalletLifecycleStore, 1, state)).toMatchObject(state);
  });

  it('preserves the released scalar mint choices without rerunning pre-release map migrations', async () => {
    expect(await upgrade(useMintStore, 2, { selectedMint: MINT })).toMatchObject({
      selectedMint: MINT,
      activeUnit: 'sat',
      standingQuotes: {},
    });
    expect(await upgrade(useNpcMintStore, 2, { mintUrl: MINT })).toMatchObject({ mintUrl: MINT });
  });

  it('folds released likes and reposts while retaining follow, deletion and optimistic state', async () => {
    const retained = {
      contactsTags: [['p', PUBKEY]],
      contactsContent: 'fixture',
      contactsUpdatedAt: 1,
      followingPubkeys: { [PUBKEY]: true },
      deletedRepostOriginalIds: { [EVENT_ID]: 2 },
      optimisticFollowsByPubkey: { [PUBKEY]: { value: false, pending: true, updatedAt: 3 } },
    };
    const next = await upgrade(useNostrSocialStore, 1, {
      ...retained,
      likesByEventId: { [EVENT_ID]: { reactionEventId: PUBKEY, updatedAt: 4 } },
      repostsByEventId: { [EVENT_ID]: { repostEventId: EVENT_ID, updatedAt: 5 } },
    });
    expect(next).toMatchObject(retained);
    expect(next.engagementByEventId[EVENT_ID]).toEqual({
      liked: { ownEventId: PUBKEY },
      reposted: { ownEventId: EVENT_ID },
      updatedAt: 5,
    });
  });

  it('preserves released AI sessions and message ancestry', async () => {
    const sessions = [
      {
        id: 'session-1',
        title: 'Saved chat',
        createdAt: 1,
        messages: [
          { id: 'question', role: 'user', content: 'Hello', timestamp: 1, parentId: null },
          { id: 'answer', role: 'assistant', content: 'Hi', timestamp: 2, parentId: 'question' },
        ],
        activeChildren: { question: 'answer' },
      },
    ];
    const next = await upgrade(useRoutstrStore, 1, {
      apiKey: 'synthetic-test-credential',
      balance: 0,
      selectedModel: 'fixture-model',
      sessions,
      currentSessionId: 'session-1',
    });
    expect(next).toMatchObject({
      apiKey: 'synthetic-test-credential',
      balance: 0,
      sessions,
      currentSessionId: 'session-1',
    });
  });

  it('preserves released notification and recent-person preferences', async () => {
    expect(
      await upgrade(useNotificationPolicyStore, 1, { policy: 'FOLLOWS', replyScope: 'THREAD' })
    ).toMatchObject({ policy: 'FOLLOWS', replyScope: 'THREAD' });
    expect(
      await upgrade(useRecentPeopleStore, 1, {
        entries: [{ pubkey: PUBKEY, firstOpenedAt: 1, lastOpenedAt: 2 }],
      })
    ).toMatchObject({
      entries: [{ pubkey: PUBKEY, firstOpenedAt: 1, lastOpenedAt: 2, reason: 'search' }],
    });
  });

  it('applies the intentional July theme reset once and preserves current choices', async () => {
    const state = { activeAlbumSlug: 'album', unitWallpapers: { sat: 'image' }, mode: 'light' };
    expect(await upgrade(useThemeStore, 1, state)).toMatchObject({
      activeAlbumSlug: null,
      unitWallpapers: {},
      mode: 'dark',
    });
    expect(await upgrade(useThemeStore, 2, state)).toMatchObject(state);
  });
});
