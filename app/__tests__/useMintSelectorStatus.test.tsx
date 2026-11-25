/**
 * A new account's header pill: while nothing is selected and the default mint
 * is still being added it holds its skeleton (`pending`), then shows the mint;
 * a wallet that settles with no mints says "Add a mint". It never shows an
 * empty name and "0 sats" in between.
 */
import { act, renderHook } from '@testing-library/react-native';

import {
  ADD_MINT_LABEL,
  mintSelectorStatus,
  useMintSelector,
} from '@/features/wallet/components/MintSelector/useMintSelector';
import { useDefaultMintSetupStore } from '@/shared/stores/runtime/defaultMintSetupStore';

const MINT = 'https://mint.example';
const mockWallet: {
  mints: { mintUrl: string; name: string }[];
  isLoading: boolean;
  selectedMint: string | undefined;
} = { mints: [], isLoading: true, selectedMint: undefined };

jest.mock('@cashu/coco-react', () => ({
  useBalanceContext: () => ({ balances: { byMintAndUnit: {} } }),
}));
jest.mock('@/features/mint', () => ({
  useMintManagement: () => ({ mints: mockWallet.mints, isLoading: mockWallet.isLoading }),
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: (selector: (state: { selectedMint?: string }) => unknown) =>
    selector({ selectedMint: mockWallet.selectedMint }),
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (state: { mockMode: boolean }) => unknown) =>
    selector({ mockMode: false }),
}));
jest.mock('@/shared/stores/runtime/mockDataStore', () => ({ getMockMintBalance: () => 0 }));
jest.mock('@/shared/lib/logger', () => {
  const quiet = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    walletLog: quiet,
    cashuLog: quiet,
    storeLog: quiet,
    log: quiet,
    mintUrlLogFields: () => ({}),
  };
});

beforeEach(() => {
  mockWallet.mints = [];
  mockWallet.isLoading = true;
  mockWallet.selectedMint = undefined;
  useDefaultMintSetupStore.setState({ settled: false });
});

describe('mintSelectorStatus', () => {
  it('is pending with nothing selected until the mints load and the setup settles', () => {
    const base = { mintUrl: undefined, hasMintData: false };
    expect(mintSelectorStatus({ ...base, isMintsLoading: true, defaultMintsSettled: false })).toBe(
      'pending'
    );
    expect(mintSelectorStatus({ ...base, isMintsLoading: false, defaultMintsSettled: false })).toBe(
      'pending'
    );
    expect(mintSelectorStatus({ ...base, isMintsLoading: true, defaultMintsSettled: true })).toBe(
      'pending'
    );
    expect(mintSelectorStatus({ ...base, isMintsLoading: false, defaultMintsSettled: true })).toBe(
      'ready'
    );
  });

  it('is loading only for a selected mint whose details have not arrived', () => {
    const selected = { mintUrl: MINT, defaultMintsSettled: false };
    expect(mintSelectorStatus({ ...selected, hasMintData: false, isMintsLoading: true })).toBe(
      'loading'
    );
    expect(mintSelectorStatus({ ...selected, hasMintData: true, isMintsLoading: true })).toBe(
      'ready'
    );
    expect(mintSelectorStatus({ ...selected, hasMintData: false, isMintsLoading: false })).toBe(
      'ready'
    );
  });
});

describe('useMintSelector on a new account', () => {
  it('holds the skeleton through default-mint setup, then shows the mint', () => {
    const { result, rerender } = renderHook(() => useMintSelector({}));
    expect(result.current.status).toBe('pending');
    expect(result.current.isLoading).toBe(true);
    expect(result.current.ctaLabel).toBeUndefined();

    // Mints have loaded (none yet); the default mint is still being added.
    mockWallet.isLoading = false;
    rerender({});
    expect(result.current.status).toBe('pending');
    expect(result.current.ctaLabel).toBeUndefined();

    // The setup added and selected the default mint.
    mockWallet.mints = [{ mintUrl: MINT, name: 'Mint' }];
    mockWallet.selectedMint = MINT;
    act(() => useDefaultMintSetupStore.getState().markSettled());
    rerender({});
    expect(result.current.status).toBe('ready');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.mintUrl).toBe(MINT);
    expect(result.current.ctaLabel).toBeUndefined();
  });

  it('says "Add a mint" once a wallet has settled with no mints', () => {
    mockWallet.isLoading = false;
    const { result } = renderHook(() => useMintSelector({}));
    expect(result.current.status).toBe('pending');
    act(() => useDefaultMintSetupStore.getState().markSettled());
    expect(result.current.status).toBe('ready');
    expect(result.current.ctaLabel).toBe(ADD_MINT_LABEL);
  });
});
