/**
 * The mint pill shows the balance of the unit it is given, never the mint's
 * unscoped total: a mint holding 500 sats and 3 usd cents must show 3 on a usd
 * account, not the sats (or a sum) for one frame or for good.
 */
import { renderHook } from '@testing-library/react-native';

import { useMintSelector } from '@/features/wallet/components/MintSelector/useMintSelector';

const MINT = 'https://mint.example';
const mockBalances = {
  byMint: { [MINT]: { total: 503 } },
  byMintAndUnit: { [MINT]: { sat: { total: 500 }, usd: { total: 3 } } },
};

jest.mock('@cashu/coco-react', () => ({
  useBalanceContext: () => ({ balances: mockBalances }),
}));
jest.mock('@/features/mint', () => ({
  useMintManagement: () => ({ mints: [{ mintUrl: MINT, name: 'Mint' }], isLoading: false }),
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: (selector: (state: { selectedMint?: string }) => unknown) =>
    selector({ selectedMint: MINT }),
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (state: { mockMode: boolean }) => unknown) =>
    selector({ mockMode: false }),
}));
jest.mock('@/shared/stores/runtime/mockDataStore', () => ({ getMockMintBalance: () => 0 }));
jest.mock('@/shared/lib/logger', () => ({
  walletLog: { debug: jest.fn() },
  cashuLog: { debug: jest.fn() },
  mintUrlLogFields: () => ({}),
}));

it.each([
  ['sat', 500],
  ['usd', 3],
  ['tusd', 3],
  ['eur', 0],
])('reads the %s slice of the selected mint', (unit, expected) => {
  const { result } = renderHook(() => useMintSelector({ unit }));
  expect(result.current.balance).toBe(expected);
});

it('defaults to sats when no unit is given', () => {
  const { result } = renderHook(() => useMintSelector({}));
  expect(result.current.balance).toBe(500);
});
