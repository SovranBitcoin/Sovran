/**
 * @jest-environment node
 *
 * Regression: boot auto-generates a seed (ensureMnemonicExists) in parallel
 * with the Terms gate, so on a genuinely fresh install useReinstallDetection's
 * keychain probe finds the just-created seed. Before consulting
 * walletLifecycleStore.seedCreatedAt this raced every fresh install into
 * 'detected' and silently skipped the onboarding carousel.
 */

import { renderHook, waitFor } from '@testing-library/react-native';

import { useReinstallDetection } from '@/shared/blocks/AppGate';
import { retrieveMnemonic } from '@/shared/lib/nostr/secureStorage';

const mockLifecycle: { seedCreatedAt: number | null } = { seedCreatedAt: null };

jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  retrieveMnemonic: jest.fn(),
}));

jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: Object.assign(jest.fn(), {
    persist: {
      hasHydrated: () => true,
      onFinishHydration: () => () => {},
    },
  }),
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
