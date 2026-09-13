import { render } from '@testing-library/react-native';
import { SendMessageMenu } from '@/features/user/components/SendMessageMenu';
import type { ActionMenuVariant } from '@/shared/ui/composed/ActionMenuButton';

const mockMenu = jest.fn((_props: unknown) => null);
jest.mock('@/shared/ui/composed/ActionMenuButton', () => ({
  ActionMenuButton: (props: unknown) => mockMenu(props),
}));
jest.mock('@/features/bitchat/hooks/useBLEPeers', () => ({ useBLEPeers: () => ({ peers: [] }) }));
jest.mock('@/features/whitenoise/hooks/useWhitenoiseSetup', () => ({
  useWhitenoiseSetup: () => ({ isReady: false }),
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (select: (state: { whitenoiseEnabled: boolean }) => unknown) =>
      select({ whitenoiseEnabled: true }),
    { getState: () => ({ language: 'en' }) }
  ),
}));
const mockNavigate = jest.fn();
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { navigate: (...args: unknown[]) => mockNavigate(...args), push: jest.fn() },
}));
jest.mock('@/shared/lib/nav/profileRoutes', () => ({
  useActiveProfileFlowGroup: () => 'modal',
  buildProfileHref: (name: string, params: unknown) => ({ name, params }),
}));
jest.mock('@/assets/icons', () => () => null);
jest.mock('@/shared/lib/logger', () => ({ nostrLog: { info: jest.fn() } }));
jest.mock('@/shared/stores/profile/dmLastMessageStore', () => ({
  useDmLastMessage: () => ({ protocol: 'nip04', atSeconds: 100, isOwn: false }),
}));

it('places the recommendation first with reasons, stable controls and original navigation', async () => {
  render(<SendMessageMenu pubkey={'a'.repeat(64)} displayName="Contact" />);
  const props = mockMenu.mock.calls[0][0] as {
    variants: ActionMenuVariant[];
    testID: string;
    collapsedPressOpensMenu: boolean;
  };
  expect(props.testID).toBe('send-message-menu');
  expect(props.collapsedPressOpensMenu).toBe(true);
  expect(props.variants.map((variant) => variant.testID)).toEqual([
    'send-message-menu-nip04',
    'send-message-menu-nostr',
    'send-message-menu-whitenoise',
    'send-message-menu-bitchat',
  ]);
  expect(props.variants[0].description).toMatch(/^Recommended · They last messaged you via NIP-04/);
  expect(props.variants[1].description).toBe('Encrypted (NIP-17 gift wrap)');
  expect(props.variants[2]).toMatchObject({
    isDisabled: false,
    description: 'Tap to set up MLS encrypted messaging',
  });
  expect(props.variants[3]).toMatchObject({
    isDisabled: true,
    reason: 'No nearby BLE peer matches this contact',
  });
  await props.variants[0].onPress();
  expect(mockNavigate).toHaveBeenCalledWith({
    name: 'userMessages',
    params: { pubkey: 'a'.repeat(64), protocol: 'nip04' },
  });
});
