import { StrictMode } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState, BackHandler } from 'react-native';
import { err, ok } from 'neverthrow';
import { BACKUP_HANDOFF_MS, CtaScreen } from '@/shared/blocks/CtaScreen';
import { getLatestVersion } from '@/shared/lib/apiClient';
import { CtaHost } from '@/shared/blocks/CtaHost';
import { __resetGuardForTests } from '@/shared/hooks/useGuardedRouter';
import { useCtaStore } from '@/shared/stores/global/ctaStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { useSettingsHydration, useSettingsStore } from '@/shared/stores/global/settingsStore';
import {
  ABANDONED_BACKUP_GRACE_MS,
  BACKUP_SNOOZE_MS,
  LATEST_VERSION_MAX_AGE_MS,
} from '@/shared/lib/cta/definitions';
let mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }] };
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockPreventRemove = jest.fn();
const mockSetOptions = jest.fn();
const mockAddListener = jest.fn((_event: string, _listener: () => void) => jest.fn());
const mockScreenNavigation = { setOptions: mockSetOptions, addListener: mockAddListener };

let mockBalance = 100;
jest.mock('heroui-native', () => {
  const React = require('react');
  const host = (name: string) =>
    function MockHost(props: Record<string, unknown>) {
      return React.createElement(name, props);
    };
  return {
    ControlField: Object.assign(host('Checkbox'), { Indicator: 'Indicator' }),
    Label: Object.assign(host('Label'), { Text: 'LabelText' }),
  };
});
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: () => mockBack(),
    replace: (...args: unknown[]) => mockReplace(...args),
    canGoBack: () => true,
  },
  useNavigation: () => mockScreenNavigation,
  useRootNavigationState: () => mockNavigation,
}));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0' }));
jest.mock('wallet/react', () => ({ useColadaBalance: () => ({ total: mockBalance }) }), {
  virtual: true,
});
jest.mock('@/shared/lib/qrButtonAnchor', () => ({ useBootMorphCompleted: () => true }));
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: () => ({ isOffline: false }),
}));
jest.mock('@/shared/lib/apiClient', () => ({ getLatestVersion: jest.fn() }));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (blocked: boolean) => mockPreventRemove(blocked),
}));
jest.mock('@/shared/stores/runtime/mockDataStore', () => ({ purgeLegacyMockData: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
jest.mock('@/shared/ui/composed/SheetGrabber', () => ({ SheetGrabber: 'Grabber' }));
jest.mock('@/assets/icons', () => 'Icon');
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children, footer }: React.PropsWithChildren<{ footer: React.ReactNode }>) => (
    <>
      {children}
      {footer}
    </>
  ),
}));
jest.mock('@/shared/ui/composed/ScreenScrollView', () => ({ ScreenScrollView: 'ScrollView' }));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({ BottomButtons: 'Footer' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: 'View' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: 'Button' }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/SelectableCheck', () => ({ SelectableCheck: 'Check' }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'foreground' }));
jest.mock('@/shared/lib/e2e/E2EAccessibilityProbe', () => ({ E2EAccessibilityProbe: 'Probe' }));
jest.mock('@/shared/lib/url', () => ({ openExternalUrl: jest.fn() }));
function HostWithScreen({ id }: { id?: 'update-required' | 'backup-recovery-phrase' }) {
  return (
    <>
      <CtaHost />
      {id && <CtaScreen id={id} />}
    </>
  );
}
beforeEach(async () => {
  __resetGuardForTests();
  jest.spyOn(BackHandler, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  jest.clearAllMocks();
  jest.mocked(getLatestVersion).mockResolvedValue(err(new Error('offline')));
  mockBack.mockImplementation(() => {
    expect(mockPreventRemove).toHaveBeenLastCalledWith(false);
  });
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  await useCtaStore.persist.rehydrate();
  await useSettingsStore.persist.rehydrate();
  await useWalletLifecycleStore.persist.rehydrate();
  useCtaStore.setState({
    activeId: null,
    previewOverride: null,
    dismissed: {},
    closingId: null,
    backupStartedAt: null,
  });
  useSettingsStore.setState({ lastKnownAppVersion: null, mockMode: false });
  useSettingsHydration.setState({ status: 'ready' });
  useWalletLifecycleStore.setState({
    seedCreatedAt: Date.now(),
    restoreStatus: 'complete',
    recoveryPhraseVerifiedAt: null,
    recoveryPhraseVerifiedRevision: null,
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
  const view = render(<HostWithScreen />);
  expect(mockPush).toHaveBeenCalledTimes(1);
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }, { name: 'cta' }] };
  view.rerender(<HostWithScreen />);
  await act(async () =>
    useSettingsStore.getState().setLastKnownAppVersion({ version: '2.0.0', fetchedAt: Date.now() })
  );
  expect(mockPush).toHaveBeenCalledTimes(1);
  await act(async () => {
    useCtaStore.getState().dismiss('backup-recovery-phrase', false);
  });
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }] };
  view.rerender(<HostWithScreen />);
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
  useCtaStore.setState({
    dismissed: { 'backup-recovery-phrase:snooze': { revision: 2, at: now } },
  });
  const listener = jest.spyOn(AppState, 'addEventListener');
  const view = render(<HostWithScreen />);
  expect(mockPush).not.toHaveBeenCalled();
  clock.mockReturnValue(now + BACKUP_SNOOZE_MS);
  await act(async () => listener.mock.calls.at(-1)![1]('active'));
  expect(mockPush).toHaveBeenCalledTimes(1);
  view.unmount();
});
it('does nothing during pending/failed RestoreGate and evaluates once ready', async () => {
  useWalletLifecycleStore.setState({ restoreStatus: 'pending' });
  render(<HostWithScreen />);
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => useWalletLifecycleStore.setState({ restoreStatus: 'failed' }));
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => useWalletLifecycleStore.setState({ restoreStatus: 'complete' }));
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it('reacts to balance and verification changes without showing in Mock Mode', async () => {
  mockBalance = 0;
  const view = render(<HostWithScreen />);
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => useSettingsStore.setState({ mockMode: true }));
  mockBalance = 100;
  view.rerender(<HostWithScreen />);
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => useWalletLifecycleStore.getState().markRecoveryPhraseVerified());
  await act(async () => useSettingsStore.setState({ mockMode: false }));
  expect(mockPush).not.toHaveBeenCalled();
});
it('suppresses automation but allows preview, close and reopening a dismissed CTA', async () => {
  process.env.EXPO_PUBLIC_E2E_STATE_MIRROR = '1';
  useCtaStore.getState().dismiss('backup-recovery-phrase', true);
  const view = render(<HostWithScreen />);
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () => useCtaStore.getState().preview('backup-recovery-phrase'));
  expect(mockPush).toHaveBeenCalledTimes(1);
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }, { name: 'cta' }] };
  view.rerender(<HostWithScreen />);
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }] };
  view.rerender(<HostWithScreen />);
  expect(useCtaStore.getState().previewOverride).toBeNull();
  expect(mockPush).toHaveBeenCalledTimes(1);
  await act(async () => useCtaStore.getState().preview('backup-recovery-phrase'));
  expect(mockPush).toHaveBeenCalledTimes(2);
});

it('re-previewing the same CTA re-opens it even when the previous close was never observed', async () => {
  process.env.EXPO_PUBLIC_E2E_STATE_MIRROR = '1';
  render(<HostWithScreen />);
  await act(async () => useCtaStore.getState().preview('update-required'));
  expect(mockPush).toHaveBeenCalledTimes(1);
  // The route closed without CtaHost observing a navigation change (stranded activeId).
  await act(async () => useCtaStore.getState().preview('update-required'));
  expect(mockPush).toHaveBeenCalledTimes(2);
  expect(useCtaStore.getState().activeId).toBe('update-required');
});

it('does not push twice when mount effects replay in Strict Mode', () => {
  render(
    <StrictMode>
      <HostWithScreen />
    </StrictMode>
  );
  expect(mockPush).toHaveBeenCalledTimes(1);
});

it('forces a fresh check and closes the optional route when the corrected version arrives', async () => {
  mockBalance = 0;
  useSettingsStore.setState({ lastKnownAppVersion: { version: '2.0.0', fetchedAt: Date.now() } });
  let finish!: (value: Awaited<ReturnType<typeof getLatestVersion>>) => void;
  jest.mocked(getLatestVersion).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const view = render(<HostWithScreen />);
  expect(getLatestVersion).toHaveBeenCalledTimes(1);
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }, { name: 'cta' }] };
  view.rerender(<HostWithScreen id="update-required" />);
  expect(mockPreventRemove).toHaveBeenLastCalledWith(false);
  await act(async () => finish(ok({ version: '1.0.0' })));
  expect(mockPreventRemove).toHaveBeenLastCalledWith(false);
  expect(mockBack).toHaveBeenCalledTimes(1);
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }] };
  view.rerender(<HostWithScreen />);
  expect(useCtaStore.getState().activeId).toBeNull();
  expect(mockPush).toHaveBeenCalledTimes(1);
});

it.each(['confirmed', 'unavailable'])(
  'keeps a fresh optional update prompt visible when the network is %s',
  async (result) => {
    useSettingsStore.setState({ lastKnownAppVersion: { version: '2.0.0', fetchedAt: Date.now() } });
    jest
      .mocked(getLatestVersion)
      .mockResolvedValue(
        result === 'confirmed' ? ok({ version: '2.0.0' }) : err(new Error('offline'))
      );
    const view = render(<HostWithScreen />);
    mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }, { name: 'cta' }] };
    view.rerender(<HostWithScreen id="update-required" />);
    await act(async () => {});
    expect(getLatestVersion).toHaveBeenCalledTimes(1);
    expect(mockPreventRemove).toHaveBeenLastCalledWith(false);
    expect(mockBack).not.toHaveBeenCalled();
  }
);

it.each(['primary', 'secondary'])(
  'backup %s preserves its dismissal policy through route removal and foreground',
  async (action) => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const view = render(<HostWithScreen />);
    mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }, { name: 'cta' }] };
    view.rerender(<HostWithScreen id="backup-recovery-phrase" />);
    await act(async () => fireEvent.press(view.UNSAFE_getByProps({ testID: `cta-${action}` })));
    act(() => mockAddListener.mock.calls.at(-1)![1]());
    mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }] };
    view.rerender(<HostWithScreen />);
    if (action === 'primary') {
      expect(useCtaStore.getState().dismissed).toEqual({});
      expect(useWalletLifecycleStore.getState().recoveryPhraseVerifiedAt).toBeNull();
      // The flow is presented after the sheet dismisses (BACKUP_HANDOFF_MS); the
      // host itself never pushes it.
      await act(async () => new Promise((r) => setTimeout(r, BACKUP_HANDOFF_MS + 50)));
      expect(mockPush).toHaveBeenCalledWith('/(backup-flow)/intro');
    } else {
      expect(useCtaStore.getState().dismissed['backup-recovery-phrase:snooze']).toEqual({
        at: now,
        revision: 2,
      });
    }
    // primary: the cta push plus the backup-flow push; secondary: the cta push only.
    expect(mockPush).toHaveBeenCalledTimes(action === 'primary' ? 2 : 1);
    const foreground = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
    clock.mockReturnValue(now + ABANDONED_BACKUP_GRACE_MS - 1);
    await act(async () => foreground('active'));
    expect(mockPush).toHaveBeenCalledTimes(action === 'primary' ? 2 : 1);
    clock.mockReturnValue(now + ABANDONED_BACKUP_GRACE_MS);
    await act(async () => foreground('active'));
    expect(mockPush).toHaveBeenCalledTimes(action === 'primary' ? 3 : 1);
  }
);

it('closes an offline update prompt when its cache becomes stale on foreground', async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  useSettingsStore.setState({ lastKnownAppVersion: { version: '2.0.0', fetchedAt: now } });
  const view = render(<HostWithScreen />);
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }, { name: 'cta' }] };
  view.rerender(<HostWithScreen id="update-required" />);
  await act(async () => {});
  const foreground = jest.mocked(AppState.addEventListener).mock.calls[1][1];
  clock.mockReturnValue(now + LATEST_VERSION_MAX_AGE_MS + 1);
  await act(async () => foreground('active'));
  expect(mockPreventRemove).toHaveBeenLastCalledWith(false);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('hands off a directly opened CTA route even without a reserved active ID', async () => {
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }, { name: 'cta' }] };
  const view = render(<HostWithScreen id="backup-recovery-phrase" />);
  expect(useCtaStore.getState().activeId).toBeNull();
  await act(async () => fireEvent.press(view.UNSAFE_getByProps({ testID: 'cta-primary' })));
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }] };
  view.rerender(<HostWithScreen />);
  expect(mockBack).toHaveBeenCalledTimes(1);
  await act(async () => new Promise((r) => setTimeout(r, BACKUP_HANDOFF_MS + 50)));
  expect(mockPush).toHaveBeenCalledWith('/(backup-flow)/intro');
});
it('allows an optional update prompt during backup, but never stacks another backup nag', async () => {
  mockNavigation = { key: 'root', routes: [{ name: '(drawer)' }, { name: '(backup-flow)' }] };
  render(<HostWithScreen />);
  expect(mockPush).not.toHaveBeenCalled();
  await act(async () =>
    useSettingsStore.getState().setLastKnownAppVersion({ version: '2.0.0', fetchedAt: Date.now() })
  );
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/cta', params: { id: 'update-required' } });
});
