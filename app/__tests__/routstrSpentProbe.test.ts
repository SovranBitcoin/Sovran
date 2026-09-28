/**
 * @jest-environment node
 *
 * A token the mint has already spent is never handed to the wallet.
 *
 * Coco records every receive it is asked to make, so a recovery that asked it
 * to redeem a spent token left a rolled-back receive in the history reading
 * "Token already spent" — one per attempt, and recovery retries. The refusal
 * was always the mint's to give; asking it first costs the history nothing.
 */

import { createCocoWalletAdapter } from '@/shared/lib/routstr/sdk/walletAdapter';
import { isTokenSpent } from '@/shared/lib/routstr/spentProbe';

const MINT = 'https://mint.example';
const TOKEN = 'cashuB-fixture';
const PROOFS = [
  { id: '00ad268c4d1f5826', amount: 2, secret: 'one', C: '02aa' },
  { id: '00ad268c4d1f5826', amount: 1, secret: 'two', C: '02bb' },
];

const mockCheckStates = jest.fn();
const mockPrepare = jest.fn();
const mockExecute = jest.fn();
const mockDecode = jest.fn();
const mockManager = {
  wallet: { decodeToken: mockDecode },
  ops: { receive: { prepare: mockPrepare, execute: mockExecute } },
};

jest.mock('@cashu/cashu-ts', () => ({
  CheckStateEnum: { UNSPENT: 'UNSPENT', PENDING: 'PENDING', SPENT: 'SPENT' },
  getTokenMetadata: () => ({
    mint: 'https://mint.example',
    unit: 'sat',
    amount: { toNumber: () => 3 },
  }),
  Wallet: jest.fn().mockImplementation(() => ({ checkProofsStates: mockCheckStates })),
}));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { peekInstance: () => mockManager },
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: { getState: () => ({ selectedMint: 'https://mint.example' }) },
}));
jest.mock('@/shared/stores/global/mintTestnutStore', () => ({ isTestnutMint: () => false }));
jest.mock('@/shared/lib/routstr/sdk/paymentScope', () => ({ annotatePaymentLeg: jest.fn() }));
jest.mock('@/shared/lib/routstr/tokenWire', () => ({
  toWalletToken: (token: string) => token,
  encodeTokenForNode: jest.fn(),
  keysetIdsOf: jest.fn(),
  wireTokenAmount: jest.fn(),
}));
jest.mock('@/shared/lib/logger', () => ({
  apiLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const states = (...each: string[]) => each.map((state) => ({ state }));
const manager = mockManager as unknown as Parameters<typeof isTokenSpent>[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockDecode.mockResolvedValue({ mint: MINT, unit: 'sat', proofs: PROOFS });
  mockPrepare.mockResolvedValue({ id: 'receive-1' });
  mockExecute.mockResolvedValue({ id: 'receive-1' });
});

describe('isTokenSpent', () => {
  it('is true when the mint has spent every proof', async () => {
    mockCheckStates.mockResolvedValue(states('SPENT', 'SPENT'));
    expect(await isTokenSpent(manager, TOKEN)).toBe(true);
    expect(mockCheckStates).toHaveBeenCalledWith(PROOFS);
  });

  it.each([
    ['one proof is unspent', states('SPENT', 'UNSPENT')],
    ['one proof is pending', states('SPENT', 'PENDING')],
    ['the mint answered for fewer proofs than were asked', states('SPENT')],
  ])('is false when %s', async (_case, answer) => {
    mockCheckStates.mockResolvedValue(answer);
    expect(await isTokenSpent(manager, TOKEN)).toBe(false);
  });

  it('is false when the mint cannot be asked', async () => {
    mockCheckStates.mockRejectedValue(new Error('network'));
    expect(await isTokenSpent(manager, TOKEN)).toBe(false);
  });

  it('is false when the token will not decode', async () => {
    mockDecode.mockRejectedValue(new Error('unknown keyset'));
    expect(await isTokenSpent(manager, TOKEN)).toBe(false);
    expect(mockCheckStates).not.toHaveBeenCalled();
  });
});

describe('the wallet adapter receiving a recovery token', () => {
  it('shares a receive between active change collection and a concurrent recovery adapter', async () => {
    mockCheckStates.mockResolvedValue(states('UNSPENT', 'UNSPENT'));

    const receipts = await Promise.all([
      createCocoWalletAdapter().receiveToken(TOKEN),
      createCocoWalletAdapter().receiveToken(TOKEN, { probeSpent: true }),
    ]);

    expect(receipts).toEqual([
      { success: true, amount: 3, unit: 'sat' },
      { success: true, amount: 3, unit: 'sat' },
    ]);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('allows a later retry after a shared receive fails', async () => {
    mockPrepare.mockRejectedValueOnce(new Error('offline'));
    const receipts = await Promise.all([
      createCocoWalletAdapter().receiveToken(TOKEN),
      createCocoWalletAdapter().receiveToken(TOKEN),
    ]);
    expect(receipts).toEqual([
      { success: false, amount: 0, unit: 'sat', message: 'offline' },
      { success: false, amount: 0, unit: 'sat', message: 'offline' },
    ]);
    expect(mockPrepare).toHaveBeenCalledTimes(1);

    expect(await createCocoWalletAdapter().receiveToken(TOKEN)).toEqual({
      success: true,
      amount: 3,
      unit: 'sat',
    });
    expect(mockPrepare).toHaveBeenCalledTimes(2);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('does not ask the wallet to receive a spent token', async () => {
    mockCheckStates.mockResolvedValue(states('SPENT', 'SPENT'));

    const result = await createCocoWalletAdapter().receiveToken(TOKEN, { probeSpent: true });

    expect(result).toEqual({
      success: false,
      amount: 0,
      unit: 'sat',
      message: 'Token already spent',
    });
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('receives a token the mint still holds', async () => {
    mockCheckStates.mockResolvedValue(states('UNSPENT', 'UNSPENT'));

    const result = await createCocoWalletAdapter().receiveToken(TOKEN, { probeSpent: true });

    expect(result).toMatchObject({ success: true, amount: 3 });
    expect(mockPrepare).toHaveBeenCalledWith({ token: TOKEN });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('lets the wallet decide when the mint cannot be asked', async () => {
    mockCheckStates.mockRejectedValue(new Error('network'));

    const result = await createCocoWalletAdapter().receiveToken(TOKEN, { probeSpent: true });

    expect(result).toMatchObject({ success: true });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('does not make change from a node wait on the mint', async () => {
    const result = await createCocoWalletAdapter().receiveToken(TOKEN);

    expect(result).toMatchObject({ success: true });
    expect(mockCheckStates).not.toHaveBeenCalled();
    expect(mockDecode).not.toHaveBeenCalled();
  });
});
