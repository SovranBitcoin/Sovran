/**
 * When the stored selection is missing or no longer trusted, the mint pill
 * shows the trusted mint with the highest balance in its unit, the first one
 * on a tie, and never a mint the caller did not ask for when it pinned one.
 */
import { renderHook } from '@testing-library/react-native';

import { useMintSelector } from '@/features/wallet/components/MintSelector/useMintSelector';

const A = 'https://a.example';
const B = 'https://b.example';
const C = 'https://c.example';
let mockBalances: { byMintAndUnit: Record<string, Record<string, { total: number }>> } = {
  byMintAndUnit: {},
};
let mockSelected: string | undefined;

jest.mock('@cashu/coco-react', () => ({
  useBalanceContext: () => ({ balances: mockBalances }),
}));
jest.mock('@/features/mint', () => ({
  useMintManagement: () => ({
    mints: [{ mintUrl: A }, { mintUrl: B }, { mintUrl: C }],
    isLoading: false,
  }),
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: (selector: (state: { selectedMint?: string }) => unknown) =>
    selector({ selectedMint: mockSelected }),
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

beforeEach(() => {
  mockSelected = undefined;
  mockBalances = {
    byMintAndUnit: {
      [A]: { sat: { total: 5 }, usd: { total: 50 } },
      [B]: { sat: { total: 40 } },
      [C]: { sat: { total: 40 } },
    },
  };
});

it('shows the highest sat balance, the first of a tie', () => {
  const { result } = renderHook(() => useMintSelector({ unit: 'sat' }));
  expect(result.current.mintUrl).toBe(B);
  expect(result.current.balance).toBe(40);
});

it('ranks by the given unit', () => {
  const { result } = renderHook(() => useMintSelector({ unit: 'usd' }));
  expect(result.current.mintUrl).toBe(A);
});

it('replaces a stored selection that is no longer trusted', () => {
  mockSelected = 'https://removed.example';
  const { result } = renderHook(() => useMintSelector({ unit: 'sat' }));
  expect(result.current.mintUrl).toBe(B);
});

it('keeps a stored trusted selection and a pinned mint', () => {
  mockSelected = A;
  expect(renderHook(() => useMintSelector({ unit: 'sat' })).result.current.mintUrl).toBe(A);
  expect(
    renderHook(() => useMintSelector({ unit: 'sat', selectedMintUrl: C })).result.current.mintUrl
  ).toBe(C);
});
