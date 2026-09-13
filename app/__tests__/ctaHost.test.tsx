import { StrictMode } from 'react';
import { act, render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { CtaHost } from '@/shared/blocks/CtaHost';
import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { BACKUP_SNOOZE_MS } from '@/shared/lib/cta/definitions';
let mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }] };
const mockPush = jest.fn();
let mockBalance = 100;
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useRootNavigationState: () => mockNavigation,
}));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0' }));
jest.mock('wallet/react', () => ({ useColadaBalance: () => ({ total: mockBalance }) }), {
  virtual: true,
});
jest.mock('@/shared/hooks/useLatestVersionFetch', () => ({ useLatestVersionFetch: () => {} }));
jest.mock('@/shared/stores/runtime/mockDataStore', () => ({ purgeLegacyMockData: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
beforeEach(async () => {
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  await useCtaStore.persist.rehydrate();
  await useSettingsStore.persist.rehydrate();
  await useWalletLifecycleStore.persist.rehydrate();
  useCtaStore.setState({ activeId: null, previewOverride: null, dismissed: {} });
  useSettingsStore.setState({ lastKnownAppVersion: null, mockMode: false });
  useWalletLifecycleStore.setState({
    seedCreatedAt: Date.now(),
    restoreStatus: 'complete',
    recoveryPhraseVerifiedAt: null,
  });
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }] };
  mockPush.mockClear();
  mockBalance = 100;
  delete process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
});
it('reserves one modal and re-evaluates on close with a version received while covered', async () => {
  const view = render(<CtaHost />);
  expect(mockPush).toHaveBeenCalledTimes(1);
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }, { name: 'cta' }] };
  view.rerender(<CtaHost />);
  await act(async () =>
    useSettingsStore.getState().setLastKnownAppVersion({ version: '2.0.0', fetchedAt: Date.now() })
  );
  expect(mockPush).toHaveBeenCalledTimes(1);
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }] };
  view.rerender(<CtaHost />);
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/cta',
    params: { id: 'update-required' },
  });
  expect(mockPush).toHaveBeenCalledTimes(2);
  expect(useCtaStore.getState().dismissed['backup-recovery-phrase:snooze']).toBeDefined();
});
it('re-evaluates an expired snooze on foreground', async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  useCtaStore.setState({ dismissed: { 'backup-recovery-phrase:snooze': { at: now } } });
  const listener = jest.spyOn(AppState, 'addEventListener');
  const view = render(<CtaHost />);
  expect(mockPush).not.toHaveBeenCalled();
  clock.mockReturnValue(now + BACKUP_SNOOZE_MS);
  await act(async () => listener.mock.calls.at(-1)![1]('active'));
  expect(mockPush).toHaveBeenCalledTimes(1);
  view.unmount();
});
it('does nothing during pending/failed RestoreGate and evaluates once ready', async () => {
  useWalletLifecycleStore.setState({ restoreStatus: 'pending' });
  render(<CtaHost />);
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => useWalletLifecycleStore.setState({ restoreStatus: 'failed' }));
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => useWalletLifecycleStore.setState({ restoreStatus: 'complete' }));
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it('reacts to balance and verification changes without showing in Mock Mode', async () => {
  mockBalance = 0;
  const view = render(<CtaHost />);
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => useSettingsStore.setState({ mockMode: true }));
  mockBalance = 100;
  view.rerender(<CtaHost />);
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => useWalletLifecycleStore.getState().markRecoveryPhraseVerified());
  await act(async () => useSettingsStore.setState({ mockMode: false }));
  expect(mockPush).not.toHaveBeenCalled();
});
it('suppresses automation but allows preview, close and reopening a dismissed CTA', async () => {
  process.env.EXPO_PUBLIC_E2E_STATE_MIRROR = '1';
  useCtaStore.getState().dismiss('backup-recovery-phrase', true);
  const view = render(<CtaHost />);
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => useCtaStore.getState().preview('backup-recovery-phrase'));
  expect(mockPush).toHaveBeenCalledTimes(1);
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }, { name: 'cta' }] };
  view.rerender(<CtaHost />);
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }] };
  view.rerender(<CtaHost />);
  expect(useCtaStore.getState().previewOverride).toBeNull();
  expect(mockPush).toHaveBeenCalledTimes(1);
  await act(async () => useCtaStore.getState().preview('backup-recovery-phrase'));
  expect(mockPush).toHaveBeenCalledTimes(2);
});

it('does not push twice when mount effects replay in Strict Mode', () => {
  render(
    <StrictMode>
      <CtaHost />
    </StrictMode>
  );
  expect(mockPush).toHaveBeenCalledTimes(1);
});
