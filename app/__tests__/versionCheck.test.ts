import { act, renderHook } from '@testing-library/react-native';
import { err, ok } from 'neverthrow';

import { getLatestVersion } from '@/shared/lib/apiClient';
import { paramPopup } from '@/shared/lib/popup';
import { useVersionCheck } from '@/shared/hooks/useVersionCheck';
import { useSettingsHydration, useSettingsStore } from '@/shared/stores/global/settingsStore';

let mockBootDone = true;
let mockIsOffline = false;
let mockNativeVersion: string | null = '0.1.1';

jest.mock('expo-application', () => ({
  get nativeApplicationVersion() {
    return mockNativeVersion;
  },
}));
jest.mock('@/shared/lib/qrButtonAnchor', () => ({
  useBootMorphCompleted: () => mockBootDone,
}));
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: () => ({ isOffline: mockIsOffline }),
}));
jest.mock('@/shared/lib/apiClient', () => ({ getLatestVersion: jest.fn() }));
jest.mock('@/shared/lib/popup', () => ({ paramPopup: jest.fn() }));
jest.mock('@/shared/stores/runtime/mockDataStore', () => ({ purgeLegacyMockData: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const mockGetLatestVersion = jest.mocked(getLatestVersion);
const cached = { version: '0.1.3', minVersion: '0.1.2', message: 'Please update', fetchedAt: 123 };

async function mount() {
  const view = renderHook(useVersionCheck);
  await act(async () => {});
  return view;
}

beforeEach(async () => {
  await useSettingsStore.persist.rehydrate();
  jest.clearAllMocks();
  useSettingsStore.setState({ lastKnownAppVersion: null });
  useSettingsHydration.setState({ status: 'ready' });
  mockBootDone = true;
  mockIsOffline = false;
  mockNativeVersion = '0.1.1';
  mockGetLatestVersion.mockResolvedValue(ok({ version: '0.1.3' }));
});

it('waits for boot and settings hydration, then persists success and shows the advisory', async () => {
  mockBootDone = false;
  useSettingsHydration.setState({ status: 'loading' });
  const view = await mount();
  expect(mockGetLatestVersion).not.toHaveBeenCalled();
  mockBootDone = true;
  view.rerender({});
  expect(mockGetLatestVersion).not.toHaveBeenCalled();

  const payload = { version: '0.1.3', minVersion: '0.1.2', message: 'Please update' };
  mockGetLatestVersion.mockResolvedValueOnce(ok(payload));
  const beforeFetch = Date.now();
  await act(async () => useSettingsHydration.setState({ status: 'ready' }));

  expect(mockGetLatestVersion).toHaveBeenCalledTimes(1);
  expect(mockGetLatestVersion).toHaveBeenCalledWith({
    storage: { version: '0.1.1' },
    signal: expect.any(AbortSignal),
  });
  expect(useSettingsStore.getState().lastKnownAppVersion).toEqual({
    ...payload,
    fetchedAt: expect.any(Number),
  });
  expect(useSettingsStore.getState().lastKnownAppVersion?.fetchedAt).toBeGreaterThanOrEqual(
    beforeFetch
  );
  expect(paramPopup).toHaveBeenCalledWith('new-version', {
    version: payload.version,
    message: payload.message,
  });
});

it('compares the persisted version offline without fetching or changing its timestamp', async () => {
  mockIsOffline = true;
  useSettingsStore.setState({ lastKnownAppVersion: cached });
  await mount();
  expect(mockGetLatestVersion).not.toHaveBeenCalled();
  expect(useSettingsStore.getState().lastKnownAppVersion).toEqual(cached);
  expect(paramPopup).toHaveBeenCalledWith('new-version', {
    version: cached.version,
    message: cached.message,
  });
});

it('does nothing offline without a cached version', async () => {
  mockIsOffline = true;
  await mount();
  expect(mockGetLatestVersion).not.toHaveBeenCalled();
  expect(paramPopup).not.toHaveBeenCalled();
});

it.each(['0.1.3', '0.1.10'])(
  'does not prompt offline when native version %s is current',
  async (version) => {
    mockIsOffline = true;
    mockNativeVersion = version;
    useSettingsStore.setState({ lastKnownAppVersion: cached });
    await mount();
    expect(paramPopup).not.toHaveBeenCalled();
  }
);

it('retains and compares the cache if a fetch fails before offline detection', async () => {
  useSettingsStore.setState({ lastKnownAppVersion: cached });
  mockGetLatestVersion.mockResolvedValueOnce(err(new Error('Network request failed')));
  await mount();
  expect(useSettingsStore.getState().lastKnownAppVersion).toEqual(cached);
  expect(paramPopup).toHaveBeenCalledTimes(1);
});

it('refreshes on reconnect without prompting twice for the same version', async () => {
  mockIsOffline = true;
  useSettingsStore.setState({ lastKnownAppVersion: cached });
  const view = await mount();
  mockIsOffline = false;
  view.rerender({});
  await act(async () => {});
  expect(mockGetLatestVersion).toHaveBeenCalledTimes(1);
  expect(paramPopup).toHaveBeenCalledTimes(1);
  expect(useSettingsStore.getState().lastKnownAppVersion?.fetchedAt).toBeGreaterThan(123);
});

it('persists a successful response even when the native version is current', async () => {
  mockNativeVersion = '0.1.3';
  await mount();
  expect(useSettingsStore.getState().lastKnownAppVersion?.version).toBe('0.1.3');
  expect(paramPopup).not.toHaveBeenCalled();
});

it('does not fetch without a native version', async () => {
  mockNativeVersion = null;
  await mount();
  expect(mockGetLatestVersion).not.toHaveBeenCalled();
});

it('discards a late response after unmount', async () => {
  let finish!: (value: Awaited<ReturnType<typeof getLatestVersion>>) => void;
  mockGetLatestVersion.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const view = await mount();
  view.unmount();
  expect(mockGetLatestVersion.mock.calls[0][0].signal?.aborted).toBe(true);
  await act(async () => finish(ok({ version: '0.1.4' })));
  expect(useSettingsStore.getState().lastKnownAppVersion).toBeNull();
  expect(paramPopup).not.toHaveBeenCalled();
});
