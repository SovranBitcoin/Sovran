/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * default-operations.test.ts — executePaymentRequest Nostr transport
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests that the built-in executePaymentRequest operation correctly
 * dispatches Nostr DMs when the payment request uses Nostr transport.
 * This was a regression: the Nostr callback was replaced with a no-op
 * during refactoring, causing tokens to never be delivered.
 */

import { describe, it, expect, vi } from 'vitest';
import { Amount } from '@cashu/cashu-ts';
import type { Manager } from '@cashu/coco-core';
import { createDefaultOperations } from '../../src/operations/defaultOperations';

import { defaultDetectors } from '../../src/detectors';

const MINT1 = 'https://mint1.example.com';

interface MockManagerOverrides {
  history?: Record<string, unknown>;
  wallet?: Record<string, unknown>;
  ops?: {
    send?: Record<string, unknown>;
    mint?: Record<string, unknown>;
  } & Record<string, unknown>;
  paymentRequests?: Record<string, unknown>;
  send?: Record<string, unknown>;
  quotes?: {
    mint?: Record<string, unknown>;
  } & Record<string, unknown>;
}

function createMockManager(overrides: MockManagerOverrides = {}) {
  const mockToken = { proofs: [{ id: 'proof-1', amount: 100, C: 'abc', secret: 'def' }] };

  return {
    history: {
      getPaginatedHistory: vi.fn().mockResolvedValue([
        {
          id: 'op-1',
          type: 'send',
          operationId: 'op-1',
          mintUrl: MINT1,
          amount: 100,
          state: 'pending',
        },
      ]),
      ...overrides?.history,
    },
    wallet: {
      ...overrides?.wallet,
    },
    mint: {
      addMint: vi.fn(),
      isTrustedMint: vi.fn().mockResolvedValue(true),
    },
    ops: {
      send: {
        prepare: vi.fn().mockResolvedValue({ id: 'prepared-send-1' }),
        execute: vi.fn().mockResolvedValue({
          operation: { id: 'op-1', createdAt: Date.now() },
          token: mockToken,
        }),
        get: vi.fn(),
        cancel: vi.fn(),
        reclaim: vi.fn(),
        ...overrides?.ops?.send,
      },
      mint: {
        prepare: vi.fn(),
        ...overrides?.ops?.mint,
      },
      ...overrides?.ops,
    },
    paymentRequests: {
      parse: vi.fn().mockResolvedValue({ id: 'parsed-creq' }),
      prepare: vi.fn().mockResolvedValue({
        sendOperation: { id: 'op-1', createdAt: Date.now() },
      }),
      execute: vi.fn().mockResolvedValue(undefined),
      ...overrides?.paymentRequests,
    },
    send: {
      prepareSend: vi.fn(),
      executePreparedSend: vi.fn(),
      getOperation: vi.fn(),
      checkPendingOperation: vi.fn(),
      rollback: vi.fn(),
      ...overrides?.send,
    },
    quotes: {
      mint: {
        create: vi.fn(),
        ...overrides?.quotes?.mint,
      },
      createMintQuote: vi.fn(),
      ...overrides?.quotes,
    },
    _mockToken: mockToken,
  };
}

// Stub detectors so defaultDetectors.getPaymentRequestInfo works.
// The real detectors are used — we need a valid-ish payment request
// or we mock the module. Since defaultOperations imports defaultDetectors
// internally, we mock the module.
vi.mock('../../src/detectors', () => ({
  defaultDetectors: {
    getPaymentRequestInfo: vi.fn(),
  },
}));
const mockGetPRInfo = defaultDetectors.getPaymentRequestInfo as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Nostr transport — sendNostrDM is called with correct payload
// ---------------------------------------------------------------------------

describe('executePaymentRequest — Nostr transport', () => {
  it('calls sendNostrDM with the Nostr target and token payload', async () => {
    const sendNostrDM = vi.fn().mockResolvedValue(undefined);
    const mockManager = createMockManager();

    mockGetPRInfo.mockReturnValue({
      mints: [MINT1],
      amount: 100,
      unit: 'sat',
      transports: [{ type: 'nostr', target: 'nprofile1abc' }],
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      sendNostrDM,
    });

    const result = await ops.executePaymentRequest!(MINT1, 'creqABC', 100, 'sat');

    expect(mockManager.ops.send.prepare).toHaveBeenCalledWith({ mintUrl: MINT1, amount: 100 });
    expect(mockManager.ops.send.execute).toHaveBeenCalledWith('prepared-send-1');
    expect(sendNostrDM).toHaveBeenCalledOnce();
    const [target, payloadStr] = sendNostrDM.mock.calls[0];
    expect(target).toBe('nprofile1abc');

    const payload = JSON.parse(payloadStr);
    expect(payload).toMatchObject({
      id: 'creqABC',
      mint: MINT1,
      unit: 'sat',
    });
    expect(payload.proofs).toEqual(mockManager._mockToken.proofs);

    expect(result.historyEntry).toBeDefined();
    expect(typeof result.historyEntry).toBe('string');
  });

  it('throws when sendNostrDM is not provided for Nostr transport', async () => {
    const mockManager = createMockManager();

    mockGetPRInfo.mockReturnValue({
      mints: [MINT1],
      amount: 100,
      unit: 'sat',
      transports: [{ type: 'nostr', target: 'nprofile1abc' }],
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      // sendNostrDM intentionally omitted
    });

    await expect(ops.executePaymentRequest!(MINT1, 'creqABC', 100, 'sat')).rejects.toThrow(
      'sendNostrDM operation is required'
    );
  });
});

// ---------------------------------------------------------------------------
// HTTP transport — does NOT call sendNostrDM
// ---------------------------------------------------------------------------

describe('executePaymentRequest — HTTP transport', () => {
  it('executes through paymentRequests API and does NOT call sendNostrDM', async () => {
    const sendNostrDM = vi.fn().mockResolvedValue(undefined);
    const mockManager = createMockManager();

    mockGetPRInfo.mockReturnValue({
      mints: [MINT1],
      amount: 100,
      unit: 'sat',
      transports: [{ type: 'post', target: 'https://receiver.example.com/pay' }],
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      sendNostrDM,
    });

    await ops.executePaymentRequest!(MINT1, 'creqHTTP', 100, 'sat');

    expect(sendNostrDM).not.toHaveBeenCalled();
    expect(mockManager.paymentRequests.parse).toHaveBeenCalledWith('creqHTTP');
    expect(mockManager.paymentRequests.prepare).toHaveBeenCalledWith(
      { id: 'parsed-creq' },
      { mintUrl: MINT1, amount: 100 }
    );
    expect(mockManager.paymentRequests.execute).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Inband transport (no Nostr, no HTTP) — uses paymentRequests API fallback
// ---------------------------------------------------------------------------

describe('executePaymentRequest — inband fallback', () => {
  it('executes through paymentRequests API when no explicit transport matches', async () => {
    const sendNostrDM = vi.fn().mockResolvedValue(undefined);
    const mockManager = createMockManager();

    mockGetPRInfo.mockReturnValue({
      mints: [MINT1],
      amount: 100,
      unit: 'sat',
      transports: [],
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      sendNostrDM,
    });

    await ops.executePaymentRequest!(MINT1, 'creqInband', 100, 'sat');

    expect(sendNostrDM).not.toHaveBeenCalled();
    expect(mockManager.paymentRequests.parse).toHaveBeenCalledWith('creqInband');
    expect(mockManager.paymentRequests.prepare).toHaveBeenCalledWith(
      { id: 'parsed-creq' },
      { mintUrl: MINT1, amount: 100 }
    );
    expect(mockManager.paymentRequests.execute).toHaveBeenCalledOnce();
  });
});

describe('executeMintQuote — onchain', () => {
  it('prepares a durable mint operation for reusable onchain receive quotes', async () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
    const quote = {
      method: 'onchain',
      quoteId: 'onchain-q-1',
      request: address,
      mintUrl: MINT1,
      unit: 'sat',
      createdAt: 1,
      updatedAt: 2,
      quoteData: {
        amountPaid: Amount.from(0),
        amountIssued: Amount.from(0),
      },
    };
    const mintOp = {
      id: 'op-onchain-1',
      state: 'pending',
      createdAt: 3,
      updatedAt: 4,
      mintUrl: MINT1,
      unit: 'sat',
      quoteId: quote.quoteId,
      amount: Amount.from(123),
      request: address,
    };
    const persistedEntry = {
      id: `mint:${mintOp.id}`,
      type: 'mint',
      source: 'operation',
      operationId: mintOp.id,
      createdAt: mintOp.createdAt,
      updatedAt: mintOp.updatedAt,
      mintUrl: MINT1,
      unit: 'sat',
      quoteId: quote.quoteId,
      state: 'pending',
      amount: mintOp.amount,
      paymentRequest: address,
    };
    const mockManager = createMockManager({
      history: {
        getPaginatedHistory: vi.fn().mockResolvedValue([persistedEntry]),
      },
      quotes: {
        mint: {
          create: vi.fn().mockResolvedValue(quote),
        },
      },
      ops: {
        mint: {
          prepare: vi.fn().mockResolvedValue(mintOp),
        },
      },
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
    });

    const result = await ops.executeMintQuote!(MINT1, 123, 'sat', 'onchain');
    const entry = JSON.parse(result.historyEntry);

    expect(mockManager.quotes.mint.create).toHaveBeenCalledWith({
      mintUrl: MINT1,
      method: 'onchain',
      unit: 'sat',
    });
    expect(mockManager.ops.mint.prepare).toHaveBeenCalledWith({
      mintUrl: MINT1,
      method: 'onchain',
      quoteId: quote.quoteId,
      amount: 123,
      unit: 'sat',
      methodData: {},
    });
    expect(entry).toMatchObject({
      id: `mint:${mintOp.id}`,
      type: 'mint',
      source: 'operation',
      operationId: mintOp.id,
      quoteId: quote.quoteId,
      paymentRequest: address,
      metadata: {
        method: 'onchain',
        onchainAddress: address,
        requestedAmount: '123',
      },
    });
  });
});
