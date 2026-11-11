/**
 * @jest-environment node
 *
 * Characterization of AppGate's gate order: for each combination of the secure
 * store state, the Nostr keys status, settings hydration, legal acceptance,
 * onboarding and the reinstall probe, which page is shown in place of the
 * wallet and what each page's callback writes. Runs against the real settings,
 * wallet lifecycle and secure store state stores; the keychain read, the keys
 * context and the leaf screens are replaced. The restore gate's own table is
 * pinned in restoreGateDecision.test.tsx; here the lifecycle store says the
 * restore is complete unless a case says otherwise.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import AppGate from '@/shared/blocks/AppGate';
import { legalRevisions } from '@/shared/lib/legal/legalDocuments';
import { retrieveMnemonic } from '@/shared/lib/nostr/secureStorage';
import { markHydrationFailed, markHydrationStarted } from '@/shared/lib/persist/hydrationOutcome';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { useSecureStoreState } from '@/shared/stores/runtime/secureStoreState';

type Keys = { isReady: boolean; isLoading: boolean; error: Error | null };
type TermsProps = { onClose: () => void; settingsError?: boolean; onRetry?: () => void };

let mockKeys: Keys = { isReady: true, isLoading: false, error: null };
let mockTerms: TermsProps | undefined;
let mockOnboardingComplete: (() => void) | undefined;
let mockKeyRecoveryLocked: boolean | undefined;

jest.mock('@react-native-async-storage/async-storage', () => {
  const disk: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => disk[k] ?? null,
      setItem: async (k: string, v: string) => {
        disk[k] = v;
      },
      removeItem: async (k: string) => {
        delete disk[k];
      },
    },
  };
});
jest.mock('@/shared/lib/nostr/secureStorage', () => ({ retrieveMnemonic: jest.fn() }));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => mockKeys,
}));
jest.mock('@/shared/blocks/KeyRecoveryScreen', () => ({
  KeyRecoveryScreen: ({ locked }: { locked?: boolean }) => {
    mockKeyRecoveryLocked = locked;
    return 'key recovery screen';
  },
}));
jest.mock('@/features/onboarding/screens/TermsAndConditionsScreen', () => ({
  TermsAndConditionsScreen: (props: TermsProps) => {
    mockTerms = props;
    return props.settingsError ? 'settings error screen' : 'terms screen';
  },
}));
jest.mock('@/features/onboarding/components/OnboardingScreen', () => ({
  __esModule: true,
  default: ({ onComplete }: { onComplete: () => void }) => {
    mockOnboardingComplete = onComplete;
    return 'onboarding screen';
  },
}));
jest.mock('@/features/settings/screens/SettingsRecoveryScreen', () => ({
  SettingsRecoveryScreen: () => 'recovery screen',
}));

const mockedRetrieveMnemonic = jest.mocked(retrieveMnemonic);
const MNEMONIC = `${'abandon '.repeat(11)}about`;
const CURRENT = {
  termsRevision: legalRevisions.terms,
  privacyRevision: legalRevisions.privacy,
  acceptedAt: '2026-01-01T00:00:00.000Z',
};

type Page =
  'wallet' | 'key recovery' | 'settings error' | 'terms' | 'onboarding' | 'recovery' | 'nothing';

function shown(): Page {
  const tree = JSON.stringify(screen.toJSON());
  for (const page of [
    'wallet',
    'key recovery',
    'settings error',
    'terms',
    'onboarding',
    'recovery',
  ] as const) {
    if (tree.includes(page === 'wallet' ? 'wallet home' : `${page} screen`)) return page;
  }
  return 'nothing';
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

async function renderGate() {
  render(
    <AppGate>
      <Text>wallet home</Text>
    </AppGate>
  );
  await settle();
}

function given(state: {
  locked?: boolean;
  keys?: Partial<Keys>;
  hydration?: 'loading' | 'ready' | 'error';
  legal?: typeof CURRENT | null;
  seenOnboarding?: boolean;
}) {
  useSecureStoreState.setState({
    secureStoreState: state.locked ? 'locked' : 'available',
    errorName: state.locked ? 'Error' : null,
  });
  mockKeys = { isReady: true, isLoading: false, error: null, ...state.keys };
  const hydration = state.hydration ?? 'ready';
  jest.mocked(useSettingsStore.persist.hasHydrated).mockReturnValue(hydration === 'ready');
  if (hydration === 'error') markHydrationFailed('settings-store');
  useSettingsStore.setState({
    legalAcceptance: state.legal === undefined ? CURRENT : state.legal,
    termsAccepted: null,
    hasSeenOnboarding: state.seenOnboarding ?? true,
  });
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  jest.spyOn(useSettingsStore.persist, 'hasHydrated').mockReturnValue(true);
  jest.spyOn(useWalletLifecycleStore.persist, 'hasHydrated').mockReturnValue(true);
  mockedRetrieveMnemonic.mockReset();
  mockedRetrieveMnemonic.mockResolvedValue(null);
  mockTerms = undefined;
  mockOnboardingComplete = undefined;
  mockKeyRecoveryLocked = undefined;
  useWalletLifecycleStore.setState({ restoreStatus: 'complete', seedCreatedAt: 1 });
});

afterEach(() => {
  jest.restoreAllMocks();
  markHydrationStarted('settings-store');
  useSecureStoreState.setState({ secureStoreState: 'available', errorName: null });
});

describe('AppGate order', () => {
  it('shows the locked key recovery before anything else', async () => {
    given({
      locked: true,
      keys: { isReady: false, error: new Error('keys') },
      hydration: 'error',
      legal: null,
      seenOnboarding: false,
    });

    await renderGate();

    expect(shown()).toBe('key recovery');
    expect(mockKeyRecoveryLocked).toBeUndefined();
  });

  it('shows the unlocked key recovery for a keys error before settings have loaded', async () => {
    given({
      keys: { isReady: false, error: new Error('keys') },
      hydration: 'loading',
      legal: null,
    });

    await renderGate();

    expect(shown()).toBe('key recovery');
    expect(mockKeyRecoveryLocked).toBe(false);
  });

  it('ignores a keys error once the keys are ready', async () => {
    given({ keys: { isReady: true, error: new Error('on-demand read failed') } });

    await renderGate();

    expect(shown()).toBe('wallet');
  });

  it('shows nothing while settings are loading, even with terms unaccepted', async () => {
    given({ hydration: 'loading', legal: null, seenOnboarding: false });

    await renderGate();

    expect(shown()).toBe('nothing');
  });

  it('shows the settings error page, whose retry goes back to loading and rereads settings', async () => {
    given({ hydration: 'error', legal: null });
    // A read starting is all the page waits for; the read itself is pinned below.
    const rehydrate = jest
      .spyOn(useSettingsStore.persist, 'rehydrate')
      .mockImplementation(async () => markHydrationStarted('settings-store'));

    await renderGate();
    expect(shown()).toBe('settings error');
    expect(mockTerms?.settingsError).toBe(true);

    await act(async () => mockTerms!.onRetry!());

    expect(rehydrate).toHaveBeenCalledTimes(1);
    expect(shown()).toBe('nothing');
  });

  it('shows the settings error page for settings it cannot read, and the wallet once a retry reads them', async () => {
    given({});
    jest.mocked(useSettingsStore.persist.hasHydrated).mockRestore();
    await AsyncStorage.setItem('settings-store', '{not json');
    await act(async () => useSettingsStore.persist.rehydrate());

    await renderGate();
    expect(shown()).toBe('settings error');

    const saved = { legalAcceptance: CURRENT, hasSeenOnboarding: true };
    await AsyncStorage.setItem('settings-store', JSON.stringify({ state: saved, version: 0 }));
    await act(async () => mockTerms!.onRetry!());
    await settle();

    expect(shown()).toBe('wallet');
  });

  it('shows terms before onboarding, and accepting writes the current revisions', async () => {
    given({ legal: null, seenOnboarding: false, keys: { isReady: false, isLoading: true } });

    await renderGate();
    expect(shown()).toBe('terms');
    expect(mockTerms?.settingsError).toBeUndefined();

    await act(async () => mockTerms!.onClose());
    await settle();

    const settings = useSettingsStore.getState();
    expect(settings.legalAcceptance).toMatchObject({
      termsRevision: legalRevisions.terms,
      privacyRevision: legalRevisions.privacy,
    });
    expect(settings.termsAccepted).toMatchObject({ termsAccepted: true });
    expect(shown()).toBe('onboarding');
  });

  it('shows terms again when the accepted revision is out of date', async () => {
    given({ legal: { ...CURRENT, termsRevision: 'old' } });

    await renderGate();

    expect(shown()).toBe('terms');
  });

  it('shows nothing while the reinstall probe is still reading the keychain', async () => {
    given({ seenOnboarding: false });
    mockedRetrieveMnemonic.mockReturnValue(new Promise(() => undefined));

    await renderGate();

    expect(shown()).toBe('nothing');
  });

  it('shows onboarding when no seed exists, and completing it opens the app', async () => {
    given({ seenOnboarding: false });

    await renderGate();
    expect(shown()).toBe('onboarding');

    await act(async () => mockOnboardingComplete!());
    await settle();

    expect(useSettingsStore.getState().hasSeenOnboarding).toBe(true);
    expect(shown()).toBe('wallet');
  });

  it('skips onboarding on a reinstall and sends the wallet to the recovery gate', async () => {
    given({ seenOnboarding: false });
    useWalletLifecycleStore.setState({ restoreStatus: 'unknown', seedCreatedAt: null });
    mockedRetrieveMnemonic.mockResolvedValue(MNEMONIC);

    await renderGate();

    // QUIRK: AppGate writes hasSeenOnboarding during render (completeOnboarding() in the
    // reinstall branch), not in an effect or a callback.
    expect(useSettingsStore.getState().hasSeenOnboarding).toBe(true);
    expect(useWalletLifecycleStore.getState().restoreStatus).toBe('pending');
    expect(shown()).toBe('recovery');
  });

  it.each([
    ['loading', { isReady: false, isLoading: true }],
    ['not ready', { isReady: false, isLoading: false }],
    ['ready but still loading', { isReady: true, isLoading: true }],
  ] as const)('shows nothing after onboarding while keys are %s', async (_label, keys) => {
    given({ keys });

    await renderGate();

    expect(shown()).toBe('nothing');
  });

  it('opens the wallet when every gate passes', async () => {
    given({});

    await renderGate();

    expect(shown()).toBe('wallet');
  });
});
