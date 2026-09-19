/** @jest-environment node */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { errAsync, okAsync } from 'neverthrow';
import { SettingsEditProfileScreen } from '@/features/settings/screens/SettingsEditProfileScreen';
import {
  loadOwnProfileMetadata,
  publishOwnProfileMetadata,
  ingestOwnProfileMetadata,
  type OwnProfileLoadResult,
} from '@/shared/lib/nostr/profile/publishOwnProfileMetadata';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { paramPopup } from '@/shared/lib/popup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockProfile = { pubkey: 'a'.repeat(64), accountIndex: 0 };
const mockState = { getActiveProfile: () => mockProfile };
let mockHistory: Record<string, { value: string; createdAt: number }[]> = {};
let mockLatest: { content: Record<string, unknown>; createdAt: number; eventId: string } | null =
  null;
jest.mock('@/shared/stores/profile/ownProfileMetadataStore', () => ({
  useOwnProfileMetadataStore: Object.assign(
    (selector: (state: { history: typeof mockHistory }) => unknown) =>
      selector({ history: mockHistory }),
    { getState: () => ({ latest: mockLatest }) }
  ),
}));
jest.mock('@/shared/lib/cashu/npc', () => ({
  getNpcAddress: (username: string | undefined, npub: string) => `${username ?? npub}@npub.cash`,
}));
jest.mock('@/shared/ui/composed/CapsuleButton', () => ({
  CapsuleButton: ({
    testID,
    label,
    onPress,
  }: {
    testID?: string;
    label: string;
    onPress: () => void;
  }) => require('react').createElement('capsule', { testID, label, onPress }),
}));
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
  Description: ({ children }: React.PropsWithChildren) => children,
  Input: () => null,
}));

let renderer: TestRenderer.ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  mockHistory = {};
  mockLatest = null;
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

it('validates the addresses, fills npub.cash in one tap, and publishes normalised values', async () => {
  const snapshot = {
    content: { name: 'Old', lud16: 'old@ln.example', nip05: 'old@id.example', about: 'Bio' },
    createdAt: 10,
    eventId: 'b'.repeat(64),
  };
  jest.mocked(loadOwnProfileMetadata).mockResolvedValue({ status: 'found', snapshot });
  await act(async () => {
    renderer = TestRenderer.create(<SettingsEditProfileScreen />);
  });
  const control = (testID: string) => renderer.root.findByProps({ testID });
  expect(control('edit-profile-lud16').props.value).toBe('old@ln.example');
  expect(control('edit-profile-nip05').props.value).toBe('old@id.example');
  expect(control('edit-profile-about').props.value).toBe('Bio');
  expect(control('edit-profile-save').props.disabled).toBe(true);

  // An unparsable address blocks Save and explains itself inline.
  act(() => {
    control('edit-profile-nip05').props.onChangeText('not an address');
  });
  expect(control('edit-profile-save').props.disabled).toBe(true);
  expect(
    renderer.root
      .findAllByProps({ accessibilityRole: 'alert' })
      .some((node) => String(node.props.children).includes('Nostr address'))
  ).toBe(true);

  // One tap fills the account's npub.cash Lightning address.
  act(() => {
    control('edit-profile-nip05').props.onChangeText('Me@Example.COM');
    control('edit-profile-lud16-npc').props.onPress();
  });
  expect(control('edit-profile-lud16').props.value).toMatch(/^npub1[a-z0-9]+@npub\.cash$/);
  expect(renderer.root.findAllByProps({ testID: 'edit-profile-lud16-npc' })).toHaveLength(0);
  expect(control('edit-profile-save').props.disabled).toBe(false);

  jest.mocked(publishOwnProfileMetadata).mockReturnValue(
    okAsync({
      eventId: 'c'.repeat(64),
      anyAccepted: true,
      accepted: [],
      failed: [],
      relayResults: [],
    })
  );
  act(() => {
    control('edit-profile-about').props.onChangeText('   ');
  });
  await act(async () => {
    await control('edit-profile-save').props.onPress();
  });
  expect(publishOwnProfileMetadata).toHaveBeenLastCalledWith(
    expect.objectContaining({
      // lowercase-normalised nip05, npub.cash lud16, cleared about → removed key
      patch: {
        lud16: expect.stringMatching(/@npub\.cash$/),
        nip05: 'me@example.com',
        about: null,
      },
    })
  );
});

it('opens on the stored kind-0 at once and a newer relay copy fills only untouched fields', async () => {
  mockLatest = {
    content: { name: 'Stored', lud16: 'stored@ln.example', about: 'Stored bio' },
    createdAt: 10,
    eventId: 'b'.repeat(64),
  };
  let resolveLoad!: (result: OwnProfileLoadResult) => void;
  jest.mocked(loadOwnProfileMetadata).mockReturnValue(
    new Promise((resolve) => {
      resolveLoad = resolve;
    })
  );
  await act(async () => {
    renderer = TestRenderer.create(<SettingsEditProfileScreen />);
  });
  const control = (testID: string) => renderer.root.findByProps({ testID });
  // The relay load is still pending: the stored values are shown and editable.
  expect(control('edit-profile-name').props.value).toBe('Stored');
  expect(control('edit-profile-about').props.value).toBe('Stored bio');
  expect(control('edit-profile-name').props.editable).toBe(true);
  act(() => {
    control('edit-profile-about').props.onChangeText('My draft bio');
  });

  // Edited on another client: name and nip05 changed remotely.
  const remote = {
    content: {
      name: 'Remote',
      lud16: 'stored@ln.example',
      nip05: 'me@id.example',
      about: 'Remote bio',
    },
    createdAt: 20,
    eventId: 'c'.repeat(64),
  };
  await act(async () => {
    resolveLoad({ status: 'found', snapshot: remote });
  });
  expect(control('edit-profile-name').props.value).toBe('Remote');
  expect(control('edit-profile-nip05').props.value).toBe('me@id.example');
  expect(control('edit-profile-about').props.value).toBe('My draft bio');

  jest.mocked(publishOwnProfileMetadata).mockReturnValue(
    okAsync({
      eventId: 'd'.repeat(64),
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
      initialLoad: { status: 'found', snapshot: remote },
      patch: { about: 'My draft bio' },
    })
  );
});

it('offers previous values as one-tap chips and hides the current one', async () => {
  mockHistory = {
    name: [
      { value: 'Older', createdAt: 5 },
      { value: 'Old', createdAt: 8 },
    ],
    lud16: [{ value: 'prev@ln.example', createdAt: 5 }],
  };
  jest.mocked(loadOwnProfileMetadata).mockResolvedValue({
    status: 'found',
    snapshot: { content: { name: 'Old' }, createdAt: 10, eventId: 'b'.repeat(64) },
  });
  await act(async () => {
    renderer = TestRenderer.create(<SettingsEditProfileScreen />);
  });
  const control = (testID: string) => renderer.root.findByProps({ testID });
  // 'Old' is the current name, so only 'Older' is offered.
  expect(renderer.root.findAllByProps({ testID: 'edit-profile-history-name-Old' })).toHaveLength(0);
  expect(control('edit-profile-history-name-Older').props.label).toBe('Older');
  act(() => {
    control('edit-profile-history-name-Older').props.onPress();
    control('edit-profile-history-lud16-prev@ln.example').props.onPress();
  });
  expect(control('edit-profile-name').props.value).toBe('Older');
  expect(control('edit-profile-lud16').props.value).toBe('prev@ln.example');
  expect(control('edit-profile-save').props.disabled).toBe(false);
});
