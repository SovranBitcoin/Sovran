import type { ReactElement } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import Icon from '@/assets/icons';
import { Text, UntranslatedText } from '@/shared/ui/primitives/Text';
import { UserProfileIdentityRow } from '@/features/user/screens/UserProfileScreen';

// eslint-disable-next-line no-restricted-syntax -- parseable theme fixture color
const mockForeground = '#ffffff';

jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => mockForeground }));
jest.mock('@/shared/hooks/useColorScheme', () => ({ useColorScheme: () => 'dark' }));
jest.mock('@/shared/lib/version', () => ({ supportsBlur: () => false }));
jest.mock('@/shared/ui/capability', () => ({}));
jest.mock('@/shared/lib/contentShiftLog', () => ({
  useVisualLayoutLogger: () => ({ ref: jest.fn(), onLayout: jest.fn() }),
}));

// Keep the screen's unrelated navigation, wallet, and feed services out of this
// render test. The identity row uses the real Text, stack, View, and icon.
jest.mock('expo-router', () => ({}));
jest.mock('@nostr-dev-kit/ndk-mobile', () => ({}), { virtual: true });
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
jest.mock('@/shared/lib/popup', () => ({}));
jest.mock('@/shared/hooks/useNostrProfile', () => ({}));
jest.mock('@/features/feed', () => ({}));
jest.mock('@/shared/ui/composed/VisualLayoutProbe', () => ({}));
jest.mock('@/shared/lib/date', () => ({}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({}));
jest.mock('@/shared/lib/nav/profileRoutes', () => ({}));
jest.mock('@/shared/lib/nav/mintInfoRoutes', () => ({}));
jest.mock('@/shared/blocks/OperatorRunsSection', () => ({ OperatorRunsSection: () => null }));
jest.mock('@/shared/stores/profile/nostrSocialStore', () => ({}));
jest.mock('@/shared/stores/profile/recentPeopleStore', () => ({}));
jest.mock('@/shared/lib/colorExtraction', () => ({}));
jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({}));
jest.mock('@/shared/lib/logger', () => ({}));
jest.mock('@/shared/stores/runtime/clearPaymentContext', () => ({}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let tree: TestRenderer.ReactTestRenderer;
function render(element: ReactElement) {
  act(() => {
    tree = TestRenderer.create(element);
  });
  return tree;
}

afterEach(() => {
  act(() => tree?.unmount());
});

describe('UserProfileIdentityRow', () => {
  it('reserves the row and icon slot after loading finishes without a NIP-05', () => {
    const view = render(
      <UserProfileIdentityRow nip05={undefined} isLoading={false} foreground={mockForeground} />
    );

    expect(
      view.root.findByProps({ testID: 'user-profile-identity-row' }).props.className
    ).toContain('min-h-5');
    expect(
      view.root.findByProps({ testID: 'user-profile-identity-icon-slot' }).props.className
    ).toContain('w-5');
    expect(view.root.findAllByType(Icon)).toHaveLength(0);
    expect(view.root.findByType(Text).props.children).toBeUndefined();
    expect(view.root.findByType(UntranslatedText).props.children).toBe('\u00A0');
  });

  it.each([false, true])('renders the check icon when NIP-05 exists (loading: %s)', (isLoading) => {
    const view = render(
      <UserProfileIdentityRow nip05="a@b.c" isLoading={isLoading} foreground={mockForeground} />
    );

    expect(view.root.findByType(Icon).props).toMatchObject({
      name: 'mdi:check-decagram',
      size: 16,
    });
    expect(view.root.findByType(Text).props.children).toBe('a@b.c');
    if (!isLoading) expect(view.root.findByType(UntranslatedText).props.children).toBe('a@b.c');
  });

  it('keeps the same row, icon slot, and text metrics through loading and late metadata', () => {
    const row = (isLoading: boolean, nip05?: string) => (
      <UserProfileIdentityRow nip05={nip05} isLoading={isLoading} foreground={mockForeground} />
    );
    const view = render(row(true));
    const identityRow = view.root.findByProps({ testID: 'user-profile-identity-row' });
    const iconSlot = view.root.findByProps({ testID: 'user-profile-identity-icon-slot' });
    const textStyle = view.root.findByType(Text).props.style;
    expect(textStyle.lineHeight).toBe(20);
    expect(view.root.findAllByType(Icon)).toHaveLength(0);

    for (const nip05 of [undefined, 'a@b.c', undefined]) {
      act(() => view.update(row(false, nip05)));
      expect(view.root.findByProps({ testID: 'user-profile-identity-row' })).toBe(identityRow);
      expect(view.root.findByProps({ testID: 'user-profile-identity-icon-slot' })).toBe(iconSlot);
      expect(view.root.findByType(Text).props.style).toEqual(textStyle);
    }
  });
});
