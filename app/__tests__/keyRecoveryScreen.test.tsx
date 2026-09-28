import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { KeyRecoveryScreen } from '@/shared/blocks/KeyRecoveryScreen';
import { useSecureStoreState } from '@/shared/stores/runtime/secureStoreState';
import { restartApp } from '@/shared/lib/profile/appRestart';
import { openMnemonicRecovery, openNsecRecovery } from '@/shared/lib/profile/keyRecovery';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockSource = 'derived';
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: (select: (state: object) => unknown) =>
    select({
      activeAccountIndex: 0,
      profiles: [{ accountIndex: 0, source: mockSource }],
    }),
}));
jest.mock('@/shared/lib/profile/profileSessionOrchestrator', () => ({
  deleteAllProfiles: jest.fn(),
}));
jest.mock('@/shared/lib/profile/appRestart', () => ({ restartApp: jest.fn(() => true) }));
jest.mock('@/shared/lib/profile/keyRecovery', () => ({
  openMnemonicRecovery: jest.fn(),
  openNsecRecovery: jest.fn(),
}));
jest.mock('@/shared/lib/popup', () => ({ actionMenuPopup: jest.fn() }));
jest.mock('@/shared/blocks/popup/ActionMenuHost', () => ({ ActionMenuHost: () => null }));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({
  VStack: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: ({ children }: React.PropsWithChildren) => <text>{children}</text>,
}));
jest.mock('@/shared/ui/primitives/Button', () => ({
  Button: (props: { text: string; onPress: () => void; accessibilityLabel?: string }) => (
    <button onClick={props.onPress} aria-label={props.accessibilityLabel}>
      {props.text}
    </button>
  ),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { warn: jest.fn(), error: jest.fn() },
  redactError: () => 'redacted',
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  jest.mocked(restartApp).mockReturnValue(true);
  mockSource = 'derived';
  useSecureStoreState.setState({ secureStoreState: 'locked', errorName: 'Error' });
});

let tree: TestRenderer.ReactTestRenderer;
async function render(locked = true) {
  await act(async () => {
    tree = TestRenderer.create(<KeyRecoveryScreen locked={locked} />);
  });
}
async function press(text: string) {
  await act(async () => {
    await tree.root.findByProps({ text }).props.onPress();
  });
}
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

it.each(['button', 'foreground'])(
  'restarts after a successful keychain retry via %s without writing keys',
  async (trigger) => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('abandon '.repeat(11) + 'about');
    await render();
    if (trigger === 'button') await press('Retry');
    else
      await act(async () => {
        jest.mocked(AppState.addEventListener).mock.calls[0][1]('active');
      });
    expect(restartApp).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(useSecureStoreState.getState().secureStoreState).toBe('locked');
  }
);

it.each(['absent', 'unreadable'])('keeps a %s keychain locked on retry', async (kind) => {
  if (kind === 'absent') jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  else jest.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('locked'));
  await render();
  await press('Retry');
  expect(JSON.stringify(tree.toJSON())).toContain(
    'Keys are still unavailable. Unlock your device and try again.'
  );
  expect(restartApp).not.toHaveBeenCalled();
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});

it.each(['derived', 'imported'])(
  'offers the matching recovery method for a %s profile',
  async (source) => {
    mockSource = source;
    await render(false);
    await press(source === 'derived' ? 'Enter recovery phrase' : 'Re-import');
    expect(source === 'derived' ? openMnemonicRecovery : openNsecRecovery).toHaveBeenCalledTimes(1);
    expect(source === 'derived' ? openNsecRecovery : openMnemonicRecovery).not.toHaveBeenCalled();
  }
);
