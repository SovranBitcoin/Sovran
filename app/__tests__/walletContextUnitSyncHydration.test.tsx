/**
 * The active unit follows the preferred mint only once that mint's info has
 * loaded. On a cold boot or account switch the persisted `usd` must survive
 * the frames where the mint is listed without `mintInfo` yet; once the info
 * arrives the sync runs exactly once for that mint. The same holds for the
 * mint's keyset read: a mint can advertise a unit in `/v1/info` it holds no
 * keysets for, so the sync waits for that read to settle too.
 */
import { act, renderHook } from '@testing-library/react-native';

import { WalletProjection, useWalletContext } from '@/runtime/WalletProjection';

const MINT = 'https://mint.example';
const SECOND_MINT = 'https://second.example';
let mockMints: { mintUrl: string; mintInfo?: { name: string } }[] = [];
let mockSupported: string[] = ['sat'];
const mockSetUnit = jest.fn();
const mockSetSelectedMint = jest.fn();
let mockActiveUnit = 'usd';
let mockSelectedMint: string | undefined = MINT;
let mockHydrated = true;
const mockHydrationListeners = new Set<() => void>();
let mockBalances: { byMintAndUnit: Record<string, Record<string, { total: number }>> } = {
  byMintAndUnit: {},
};
// A key present means that mint's keyset read has settled (`undefined` when
// it failed); an absent key means the read has not finished.
let mockKeysetUnits: Record<string, string[] | undefined> = {};

jest.mock('@cashu/coco-react', () => ({
  useManager: () => ({ on: jest.fn(), off: jest.fn() }),
  useBalanceContext: () => ({ balances: mockBalances }),
  useMints: () => ({ trustedMints: mockMints }),
}));
jest.mock('wallet', () => ({
  deriveMintMethodCapabilityMapFromTrustedMints: () => ({}),
  deriveSupportedUnitsFromInfo: (info: unknown, keysetUnits?: string[]) =>
    info
      ? keysetUnits
        ? mockSupported.filter((unit) => keysetUnits.includes(unit))
        : mockSupported
      : ['sat'],
  pickHighestBalanceUnit: (units: string[]) => units[0],
  pickPreferredCandidate: jest.requireActual('../../wallet/src/mint-selection').pickPreferredCandidate,
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
    selector({ selectedMint: mockSelectedMint });
  useMintStore.getState = () => ({
    activeUnit: mockActiveUnit,
    selectedMint: mockSelectedMint,
    setSelectedMint: mockSetSelectedMint,
  });
  useMintStore.persist = {
    hasHydrated: () => mockHydrated,
    onFinishHydration: (cb: () => void) => {
      mockHydrationListeners.add(cb);
      return () => mockHydrationListeners.delete(cb);
    },
  };
  return { useMintStore };
});
jest.mock('@/features/wallet/hooks/useActiveUnit', () => ({
  useActiveUnit: () => ({ unit: 'usd', realUnit: 'usd', testnut: false, setUnit: mockSetUnit }),
}));
jest.mock('@/features/wallet/hooks/useMintKeysetUnits', () => ({
  ...jest.requireActual('@/features/wallet/hooks/useMintKeysetUnits'),
  useMintKeysetUnits: () => mockKeysetUnits,
}));
jest.mock('@/shared/lib/logger', () => ({
  walletLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
  initLog: jest.fn(),
  useInitMount: jest.fn(),
  mintUrlLogFields: () => ({}),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <WalletProjection>{children}</WalletProjection>
);

beforeEach(() => {
  mockSetUnit.mockClear();
  mockSetSelectedMint.mockClear();
  mockActiveUnit = 'usd';
  mockSelectedMint = MINT;
  mockHydrated = true;
  mockHydrationListeners.clear();
  mockBalances = { byMintAndUnit: {} };
  mockSupported = ['sat'];
  mockKeysetUnits = { [MINT]: undefined };
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

it('waits for the keyset read before syncing, then leaves a manual switch alone', () => {
  // /v1/info advertises usd and sat, but the mint holds only sat keysets.
  mockSupported = ['usd', 'sat'];
  mockKeysetUnits = {};
  mockMints = [{ mintUrl: MINT, mintInfo: { name: 'Mint' } }];
  const { rerender } = renderHook(useWalletContext, { wrapper });
  expect(mockSetUnit).not.toHaveBeenCalled();

  mockKeysetUnits = { [MINT]: ['sat'] };
  rerender({});
  expect(mockSetUnit).toHaveBeenCalledTimes(1);
  expect(mockSetUnit).toHaveBeenCalledWith('sat');

  // The person switches back by hand; a later keyset re-read does not fight it.
  mockActiveUnit = 'usd';
  mockKeysetUnits = { [MINT]: ['sat'] };
  rerender({});
  expect(mockSetUnit).toHaveBeenCalledTimes(1);
});

it('syncs on the advertised units when the keyset read fails', () => {
  mockSupported = ['sat'];
  mockKeysetUnits = {};
  mockMints = [{ mintUrl: MINT, mintInfo: { name: 'Mint' } }];
  const { rerender } = renderHook(useWalletContext, { wrapper });
  expect(mockSetUnit).not.toHaveBeenCalled();

  mockKeysetUnits = { [MINT]: undefined };
  rerender({});
  expect(mockSetUnit).toHaveBeenCalledWith('sat');
});

it('auto-selects the highest-balance trusted mint once mint-store hydrates', () => {
  mockHydrated = false;
  mockSelectedMint = undefined;
  mockMints = [{ mintUrl: MINT }, { mintUrl: SECOND_MINT }];
  mockBalances = {
    byMintAndUnit: {
      [MINT]: { usd: { total: 5 } },
      [SECOND_MINT]: { usd: { total: 42 } },
    },
  };
  renderHook(useWalletContext, { wrapper });
  expect(mockSetSelectedMint).not.toHaveBeenCalled();

  act(() => {
    mockHydrated = true;
    for (const listener of mockHydrationListeners) listener();
  });
  expect(mockSetSelectedMint).toHaveBeenCalledTimes(1);
  expect(mockSetSelectedMint).toHaveBeenCalledWith(SECOND_MINT);
});

it('replaces a removed stored selectedMint with an active trusted mint', () => {
  mockSelectedMint = 'https://removed.example';
  mockMints = [{ mintUrl: MINT }];
  renderHook(useWalletContext, { wrapper });
  expect(mockSetSelectedMint).toHaveBeenCalledTimes(1);
  expect(mockSetSelectedMint).toHaveBeenCalledWith(MINT);
});

it('auto-selects the first trusted mint when balances tie', () => {
  mockSelectedMint = undefined;
  mockMints = [{ mintUrl: MINT }, { mintUrl: SECOND_MINT }];
  mockBalances = {
    byMintAndUnit: {
      [MINT]: { usd: { total: 9 } },
      [SECOND_MINT]: { usd: { total: 9 } },
    },
  };
  renderHook(useWalletContext, { wrapper });
  expect(mockSetSelectedMint).toHaveBeenCalledWith(MINT);
});
