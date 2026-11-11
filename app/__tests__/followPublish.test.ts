/**
 * @jest-environment node
 *
 * What tapping Follow on a profile publishes today: the screen's
 * `toggleFollowContacts` against the real social store. The NDK event, the
 * publish seam, the popup and the screen's unrelated imports are replaced.
 */
import { toggleFollowContacts } from '@/features/user/screens/UserProfileScreen';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

const mockPublish = jest.fn();
const mockPopup = jest.fn();

jest.mock('@nostr-dev-kit/ndk-mobile', () => ({
  NDKEvent: class {
    kind = 0;
    tags: string[][] = [];
    content = '';
    created_at = 0;
  },
  useNDK: () => ({ ndk: null }),
}));
jest.mock('@/shared/lib/nostr/publish', () => ({
  publishEvent: (...args: unknown[]) => mockPublish(...args),
}));
jest.mock('@/shared/lib/popup', () => ({
  paramPopup: (...args: unknown[]) => mockPopup(...args),
}));
jest.mock('@/shared/lib/logger', () => {
  // Every export is a silent logger that is also callable (`redactError`, hooks).
  const silent: object = new Proxy(() => undefined, { get: () => silent });
  return new Proxy({}, { get: (_target, key) => (key === '__esModule' ? false : silent) });
});
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));
// The screen's unrelated imports (navigation, wallet, UI), as in
// userProfileIdentityRow.test.tsx.
jest.mock('expo-router', () => ({}));
jest.mock('wallet/react', () => ({}), { virtual: true });
jest.mock('heroui-native', () => ({}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({}));
jest.mock('@/shared/lib/nav/useRouteParams', () => ({}));
jest.mock('@/shared/ui/composed/TierBadge', () => ({}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({}));
jest.mock('@/shared/hooks/useSingleFlight', () => ({}));
jest.mock('@/shared/lib/debug/fadeRevealProbe', () => ({}));
jest.mock('@/shared/lib/nostr/client', () => ({}));
jest.mock('@/shared/ui/composed/Section', () => ({}));
jest.mock('@/shared/ui/primitives/Avatar', () => ({}));
jest.mock('@/shared/lib/url', () => ({}));
jest.mock('@/shared/ui/composed/CircleActionButton', () => ({}));
jest.mock('@/shared/ui/composed/CapsuleButton', () => ({}));
jest.mock('@/shared/ui/composed/SkeletonExitShimmer', () => ({}));
jest.mock('@/shared/lib/cashu/npc', () => ({}));
jest.mock('@/shared/lib/popup/E2EActionMenuProbe', () => ({}));
jest.mock('@/shared/providers/WalletContextProvider', () => ({}));
jest.mock('@/features/feed/hooks/useModerationActions', () => ({}));
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({}));
jest.mock('@/navigation/headerItems', () => ({}));
jest.mock('@/features/user/components/SendMessageMenu', () => ({}));
jest.mock('@/shared/hooks/useNostrProfile', () => ({}));
jest.mock('@/features/feed', () => ({}));
jest.mock('@/shared/ui/composed/VisualLayoutProbe', () => ({}));
jest.mock('@/shared/lib/date', () => ({}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({}));
jest.mock('@/shared/lib/nav/profileRoutes', () => ({}));
jest.mock('@/shared/lib/nav/mintInfoRoutes', () => ({}));
jest.mock('@/shared/blocks/OperatorRunsSection', () => ({ OperatorRunsSection: () => null }));
jest.mock('@/shared/stores/profile/recentPeopleStore', () => ({}));
jest.mock('@/shared/lib/colorExtraction', () => ({}));
jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({}));
jest.mock('@/shared/stores/runtime/clearPaymentContext', () => ({}));
jest.mock('@/shared/hooks/useThemeColor', () => ({}));
jest.mock('@/shared/lib/contentShiftLog', () => ({}));

const OWN = 'a0'.repeat(32);
const X = 'b1'.repeat(32);
const Y = 'c2'.repeat(32);
const Z = 'd3'.repeat(32);
const T = 1_700_000_000;

function social() {
  return useNostrSocialStore.getState();
}

function follow(
  target: string,
  overrides: Partial<Parameters<typeof toggleFollowContacts>[0]> = {}
) {
  const state = social();
  return toggleFollowContacts({
    pubkey: target,
    ownPubkey: OWN,
    ndk: {} as never,
    followInFlight: !!state.optimisticFollowsByPubkey[target]?.pending,
    isFollowingProfile:
      state.optimisticFollowsByPubkey[target]?.value ?? !!state.followingPubkeys[target],
    contactsTags: state.contactsTags,
    contactsContent: state.contactsContent,
    setContactsFromRelay: state.setContactsFromRelay,
    setFollowOptimistic: state.setFollowOptimistic,
    clearFollowOptimistic: state.clearFollowOptimistic,
    ...overrides,
  });
}

function published(): { tags: string[][]; content: string } {
  expect(mockPublish).toHaveBeenCalledTimes(1);
  return mockPublish.mock.calls[0][0].event;
}

beforeEach(() => {
  mockPublish.mockReset();
  mockPublish.mockResolvedValue({ isErr: () => false });
  mockPopup.mockReset();
  useNostrSocialStore.setState(useNostrSocialStore.getInitialState(), true);
});

describe('toggleFollowContacts', () => {
  it('publishes the saved list, hints, petnames and other tags kept, plus the new follow', async () => {
    const tags = [
      ['p', X, 'wss://hint.example', 'xavier'],
      ['t', 'bitcoin'],
      ['p', Y],
    ];
    social().setContactsFromRelay({ tags, content: '{"relays":1}', createdAtSec: T });

    await follow(Z);

    expect(published()).toMatchObject({ tags: [...tags, ['p', Z]], content: '{"relays":1}' });
    expect(social().followingPubkeys).toEqual({ [X]: true, [Y]: true, [Z]: true });
    expect(social().optimisticFollowsByPubkey).toEqual({});
  });

  it('unfollows by removing only that entry', async () => {
    const tags = [
      ['p', X, 'wss://hint.example'],
      ['t', 'bitcoin'],
      ['p', Y, '', 'yolanda'],
    ];
    social().setContactsFromRelay({ tags, content: '', createdAtSec: T });

    await follow(X);

    expect(published().tags).toEqual([
      ['t', 'bitcoin'],
      ['p', Y, '', 'yolanda'],
    ]);
  });

  it('publishes a list of one when the follows came only from the nagg or Primal seed', async () => {
    social().seedFollowsFromFacade({ follows: [X, Y], createdAtSec: T });

    await follow(Z);

    // QUIRK (F209): `contactsTags` is empty under a seeded follow set, so the
    // person's public follow list is replaced by one entry and the shown set
    // shrinks to it. The repair should change this assertion on purpose.
    expect(published().tags).toEqual([['p', Z]]);
    expect(social().followingPubkeys).toEqual({ [Z]: true });
  });

  it('publishes a list of one when nothing has loaded yet', async () => {
    await follow(Z);

    // QUIRK (F209): same with no list at all.
    expect(published().tags).toEqual([['p', Z]]);
  });

  it('drops a duplicate entry for another person while editing the list', async () => {
    social().setContactsFromRelay({
      tags: [
        ['p', X, 'wss://first.example'],
        ['p', X, 'wss://second.example'],
      ],
      content: '',
      createdAtSec: T,
    });

    await follow(Z);

    // QUIRK: the edit deduplicates other entries; the approved design keeps the
    // read list's tags exactly as they are.
    expect(published().tags).toEqual([
      ['p', X, 'wss://first.example'],
      ['p', Z],
    ]);
  });

  it('clears the follow and shows the error when no relay accepts it', async () => {
    social().setContactsFromRelay({ tags: [['p', X]], content: '', createdAtSec: T });
    mockPublish.mockResolvedValue({ isErr: () => true });

    await follow(Z);

    // QUIRK: a failed publish drops the intent; the button snaps back.
    expect(social().optimisticFollowsByPubkey).toEqual({});
    expect(social().followingPubkeys).toEqual({ [X]: true });
    expect(mockPopup).toHaveBeenCalledWith('engagement-update-failed', 'follow');
  });

  it('ignores the tap while a follow saved before the app closed is still marked pending', async () => {
    social().setContactsFromRelay({ tags: [['p', X]], content: '', createdAtSec: T });
    useNostrSocialStore.setState({
      optimisticFollowsByPubkey: { [Z]: { value: true, pending: true, updatedAt: 1 } },
    });
    social().clearSettledFollowOptimistic();

    await follow(Z);

    // QUIRK (F215): nothing resumes or clears a rehydrated pending entry, so the
    // button shows it as fact and every tap returns early.
    expect(mockPublish).not.toHaveBeenCalled();
    expect(social().optimisticFollowsByPubkey[Z]).toMatchObject({ value: true, pending: true });
  });
});
