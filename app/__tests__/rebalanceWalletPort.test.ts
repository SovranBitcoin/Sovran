/**
 * @jest-environment node
 *
 * Characterization of `createRebalanceWalletPort`: what each port function asks
 * the Coco manager for, and in which unit. A fake manager records every call;
 * the port's own helpers (cocoOperations, managerInternals, releaseTrustWindow)
 * run for real.
 */

import { createRebalanceWalletPort } from '@/features/mint/lib/rebalanceWalletPort';
import { CocoManager } from '@/shared/lib/cashu/manager';

jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { restoreInflightProofsForMint: jest.fn(() => Promise.resolve()) },
}));

// The rebalance barrel also re-exports rendering components; keep only the
// trust-window helper the port uses, unchanged.
jest.mock('@/features/mint/components/rebalance', () => ({
  releaseTrustWindow: jest.requireActual('@/features/mint/components/rebalance/releaseTrustWindow')
    .releaseTrustWindow,
}));

const A = 'https://a.example';
const B = 'https://b.example';
const INVOICE = 'lnbc10n1example';

function createFakeManager() {
  const wallet = {
    getFeesForProofs: jest.fn(() => 3),
    createMeltQuoteBolt11: jest.fn(() => Promise.resolve({ fee_reserve: 4 })),
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
    quotes: {
      mint: { create: jest.fn(() => Promise.resolve({ quoteId: 'mint-q' })) },
      melt: { create: jest.fn(() => Promise.resolve({ quoteId: 'melt-q' })) },
    },
    ops: {
      mint: {
        prepare: jest.fn(() => Promise.resolve({ id: 'mint-op' })),
        get: jest.fn(() => Promise.resolve({ id: 'mint-op', state: 'pending' })),
      },
      melt: {
        prepare: jest.fn(() => Promise.resolve({ id: 'melt-op' })),
        execute: jest.fn(() => Promise.resolve({ id: 'melt-op', state: 'finalized' })),
        refresh: jest.fn(() => Promise.resolve({ id: 'melt-op', state: 'pending' })),
        get: jest.fn(() => Promise.resolve({ id: 'melt-op', state: 'prepared' })),
      },
    },
    mint: {
      addMint: jest.fn(() => Promise.resolve()),
      untrustMint: jest.fn(() => Promise.resolve()),
    },
  };
  return { manager, wallet };
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

  it('reads balances with no unit scope even when the port is for usd', async () => {
    const fake = createFakeManager();

    await port(fake, 'usd').balancesByMint();

    // QUIRK: byMint() is called with no unit, so Coco answers in sat for a usd split
    // (transactions-wallet-mint D1). A fix that scopes to { units: [unit] } should change
    // this assertion on purpose.
    expect(fake.manager.wallet.balances.byMint).toHaveBeenCalledWith();
  });

  it('prices the input fee from the ready proofs of the sat wallet whatever the unit', async () => {
    const fake = createFakeManager();

    await expect(port(fake, 'usd').worstCaseInputFee(A)).resolves.toBe(3);

    expect(fake.manager.proofService.getReadyProofs).toHaveBeenCalledWith(A);
    // QUIRK: the fee is computed on the sat wallet, not the port's usd unit (D1). A fix
    // should change this assertion on purpose.
    expect(fake.manager.walletService.getWallet).toHaveBeenCalledWith(A, 'sat');
    expect(fake.wallet.getFeesForProofs).toHaveBeenCalledWith([{ amount: 8 }]);
  });

  it('probes the melt fee reserve with a sat wallet quote whatever the unit', async () => {
    const fake = createFakeManager();

    await expect(port(fake, 'usd').probeMeltFeeReserve(A, INVOICE)).resolves.toBe(4);

    // QUIRK: the probe quotes against the sat wallet for a usd split (D1). A fix should
    // change this assertion on purpose.
    expect(fake.manager.walletService.getWallet).toHaveBeenCalledWith(A, 'sat');
    expect(fake.wallet.createMeltQuoteBolt11).toHaveBeenCalledWith(INVOICE);
    expect(fake.manager.quotes.melt.create).not.toHaveBeenCalled();
  });

  it('refuses a fee the wallet reports as a fraction', async () => {
    const fake = createFakeManager();
    fake.wallet.createMeltQuoteBolt11.mockResolvedValueOnce({ fee_reserve: 1.5 });

    await expect(port(fake, 'sat').probeMeltFeeReserve(A, INVOICE)).rejects.toThrow(TypeError);
  });

  it('creates the mint receipt quote in the port unit', async () => {
    const fake = createFakeManager();

    await expect(port(fake, 'usd').createMintReceipt(B, 500)).resolves.toEqual({ id: 'mint-op' });

    expect(fake.manager.quotes.mint.create).toHaveBeenCalledWith({
      mintUrl: B,
      method: 'bolt11',
      amount: { amount: 500, unit: 'usd' },
    });
    expect(fake.manager.ops.mint.prepare).toHaveBeenCalledWith({
      quote: { quoteId: 'mint-q' },
      amount: 500,
    });
  });

  it('prepares the melt with a sat quote whatever the unit', async () => {
    const fake = createFakeManager();

    await expect(port(fake, 'usd').prepareMelt(A, INVOICE)).resolves.toEqual({ id: 'melt-op' });

    // QUIRK: the melt quote is always in sat, so a usd split pays with sat proofs (D1). A fix
    // that passes the port unit should change this assertion on purpose.
    expect(fake.manager.quotes.melt.create).toHaveBeenCalledWith({
      mintUrl: A,
      method: 'bolt11',
      methodData: { invoice: INVOICE },
      unit: 'sat',
    });
    expect(fake.manager.ops.melt.prepare).toHaveBeenCalledWith({ quote: { quoteId: 'melt-q' } });
  });

  it('hands operation reads, melt execution and refresh straight to Coco', async () => {
    const fake = createFakeManager();
    const p = port(fake, 'sat');

    await expect(p.getMintOperation('mint-op')).resolves.toMatchObject({ state: 'pending' });
    await expect(p.executeMelt('melt-op')).resolves.toMatchObject({ state: 'finalized' });
    await expect(p.refreshMelt('melt-op')).resolves.toMatchObject({ state: 'pending' });
    await expect(p.getMeltOperation('melt-op')).resolves.toMatchObject({ state: 'prepared' });

    expect(fake.manager.ops.mint.get).toHaveBeenCalledWith('mint-op');
    expect(fake.manager.ops.melt.execute).toHaveBeenCalledWith('melt-op');
    expect(fake.manager.ops.melt.refresh).toHaveBeenCalledWith('melt-op');
    expect(fake.manager.ops.melt.get).toHaveBeenCalledWith('melt-op');
  });

  it('restores in-flight proofs through the app Coco manager for that mint', async () => {
    const fake = createFakeManager();

    await port(fake, 'sat').restoreInflightProofs(A);

    expect(CocoManager.restoreInflightProofsForMint).toHaveBeenCalledWith(A);
  });

  it('trusts a mint by adding it as trusted', async () => {
    const fake = createFakeManager();

    await port(fake, 'sat').trustMint(B);

    expect(fake.manager.mint.addMint).toHaveBeenCalledWith(B, { trusted: true });
  });

  it('untrusts every temporarily trusted mint and reports the ones still holding funds', async () => {
    const fake = createFakeManager();

    const result = await port(fake, 'sat').releaseTrust([A, B]);

    expect(fake.manager.mint.untrustMint).toHaveBeenCalledWith(A);
    expect(fake.manager.mint.untrustMint).toHaveBeenCalledWith(B);
    expect(result).toEqual({ stranded: [{ url: A, balance: 1200 }], untrustErrors: [] });
  });
});
