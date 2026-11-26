/**
 * @jest-environment node
 *
 * Characterization of `createRebalanceWalletPort`: delegates single-hop swaps
 * directly to Coco's `manager.ops.mintSwap`, alongside balance reads, worst-case
 * input fee pricing, and temporary intermediary trust management.
 */

import { createRebalanceWalletPort } from '@/features/mint/lib/rebalanceWalletPort';

jest.mock('@/features/mint/components/rebalance', () => ({
  releaseTrustWindow: jest.requireActual('@/features/mint/components/rebalance/releaseTrustWindow')
    .releaseTrustWindow,
}));

const A = 'https://a.example';
const B = 'https://b.example';

function createFakeManager() {
  const wallet = {
    getFeesForProofs: jest.fn(() => 3),
  };
  const mintSwap = {
    prepare: jest.fn(),
    execute: jest.fn(),
    get: jest.fn(),
    listActive: jest.fn(() => Promise.resolve([])),
    refresh: jest.fn(),
    cancel: jest.fn(),
    waitForOutcome: jest.fn(),
  };
  const manager = {
    wallet: {
      balances: {
        byMint: jest.fn(() =>
          Promise.resolve({
            [A]: { total: 1200, spendable: 1000 },
            [B]: { total: 0, spendable: 0 },
          })
        ),
      },
    },
    proofService: { getReadyProofs: jest.fn(() => Promise.resolve([{ amount: 8 }])) },
    walletService: { getWallet: jest.fn(() => Promise.resolve(wallet)) },
    ops: { mintSwap },
    mint: {
      addMint: jest.fn(() => Promise.resolve()),
      untrustMint: jest.fn(() => Promise.resolve()),
    },
  };
  return { manager, wallet, mintSwap };
}

function port(fake: ReturnType<typeof createFakeManager>, unit: string) {
  return createRebalanceWalletPort(
    fake.manager as unknown as Parameters<typeof createRebalanceWalletPort>[0],
    unit
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('createRebalanceWalletPort', () => {
  it('reports each mint balance as its total', async () => {
    const fake = createFakeManager();

    await expect(port(fake, 'sat').balancesByMint()).resolves.toEqual({ [A]: 1200, [B]: 0 });
    expect(fake.manager.wallet.balances.byMint).toHaveBeenCalledWith();
  });

  it('prices the input fee from the ready proofs of the sat wallet', async () => {
    const fake = createFakeManager();

    await expect(port(fake, 'sat').worstCaseInputFee(A)).resolves.toBe(3);

    expect(fake.manager.proofService.getReadyProofs).toHaveBeenCalledWith(A);
    expect(fake.manager.walletService.getWallet).toHaveBeenCalledWith(A, 'sat');
    expect(fake.wallet.getFeesForProofs).toHaveBeenCalledWith([{ amount: 8 }]);
  });

  it('exposes Coco manager.ops.mintSwap directly', () => {
    const fake = createFakeManager();

    expect(port(fake, 'sat').mintSwap).toBe(fake.mintSwap);
  });

  it('trusts a mint by adding it as trusted', async () => {
    const fake = createFakeManager();

    await port(fake, 'sat').trustMint(B);

    expect(fake.manager.mint.addMint).toHaveBeenCalledWith(B, { trusted: true });
  });

  it('untrusts every temporarily trusted mint and reports the ones still holding funds', async () => {
    const fake = createFakeManager();
    await expect(port(fake, 'sat').releaseTrust([A, B])).resolves.toEqual({
      stranded: [{ url: A, balance: 1200 }],
      untrustErrors: [],
    });
    expect(fake.manager.mint.untrustMint).toHaveBeenCalledWith(A);
    expect(fake.manager.mint.untrustMint).toHaveBeenCalledWith(B);
  });
});
