/* eslint-disable import/first */

const VALID_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(VALID_MNEMONIC)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

const mockExportSeed = jest.fn<Promise<void>, [string]>();
jest.mock('@/shared/lib/nostr/e2eSeedExport', () => ({
  maybeExportSeedForE2E: (mnemonic: string) => mockExportSeed(mnemonic),
}));

import { act, renderHook } from '@testing-library/react-native';

import { nostrLog } from '@/shared/lib/logger';
import { useMnemonic } from '@/shared/lib/nostr/secureStorage';
import { useSecureStoreState } from '@/shared/stores/runtime/secureStoreState';

describe('useMnemonic.refresh', () => {
  it('clears loading when the read throws', async () => {
    mockExportSeed.mockRejectedValueOnce(new Error('bad e2e export config'));
    const hook = renderHook(() => useMnemonic(false));

    await act(async () => {
      await expect(hook.result.current.refresh()).rejects.toThrow('bad e2e export config');
    });

    expect(hook.result.current.loading).toBe(false);
  });

  it('does not report locked keys when only the development seed export fails on mount', async () => {
    mockExportSeed.mockRejectedValueOnce(new Error('bad e2e export config'));
    const hook = renderHook(() => useMnemonic());

    await act(async () => {});

    expect(hook.result.current.loading).toBe(false);
    expect(useSecureStoreState.getState().secureStoreState).toBe('available');
    expect(nostrLog.warn).toHaveBeenCalledWith(
      'nostr.secure.mnemonic_autoload_failed',
      expect.anything()
    );
  });

  it('loads the stored phrase', async () => {
    mockExportSeed.mockResolvedValue(undefined);
    const hook = renderHook(() => useMnemonic(false));

    await act(async () => {
      await hook.result.current.refresh();
    });

    expect(hook.result.current).toMatchObject({ value: VALID_MNEMONIC, loading: false });
  });
});
