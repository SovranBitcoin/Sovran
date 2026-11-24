/**
 * The active unit follows the preferred mint only once that mint's info has
 * loaded. On a cold boot or account switch the persisted `usd` must survive
 * the frames where the mint is listed without `mintInfo` yet; once the info
 * arrives the sync runs exactly once for that mint.
 */
import { renderHook } from '@testing-library/react-native';

import { WalletContextProvider, useWalletContext } from '@/shared/providers/WalletContextProvider';

const MINT = 'https://mint.example';
let mockMints: { mintUrl: string; mintInfo?: { name: string } }[] = [];
let mockSupported: string[] = ['sat'];
const mockSetUnit = jest.fn();
let mockActiveUnit = 'usd';

jest.mock('@cashu/coco-react', () => ({
  useManager: () => ({ on: jest.fn(), off: jest.fn() }),
  useBalanceContext: () => ({ balances: { byMintAndUnit: {} } }),
  useMints: () => ({ trustedMints: mockMints }),
}));
jest.mock('wallet', () => ({
  deriveMintMethodCapabilityMapFromTrustedMints: () => ({}),
  deriveSupportedUnitsFromInfo: (info: unknown) => (info ? mockSupported : ['sat']),
  pickHighestBalanceUnit: (units: string[]) => units[0],
  toAccountUnit: (unit: string) => unit,
}));
jest.mock('@/shared/stores/global/mintTestnutStore', () => ({
  useIsTestnutMint: () => () => false,
}));
jest.mock('@/shared/lib/cashu/managerInternals', () => ({
  getReadyProofs: () => Promise.resolve([]),
}));
jest.mock('@/shared/stores/profile/mintStore', () => {
  const useMintStore = (selector: (state: { selectedMint?: string }) => unknown) =>
    selector({ selectedMint: MINT });
  useMintStore.getState = () => ({ activeUnit: mockActiveUnit });
  return { useMintStore };
});
jest.mock('@/features/wallet/hooks/useActiveUnit', () => ({
  useActiveUnit: () => ({ unit: 'usd', realUnit: 'usd', testnut: false, setUnit: mockSetUnit }),
}));
jest.mock('@/features/wallet/hooks/useMintKeysetUnits', () => ({ useMintKeysetUnits: () => ({}) }));
jest.mock('@/shared/lib/logger', () => ({
  walletLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
  initLog: jest.fn(),
  useInitMount: jest.fn(),
  mintUrlLogFields: () => ({}),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <WalletContextProvider>{children}</WalletContextProvider>
);

beforeEach(() => {
  mockSetUnit.mockClear();
  mockActiveUnit = 'usd';
  mockSupported = ['sat'];
});

it('keeps a persisted usd unit while the preferred mint has no info yet', () => {
  mockMints = [{ mintUrl: MINT }];
  mockSupported = ['sat', 'usd'];
  const { rerender } = renderHook(useWalletContext, { wrapper });
  expect(mockSetUnit).not.toHaveBeenCalled();

  // Info lands and the mint does support usd: still nothing to change.
  mockMints = [{ mintUrl: MINT, mintInfo: { name: 'Mint' } }];
  rerender({});
  expect(mockSetUnit).not.toHaveBeenCalled();
});

it('syncs once the info has loaded, when the mint cannot serve the unit', () => {
  mockMints = [];
  const { rerender } = renderHook(useWalletContext, { wrapper });
  mockMints = [{ mintUrl: MINT }];
  rerender({});
  expect(mockSetUnit).not.toHaveBeenCalled();

  mockMints = [{ mintUrl: MINT, mintInfo: { name: 'Mint' } }];
  rerender({});
  expect(mockSetUnit).toHaveBeenCalledTimes(1);
  expect(mockSetUnit).toHaveBeenCalledWith('sat');

  mockMints = [{ mintUrl: MINT, mintInfo: { name: 'Mint again' } }];
  rerender({});
  expect(mockSetUnit).toHaveBeenCalledTimes(1);
});
