/**
 * @jest-environment node
 *
 * Regression: boot auto-generates a seed (ensureMnemonicExists) in parallel
 * with the Terms gate, so on a genuinely fresh install useReinstallDetection's
 * keychain probe finds the just-created seed. Before consulting
 * walletLifecycleStore.seedCreatedAt this raced every fresh install into
 * 'detected' and silently skipped the onboarding carousel.
 */

import React from 'react';
import { render, fireEvent, act, renderHook, waitFor } from '@testing-library/react-native';

import AppGate, { useReinstallDetection } from '@/shared/blocks/AppGate';
import { useSecureStoreState } from '@/shared/stores/runtime/secureStoreState';
import { actionMenuPopup } from '@/shared/lib/popup';
import {
  recoverMnemonicSession,
  deleteAllProfiles,
} from '@/shared/lib/profile/profileSessionOrchestrator';
import { retrieveMnemonic } from '@/shared/lib/nostr/secureStorage';

const mockLifecycle: { seedCreatedAt: number | null } = { seedCreatedAt: null };

jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  retrieveMnemonic: jest.fn(),
}));

jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsHydration: () => 'ready',
  useSettingsStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ hasSeenOnboarding: false }),
    {
      getState: () => ({ hasSeenOnboarding: false }),
      persist: {
        hasHydrated: () => true,
        onFinishHydration: () => () => {},
      },
    }
  ),
}));

jest.mock('@/shared/stores/global/walletLifecycleStore', () => ({
  useWalletLifecycleStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ seedCreatedAt: mockLifecycle.seedCreatedAt }),
    { getState: () => ({ seedCreatedAt: mockLifecycle.seedCreatedAt }) }
  ),
  useWalletLifecycleHydrated: () => true,
}));

jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ isReady: true, isLoading: false }),
}));

jest.mock('@/features/onboarding/screens/TermsAndConditionsScreen', () => ({
  TermsAndConditionsScreen: () => null,
}));
jest.mock('@/features/onboarding/components/OnboardingScreen', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/features/settings/screens/SettingsRecoveryScreen', () => ({
  SettingsRecoveryScreen: () => null,
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  Log: ({ children }: { children: React.ReactNode }) => children,
  initLog: jest.fn(),
  useInitMount: jest.fn(),
  useLifecycleLogger: jest.fn(),
}));

const mockedRetrieveMnemonic = jest.mocked(retrieveMnemonic);

describe('useReinstallDetection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLifecycle.seedCreatedAt = null;
  });

  it('does NOT flag a reinstall when this install created the seed (fresh-install boot race)', async () => {
    mockedRetrieveMnemonic.mockResolvedValue('abandon '.repeat(11).trim() + ' about');
    mockLifecycle.seedCreatedAt = 1_752_000_000_000;

    const { result } = renderHook(() => useReinstallDetection(false));

    await waitFor(() => expect(result.current).toBe('none'));
  });

  it('flags a reinstall when a seed pre-exists without a seedCreatedAt marker', async () => {
    mockedRetrieveMnemonic.mockResolvedValue('abandon '.repeat(11).trim() + ' about');
    mockLifecycle.seedCreatedAt = null;

    const { result } = renderHook(() => useReinstallDetection(false));

    await waitFor(() => expect(result.current).toBe('detected'));
  });

  it('reports none when no seed exists', async () => {
    mockedRetrieveMnemonic.mockResolvedValue(null);

    const { result } = renderHook(() => useReinstallDetection(false));

    await waitFor(() => expect(result.current).toBe('none'));
  });

  it('skips the keychain probe entirely once onboarding has been seen', async () => {
    const { result } = renderHook(() => useReinstallDetection(true));

    await waitFor(() => expect(result.current).toBe('none'));
    expect(mockedRetrieveMnemonic).not.toHaveBeenCalled();
  });
});

jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({
  VStack: (props: object) => jest.requireActual('react').createElement('View', props),
}));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: (props: object) => jest.requireActual('react').createElement('Text', props),
}));
jest.mock('@/shared/ui/primitives/Button', () => {
  return {
    Button: ({ text, ...props }: { text: string }) =>
      jest.requireActual('react').createElement('View', props, text),
  };
});
jest.mock('@/shared/lib/popup', () => ({ actionMenuPopup: jest.fn() }));
jest.mock('@/shared/lib/profile/appRestart', () => ({ restartApp: jest.fn() }));
jest.mock('@/shared/lib/profile/profileSessionOrchestrator', () => ({
  recoverMnemonicSession: jest.fn(),
  deleteAllProfiles: jest.fn(),
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: { getState: jest.fn() },
}));

describe('AppGate locked recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSecureStoreState.setState({ secureStoreState: 'locked', errorName: 'Error' });
  });
  afterEach(() => useSecureStoreState.setState({ secureStoreState: 'available', errorName: null }));

  it('renders a blocking recovery screen and submits the phrase to session recovery', async () => {
    jest.mocked(recoverMnemonicSession).mockResolvedValue(true);
    const screen = render(
      <AppGate>{React.createElement('View', { testID: 'wallet-content' })}</AppGate>
    );
    expect(screen.getByTestId('secure-locked-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('wallet-content')).toBeNull();
    fireEvent.press(screen.getByTestId('secure-locked-import'));
    const menu = jest.mocked(actionMenuPopup).mock.calls.at(-1)![0];
    const close = jest.fn();
    await act(() =>
      menu.primaryAction!.onPress(
        { 'recovery-phrase': 'abandon '.repeat(11) + 'about' },
        { close, setError: jest.fn() }
      )
    );
    expect(recoverMnemonicSession).toHaveBeenCalledWith('abandon '.repeat(11) + 'about');
    expect(close).toHaveBeenCalled();
  });

  it('requires two confirmations before requesting a full reset', async () => {
    jest.mocked(deleteAllProfiles).mockResolvedValue(true);
    const screen = render(
      <AppGate>{React.createElement('View', { testID: 'wallet-content' })}</AppGate>
    );
    fireEvent.press(screen.getByTestId('secure-locked-fresh'));
    expect(deleteAllProfiles).not.toHaveBeenCalled();
    const first = jest.mocked(actionMenuPopup).mock.calls.at(-1)![0];
    await act(() => first.buttons![0].onPress!(jest.fn()));
    expect(deleteAllProfiles).not.toHaveBeenCalled();
    const second = jest.mocked(actionMenuPopup).mock.calls.at(-1)![0];
    await act(() => second.buttons![0].onPress!(jest.fn()));
    expect(deleteAllProfiles).toHaveBeenCalledTimes(1);
  });
});

jest.mock('@/shared/blocks/popup/ActionMenuHost', () => ({ ActionMenuHost: () => null }));
