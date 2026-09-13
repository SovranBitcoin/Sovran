/** @jest-environment node */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { errAsync, okAsync } from 'neverthrow';
import { SettingsEditProfileScreen } from '@/features/settings/screens/SettingsEditProfileScreen';
import {
  loadOwnProfileMetadata,
  publishOwnProfileMetadata,
  ingestOwnProfileMetadata,
} from '@/shared/lib/nostr/profile/publishOwnProfileMetadata';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { paramPopup } from '@/shared/lib/popup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockProfile = { pubkey: 'a'.repeat(64), accountIndex: 0 };
const mockState = { getActiveProfile: () => mockProfile };
const mockNdk = {};
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: Object.assign(
    (selector: (state: typeof mockState) => unknown) => selector(mockState),
    {
      getState: () => mockState,
    }
  ),
}));
jest.mock('@nostr-dev-kit/ndk-mobile', () => ({ useNDK: () => ({ ndk: mockNdk }) }), {
  virtual: true,
});
jest.mock('@/shared/providers/NostrNDKProvider', () => ({
  useNostrNDKContext: () => ({ isInitialized: true }),
}));
jest.mock('@/shared/lib/nostr/profile/publishOwnProfileMetadata', () => ({
  loadOwnProfileMetadata: jest.fn(),
  publishOwnProfileMetadata: jest.fn(),
  ingestOwnProfileMetadata: jest.fn(),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { back: jest.fn() } }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'white' }));
jest.mock('@/shared/lib/logger', () => ({ nostrLog: { info: jest.fn(), warn: jest.fn() } }));
jest.mock('@/shared/lib/popup', () => ({
  actionMenuPopup: jest.fn(),
  paramPopup: jest.fn(),
  popup: jest.fn(),
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/shared/stores/profile/ownedMediaStore', () => ({ useOwnedMediaStore: {} }));
jest.mock('@/shared/lib/nostr/media/mediaUpload', () => ({ uploadMedia: jest.fn() }));
jest.mock('@/shared/lib/nostr/media/mediaServerStore', () => ({ getMediaServer: jest.fn() }));
jest.mock('@/shared/lib/nostr/media/ownedBlobs', () => ({
  extractOwnedBlobsFromDescriptors: jest.fn(),
}));
jest.mock('@/assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: () => null,
  Circle: () => null,
}));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children, footer }: React.PropsWithChildren<{ footer: React.ReactNode }>) => (
    <>
      {children}
      {footer}
    </>
  ),
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({
  Pressable: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: () => null }));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('heroui-native', () => ({
  TextField: ({ children }: React.PropsWithChildren) => children,
  Label: ({ children }: React.PropsWithChildren) => children,
  Input: () => null,
}));

let renderer: TestRenderer.ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadOwnProfileMetadata).mockResolvedValue({ status: 'absent' });
  jest.mocked(publishOwnProfileMetadata).mockReturnValue(errAsync({ type: 'base-unavailable' }));
});
afterEach(() => {
  act(() => renderer?.unmount());
});

it('shows save-time base failure inline and retries the shared loader without losing the draft', async () => {
  // No mount warning: the save result must independently surface the failure.
  const snapshot = { content: { name: 'Old' }, createdAt: 10, eventId: 'b'.repeat(64) };
  await act(async () => {
    renderer = TestRenderer.create(<SettingsEditProfileScreen />);
  });
  const control = (testID: string) => renderer.root.findByProps({ testID });
  expect(renderer.root.findAllByProps({ testID: 'edit-profile-base-retry' })).toHaveLength(0);
  act(() => {
    control('edit-profile-name').props.onChangeText('My draft');
  });
  await act(async () => {
    await control('edit-profile-save').props.onPress();
  });
  expect(control('edit-profile-save').props.disabled).toBe(false);
  expect(control('edit-profile-name').props.value).toBe('My draft');
  expect(renderer.root.findByProps({ accessibilityRole: 'alert' }).props.children).toContain(
    "Couldn't load your current profile."
  );
  expect(paramPopup).not.toHaveBeenCalled();
  expect(guardedRouter.back).not.toHaveBeenCalled();

  jest.mocked(loadOwnProfileMetadata).mockResolvedValueOnce({ status: 'unavailable' });
  await act(async () => {
    await control('edit-profile-base-retry').props.onPress();
  });
  expect(control('edit-profile-name').props.value).toBe('My draft');
  expect(control('edit-profile-base-retry').props.disabled).toBe(false);

  const recovered = { ...snapshot, content: { name: 'Remote', lud16: 'keep' }, createdAt: 20 };
  jest
    .mocked(loadOwnProfileMetadata)
    .mockResolvedValueOnce({ status: 'found', snapshot: recovered });
  await act(async () => {
    await control('edit-profile-base-retry').props.onPress();
  });
  expect(loadOwnProfileMetadata).toHaveBeenCalledTimes(3);
  expect(ingestOwnProfileMetadata).toHaveBeenLastCalledWith(recovered, mockProfile.pubkey, 0);
  expect(control('edit-profile-name').props.value).toBe('My draft');
  expect(renderer.root.findAllByProps({ testID: 'edit-profile-base-retry' })).toHaveLength(0);
  jest.mocked(publishOwnProfileMetadata).mockReturnValue(
    okAsync({
      eventId: 'c'.repeat(64),
      anyAccepted: true,
      accepted: [],
      failed: [],
      relayResults: [],
    })
  );
  await act(async () => {
    await control('edit-profile-save').props.onPress();
  });
  expect(publishOwnProfileMetadata).toHaveBeenLastCalledWith(
    expect.objectContaining({
      initialLoad: { status: 'found', snapshot: recovered },
      patch: { name: 'My draft' },
    })
  );
  expect(guardedRouter.back).toHaveBeenCalledTimes(1);
});
