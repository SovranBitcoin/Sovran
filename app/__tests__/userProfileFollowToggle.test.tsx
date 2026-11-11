/**
 * @jest-environment node
 *
 * The profile screen's Follow button tap (`useFollowToggle`, the handler the
 * screen passes to the button) against the real social store. Replaced: the
 * popup, the logger, storage and the screen's unrelated imports.
 */
import { act, renderHook } from '@testing-library/react-native';

import { followButtonFace, useFollowToggle } from '@/features/user/screens/UserProfileScreen';
import {
  selectIsFollowingPubkey,
  useNostrSocialStore,
} from '@/shared/stores/profile/nostrSocialStore';

const mockPopup = jest.fn();

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
jest.mock('@nostr-dev-kit/ndk-mobile', () => ({}));
jest.mock('wallet/react', () => ({}), { virtual: true });
jest.mock('heroui-native', () => ({}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({}));
jest.mock('@/shared/lib/nav/useRouteParams', () => ({}));
jest.mock('@/shared/ui/composed/TierBadge', () => ({}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({}));
jest.mock('@/shared/hooks/useSingleFlight', () => ({}));
jest.mock('@/shared/lib/debug/fadeRevealProbe', () => ({}));
jest.mock('@/shared/lib/nostr/client', () => ({}));
jest.mock('@/shared/lib/nostr/publish', () => ({}));
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
const Z = 'd3'.repeat(32);

const social = () => useNostrSocialStore.getState();

beforeEach(() => {
  mockPopup.mockReset();
  useNostrSocialStore.setState(useNostrSocialStore.getInitialState(), true);
});

describe('the profile Follow button', () => {
  it('records a follow, then an unfollow, for two taps before the screen redraws', () => {
    const { result } = renderHook(() => useFollowToggle(Z, OWN));

    act(() => {
      result.current();
      result.current();
    });

    expect(social().optimisticFollowsByPubkey[Z]).toMatchObject({ value: false, pending: true });
    expect(selectIsFollowingPubkey(Z)(social())).toBe(false);
  });

  it('unfollows someone already followed, and follows again on the next tap', () => {
    social().setContactsFromRelay({
      tags: [['p', Z]],
      content: '',
      createdAtSec: 1,
      eventId: 'e1',
    });
    const { result } = renderHook(() => useFollowToggle(Z, OWN));

    act(() => result.current());
    expect(selectIsFollowingPubkey(Z)(social())).toBe(false);
    act(() => result.current());
    expect(selectIsFollowingPubkey(Z)(social())).toBe(true);
  });

  it('writes a tap into the account whose stores are loaded when it is made', () => {
    const { result } = renderHook(() => useFollowToggle(Z, OWN));
    // The stores are reset and loaded for another account, as an in-process
    // switch does, while this handler still names the first one.
    useNostrSocialStore.setState(useNostrSocialStore.getInitialState(), true);

    act(() => result.current());

    // QUIRK: the handler does not check that `ownPubkey` is the account the
    // stores hold, so this tap lands in the other account's store. No screen
    // can make it: both switch flows unmount the account's screens before its
    // stores change (an in-process switch suspends the providers first; the
    // default switch never changes the stores in memory and restarts).
    expect(social().optimisticFollowsByPubkey[Z]).toMatchObject({ value: true, pending: true });
  });

  it('records nothing for the own profile, and shows the error without an account', () => {
    const own = renderHook(() => useFollowToggle(OWN, OWN));
    act(() => own.result.current());
    const signedOut = renderHook(() => useFollowToggle(Z, undefined));
    act(() => signedOut.result.current());

    expect(social().optimisticFollowsByPubkey).toEqual({});
    expect(mockPopup).toHaveBeenCalledTimes(1);
    expect(mockPopup).toHaveBeenCalledWith('engagement-update-failed', 'follow');
  });
});

describe('what the Follow button shows', () => {
  it('shows Following once a published list holds the follow, Follow otherwise', () => {
    expect(followButtonFace(true)).toEqual({
      label: 'Following',
      icon: 'mdi:check',
      systemIcon: 'checkmark',
      isActive: true,
      filled: false,
    });
    expect(followButtonFace(false)).toMatchObject({ label: 'Follow', filled: true });
  });

  it('shows a follow no published list holds yet exactly as a published one', () => {
    const { result } = renderHook(() => useFollowToggle(Z, OWN));
    act(() => result.current());
    expect(social().optimisticFollowsByPubkey[Z]?.pending).toBe(true);

    // QUIRK (F227): nothing tells a follow waiting to sync from a published one.
    expect(followButtonFace(selectIsFollowingPubkey(Z)(social()))).toEqual(followButtonFace(true));
  });
});
