import { useLayoutEffect, type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { WalletContextProvider, useWalletContext } from '@/shared/providers/WalletContextProvider';

let mockUnit = 'sat';
let mockTestnutAccount = false;
function createManager() {
  const listeners = new Map<string, Set<(event: { mintUrl: string }) => void>>();
  return {
    on: (name: string, callback: (event: { mintUrl: string }) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(callback);
    },
    off: (name: string, callback: (event: { mintUrl: string }) => void) => {
      listeners.get(name)?.delete(callback);
    },
    emit: (name: string, mintUrl = 'mint') => {
      for (const callback of listeners.get(name) ?? []) callback({ mintUrl });
    },
    listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
}
let mockManager = createManager();
let mockBalances: { byMintAndUnit: Record<string, Record<string, { total: number }>> } = {
  byMintAndUnit: { mint: { sat: { total: 16 }, usd: { total: 3 } } },
};
let mockMints = [{ mintUrl: 'mint' }];
const mockGetReadyProofs = jest.fn();
jest.mock('@cashu/coco-react', () => ({
  useManager: () => mockManager,
  useBalanceContext: () => ({ balances: mockBalances }),
  useMints: () => ({ trustedMints: mockMints }),
}));
jest.mock('wallet', () => ({
  deriveMintMethodCapabilityMapFromTrustedMints: () => ({}),
  deriveSupportedUnitsFromInfo: () => ['sat', 'usd'],
  pickHighestBalanceUnit: () => 'sat',
  toAccountUnit: (unit: string, testnut: boolean) => (testnut ? `t${unit}` : unit),
}));
jest.mock('@/shared/stores/global/mintTestnutStore', () => ({
  useIsTestnutMint: () => (mintUrl: string) => mintUrl.includes('testnut'),
}));
jest.mock('@/shared/lib/cashu/managerInternals', () => ({
  getReadyProofs: (...args: unknown[]) => mockGetReadyProofs(...args),
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: (selector: (state: { selectedMint?: string }) => unknown) => selector({}),
}));
jest.mock('@/features/wallet/hooks/useActiveUnit', () => ({
  useActiveUnit: () => ({
    unit: mockUnit,
    realUnit: mockUnit,
    testnut: mockTestnutAccount,
    setUnit: jest.fn(),
  }),
}));
jest.mock('@/features/wallet/hooks/useMintKeysetUnits', () => ({ useMintKeysetUnits: () => ({}) }));
jest.mock('@/shared/lib/logger', () => ({
  walletLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
  initLog: jest.fn(),
  useInitMount: jest.fn(),
  mintUrlLogFields: () => ({}),
}));

const wrapper = ({ children }: PropsWithChildren) => (
  <WalletContextProvider>{children}</WalletContextProvider>
);
type ProofAmount = { amount: number; unit?: string; usedByOperationId?: string };

beforeEach(() => {
  mockUnit = 'sat';
  mockTestnutAccount = false;
  mockManager = createManager();
  mockMints = [{ mintUrl: 'mint' }];
  mockBalances = { byMintAndUnit: { mint: { sat: { total: 16 }, usd: { total: 3 } } } };
  mockGetReadyProofs.mockReset();
});

it.each(['unit', 'manager', 'balance'])(
  'ignores an older proof read after the %s changes',
  async (scope) => {
    const finish: ((proofs: ProofAmount[]) => void)[] = [];
    mockGetReadyProofs.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish.push(resolve);
        })
    );
    const { result, rerender } = renderHook(useWalletContext, { wrapper });
    if (scope === 'unit') mockUnit = 'usd';
    if (scope === 'manager') mockManager = createManager();
    if (scope === 'balance')
      mockBalances = { byMintAndUnit: { mint: { sat: { total: 3 }, usd: { total: 3 } } } };
    rerender(undefined);
    await act(async () => finish[1]([{ amount: 3, unit: mockUnit }]));
    expect(result.current.proofAmounts).toEqual({ mint: [3] });
    await act(async () => finish[0]([{ amount: 16, unit: 'sat' }]));
    expect(result.current.proofAmounts).toEqual({ mint: [3] });
  }
);

it.each(['unit', 'manager', 'balance', 'mints'])(
  'hides old proof suggestions on the first commit after %s changes',
  async (scope) => {
    mockGetReadyProofs
      .mockResolvedValueOnce([{ amount: 16, unit: 'sat' }])
      .mockImplementation(() => new Promise(() => {}));
    const commits: Record<string, number[]>[] = [];
    const { rerender } = renderHook(
      () => {
        const context = useWalletContext();
        useLayoutEffect(() => {
          commits.push(context.proofAmounts ?? {});
        });
        return context;
      },
      { wrapper }
    );
    await act(async () => {});
    expect(commits.at(-1)).toEqual({ mint: [16] });
    const before = commits.length;
    if (scope === 'unit') mockUnit = 'usd';
    if (scope === 'manager') mockManager = createManager();
    if (scope === 'balance')
      mockBalances = { byMintAndUnit: { mint: { sat: { total: 3 }, usd: { total: 3 } } } };
    if (scope === 'mints') mockMints = [{ mintUrl: 'another-mint' }];
    rerender(undefined);
    expect(commits[before]).toEqual({});
  }
);

it('does not reread proofs for equivalent balance objects or unrelated rerenders', async () => {
  mockGetReadyProofs.mockResolvedValue([{ amount: 16, unit: 'sat' }]);
  const { rerender } = renderHook(useWalletContext, { wrapper });
  await act(async () => {});
  for (let index = 0; index < 5; index += 1) {
    mockBalances = { byMintAndUnit: { mint: { sat: { total: 16 }, usd: { total: 3 } } } };
    rerender(undefined);
  }
  expect(mockGetReadyProofs).toHaveBeenCalledTimes(1);
});

it('keeps only ready amounts for the active unit, defaults legacy proofs to sat, and sorts ascending', async () => {
  mockGetReadyProofs.mockResolvedValue([
    { amount: 8 },
    { amount: 2, unit: 'usd' },
    { amount: 4, unit: 'sat' },
  ]);
  const { result } = renderHook(useWalletContext, { wrapper });
  await act(async () => {});
  expect(result.current.proofAmounts).toEqual({ mint: [4, 8] });
});

it.each(['proofs:saved', 'proofs:state-changed', 'proofs:deleted', 'proofs:wiped'])(
  'refreshes equal-total denominations on %s and immediately hides the prior snapshot',
  async (event) => {
    let finish!: (proofs: ProofAmount[]) => void;
    mockGetReadyProofs.mockResolvedValueOnce([{ amount: 16 }]).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { result } = renderHook(useWalletContext, { wrapper });
    await act(async () => {});
    expect(result.current.proofAmounts).toEqual({ mint: [16] });
    act(() => mockManager.emit(event));
    expect(result.current.proofAmounts).toEqual({});
    await act(async () => finish([{ amount: 8 }, { amount: 8 }]));
    expect(result.current.proofAmounts).toEqual({ mint: [8, 8] });
  }
);

it('excludes reserved ready proofs and restores them after release with an unchanged total', async () => {
  mockGetReadyProofs.mockResolvedValue([
    { amount: 8 },
    { amount: 8, usedByOperationId: 'reserved' },
  ]);
  const { result } = renderHook(useWalletContext, { wrapper });
  await act(async () => {});
  expect(result.current.proofAmounts).toEqual({ mint: [8] });
  mockGetReadyProofs.mockResolvedValue([{ amount: 8 }, { amount: 8 }]);
  await act(async () => mockManager.emit('proofs:released'));
  expect(result.current.proofAmounts).toEqual({ mint: [8, 8] });
  mockGetReadyProofs.mockResolvedValue([
    { amount: 8, usedByOperationId: 'another-reservation' },
    { amount: 8 },
  ]);
  await act(async () => mockManager.emit('proofs:reserved'));
  expect(result.current.proofAmounts).toEqual({ mint: [8] });
});

it('coalesces a proof-event burst and never publishes the invalidated read', async () => {
  const finish: ((proofs: ProofAmount[]) => void)[] = [];
  mockGetReadyProofs.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish.push(resolve);
      })
  );
  const { result } = renderHook(useWalletContext, { wrapper });
  act(() => {
    for (let index = 0; index < 20; index++) mockManager.emit('proofs:reserved');
  });
  expect(mockGetReadyProofs).toHaveBeenCalledTimes(1);
  await act(async () => finish[0]([{ amount: 16 }]));
  expect(mockGetReadyProofs).toHaveBeenCalledTimes(2);
  expect(result.current.proofAmounts).toEqual({});
  await act(async () => finish[1]([{ amount: 8 }]));
  expect(result.current.proofAmounts).toEqual({ mint: [8] });
});

it('ignores other mints and detaches old manager subscriptions on replacement and unmount', async () => {
  mockGetReadyProofs.mockResolvedValue([{ amount: 16 }]);
  const { rerender, unmount } = renderHook(useWalletContext, { wrapper });
  await act(async () => {});
  const previous = mockManager;
  act(() => previous.emit('proofs:saved', 'untrusted'));
  expect(mockGetReadyProofs).toHaveBeenCalledTimes(1);
  mockManager = createManager();
  rerender(undefined);
  await act(async () => {});
  expect(previous.listenerCount()).toBe(0);
  expect(mockManager.listenerCount()).toBe(6);
  act(() => previous.emit('proofs:saved'));
  expect(mockGetReadyProofs).toHaveBeenCalledTimes(2);
  unmount();
  expect(mockManager.listenerCount()).toBe(0);
});

it('exposes all unit balances independently of the active-unit view', async () => {
  mockGetReadyProofs.mockResolvedValue([]);
  const { result, rerender } = renderHook(useWalletContext, { wrapper });
  await act(async () => {});
  expect(result.current.unitBalances).toEqual({ sat: { mint: 16 }, usd: { mint: 3 } });
  expect(result.current.mintBalances).toEqual({ mint: 16 });
  mockUnit = 'usd';
  rerender(undefined);
  await act(async () => {});
  expect(result.current.unitBalances).toEqual({ sat: { mint: 16 }, usd: { mint: 3 } });
  expect(result.current.mintBalances).toEqual({ mint: 3 });
});

// The testnut split: same unit, but a testnut mint's funds are another account.
it.each([
  [false, { mint: 16, 'https://testnut.example': 0 }, { sat: { mint: 16 }, usd: { mint: 3 } }],
  [true, { mint: 0, 'https://testnut.example': 900 }, { sat: { 'https://testnut.example': 900 } }],
])(
  'exposes only the active account side of the split (testnut account: %s)',
  async (testnutAccount, mintBalances, unitBalances) => {
    mockTestnutAccount = testnutAccount;
    mockMints = [{ mintUrl: 'mint' }, { mintUrl: 'https://testnut.example' }];
    mockBalances = {
      byMintAndUnit: {
        mint: { sat: { total: 16 }, usd: { total: 3 } },
        'https://testnut.example': { sat: { total: 900 } },
      },
    };
    mockGetReadyProofs.mockResolvedValue([]);
    const { result } = renderHook(useWalletContext, { wrapper });
    await act(async () => {});
    expect(result.current.mintBalances).toEqual(mintBalances);
    expect(result.current.unitBalances).toEqual(unitBalances);
  }
);
