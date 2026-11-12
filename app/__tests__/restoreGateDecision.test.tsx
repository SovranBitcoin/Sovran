/**
 * @jest-environment node
 *
 * Characterization of the restore gate inside AppGate: for each saved restore
 * status, whether the keychain is read, what status is written back, and
 * whether the recovery screen or the app is shown. Runs against the real wallet
 * lifecycle store; the keychain read, the earlier gates' inputs (settings, keys)
 * and the screens are replaced.
 */

import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import AppGate from '@/shared/blocks/AppGate';
import { retrieveMnemonic } from '@/shared/lib/nostr/secureStorage';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';

let mockOnRecoveryComplete: (() => void) | undefined;

jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  retrieveMnemonic: jest.fn(),
}));
// Terms accepted and onboarding seen, so AppGate reaches the restore gate.
jest.mock('@/shared/lib/legal/legalDocuments', () => ({
  hasCurrentLegalAcceptance: () => true,
}));
jest.mock('@/shared/stores/global/settingsStore', () => {
  const state = {
    legalAcceptance: {},
    hasSeenOnboarding: true,
    acceptLegalDocuments: () => undefined,
    completeOnboarding: () => undefined,
  };
  return {
    useSettingsStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
      getState: () => state,
      persist: { hasHydrated: () => true, onFinishHydration: () => () => undefined },
    }),
  };
});
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ isReady: true, isLoading: false, error: null }),
}));
jest.mock('@/features/settings/screens/SettingsRecoveryScreen', () => ({
  SettingsRecoveryScreen: ({ onComplete }: { onComplete: () => void }) => {
    mockOnRecoveryComplete = onComplete;
    return 'recovery screen';
  },
}));
jest.mock('@/shared/blocks/KeyRecoveryScreen', () => ({ KeyRecoveryScreen: () => null }));
jest.mock('@/features/onboarding/screens/TermsAndConditionsScreen', () => ({
  TermsAndConditionsScreen: () => null,
}));
jest.mock('@/features/onboarding/components/OnboardingScreen', () => ({
  __esModule: true,
  default: () => null,
}));

const mockedRetrieveMnemonic = jest.mocked(retrieveMnemonic);
const MNEMONIC = `${'abandon '.repeat(11)}about`;
const MARKER = 1_752_000_000_000;

type Status = 'unknown' | 'not-needed' | 'pending' | 'in-progress' | 'complete' | 'failed';

let hydrated = true;

function seed(restoreStatus: Status, seedCreatedAt: number | null) {
  useWalletLifecycleStore.setState({ restoreStatus, seedCreatedAt });
}

async function renderGate() {
  render(
    <AppGate>
      <Text>wallet home</Text>
    </AppGate>
  );
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

/** Which page is on screen. The node preset renders react-native-web hosts, so read the tree. */
function shown(): 'wallet' | 'recovery' | 'nothing' {
  const tree = JSON.stringify(screen.toJSON());
  if (tree.includes('wallet home')) return 'wallet';
  if (tree.includes('recovery screen')) return 'recovery';
  return 'nothing';
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  hydrated = true;
  jest.spyOn(useWalletLifecycleStore.persist, 'hasHydrated').mockImplementation(() => hydrated);
  mockedRetrieveMnemonic.mockReset();
  mockOnRecoveryComplete = undefined;
  seed('unknown', null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('restore gate decision table', () => {
  it('shows nothing and reads no keychain before the lifecycle store has loaded', async () => {
    // Held by AppGate's reinstall check, which waits for the same hydration, before the
    // restore gate's own wait is reached; removing only the restore gate's wait keeps this green.
    hydrated = false;
    seed('unknown', null);

    await renderGate();

    expect(shown()).toBe('nothing');
    expect(mockedRetrieveMnemonic).not.toHaveBeenCalled();
  });

  it.each(['complete', 'not-needed'] as const)(
    'opens the app for %s without reading the keychain',
    async (status) => {
      seed(status, null);

      await renderGate();

      expect(shown()).toBe('wallet');
      expect(mockedRetrieveMnemonic).not.toHaveBeenCalled();
    }
  );

  it('shows recovery for pending without reading the keychain', async () => {
    seed('pending', MARKER);

    await renderGate();

    expect(shown()).toBe('recovery');
    expect(mockedRetrieveMnemonic).not.toHaveBeenCalled();
  });

  it('marks restore pending and shows recovery when a seed exists that this install did not create', async () => {
    mockedRetrieveMnemonic.mockResolvedValue(MNEMONIC);
    seed('unknown', null);

    await renderGate();

    expect(useWalletLifecycleStore.getState().restoreStatus).toBe('pending');
    expect(shown()).toBe('recovery');
  });

  it('marks restore not needed and opens the app when this install created the seed', async () => {
    mockedRetrieveMnemonic.mockResolvedValue(MNEMONIC);
    seed('unknown', MARKER);

    await renderGate();

    expect(useWalletLifecycleStore.getState().restoreStatus).toBe('not-needed');
    expect(shown()).toBe('wallet');
  });

  it('leaves the status alone and opens the app when there is no seed yet', async () => {
    mockedRetrieveMnemonic.mockResolvedValue(null);
    seed('unknown', null);

    await renderGate();

    expect(useWalletLifecycleStore.getState().restoreStatus).toBe('unknown');
    expect(shown()).toBe('wallet');
  });

  it('shows nothing while the keychain read is still out', async () => {
    mockedRetrieveMnemonic.mockReturnValue(new Promise(() => undefined));
    seed('unknown', null);

    await renderGate();

    expect(shown()).toBe('nothing');
  });

  it.each([
    ['in-progress', MARKER, 'not-needed', 'wallet'],
    ['in-progress', null, 'pending', 'recovery'],
    ['failed', MARKER, 'not-needed', 'wallet'],
    ['failed', null, 'pending', 'recovery'],
  ] as const)(
    're-decides a saved %s status from the seed marker (%s)',
    async (status, marker, written, page) => {
      mockedRetrieveMnemonic.mockResolvedValue(MNEMONIC);
      seed(status, marker);

      await renderGate();

      // QUIRK: 'in-progress' and 'failed' are treated like 'unknown', so a failed restore on
      // an install that created its own seed is quietly turned into 'not-needed'. A change
      // that keeps 'failed' blocking should change this assertion on purpose.
      expect(mockedRetrieveMnemonic).toHaveBeenCalledTimes(1);
      expect(useWalletLifecycleStore.getState().restoreStatus).toBe(written);
      expect(shown()).toBe(page);
    }
  );

  it.each([
    ['in-progress', 'wallet'],
    ['failed', 'recovery'],
  ] as const)(
    'with no seed yet, leaves a saved %s status alone and shows the %s',
    async (status, page) => {
      // QUIRK: the gate re-decides both from the keychain, but with nothing
      // there it keeps the saved status and judges it by what it shows:
      // 'failed' holds the app on recovery, 'in-progress' opens it.
      mockedRetrieveMnemonic.mockResolvedValue(null);
      seed(status, null);

      await renderGate();

      expect(useWalletLifecycleStore.getState().restoreStatus).toBe(status);
      expect(shown()).toBe(page);
    }
  );

  it('opens the app and records the seed once recovery completes', async () => {
    seed('pending', null);
    await renderGate();
    expect(shown()).toBe('recovery');

    await act(async () => mockOnRecoveryComplete!());

    expect(useWalletLifecycleStore.getState()).toMatchObject({ restoreStatus: 'complete' });
    expect(useWalletLifecycleStore.getState().seedCreatedAt).toEqual(expect.any(Number));
    expect(shown()).toBe('wallet');
  });
});
