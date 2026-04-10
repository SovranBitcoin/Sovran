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
import { createDefaultOperations } from '../../src/operations/defaultOperations';

const MINT1 = 'https://mint1.example.com';

function createMockManager(overrides?: Record<string, any>) {
  const mockToken = { proofs: [{ id: 'proof-1', amount: 100, C: 'abc', secret: 'def' }] };
  let inbandCallback: ((token: any) => Promise<void>) | null = null;

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
    },
    wallet: {
      processPaymentRequest: vi.fn().mockResolvedValue({ matchingMints: [MINT1] }),
      preparePaymentRequestTransaction: vi.fn().mockResolvedValue({
        sendOperation: { id: 'op-1', createdAt: Date.now() },
      }),
      handleHttpPaymentRequest: vi.fn().mockResolvedValue(undefined),
      handleInbandPaymentRequest: vi.fn().mockImplementation(async (_tx, cb) => {
        inbandCallback = cb;
        if (cb) await cb(mockToken);
      }),
      ...overrides?.wallet,
    },
    mint: {
      addMint: vi.fn(),
      isTrustedMint: vi.fn().mockResolvedValue(true),
    },
    send: {
      prepareSend: vi.fn(),
      executePreparedSend: vi.fn(),
      getOperation: vi.fn(),
      checkPendingOperation: vi.fn(),
      rollback: vi.fn(),
    },
    quotes: {
      createMintQuote: vi.fn(),
    },
    _getInbandCallback: () => inbandCallback,
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

import { defaultDetectors } from '../../src/detectors';
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
      getManager: () => mockManager as any,
      sendNostrDM,
    });

    const result = await ops.executePaymentRequest!(MINT1, 'creqABC', 100, 'sat');

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
      getManager: () => mockManager as any,
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
  it('calls handleHttpPaymentRequest and does NOT call sendNostrDM', async () => {
    const sendNostrDM = vi.fn().mockResolvedValue(undefined);
    const mockManager = createMockManager();

    mockGetPRInfo.mockReturnValue({
      mints: [MINT1],
      amount: 100,
      unit: 'sat',
      transports: [{ type: 'post', target: 'https://receiver.example.com/pay' }],
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as any,
      sendNostrDM,
    });

    await ops.executePaymentRequest!(MINT1, 'creqHTTP', 100, 'sat');

    expect(sendNostrDM).not.toHaveBeenCalled();
    expect(mockManager.wallet.handleHttpPaymentRequest).toHaveBeenCalledOnce();
    expect(mockManager.wallet.handleInbandPaymentRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Inband transport (no Nostr, no HTTP) — uses empty callback
// ---------------------------------------------------------------------------

describe('executePaymentRequest — inband fallback', () => {
  it('calls handleInbandPaymentRequest with empty callback when no transport matches', async () => {
    const sendNostrDM = vi.fn().mockResolvedValue(undefined);
    const mockManager = createMockManager();

    mockGetPRInfo.mockReturnValue({
      mints: [MINT1],
      amount: 100,
      unit: 'sat',
      transports: [],
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as any,
      sendNostrDM,
    });

    await ops.executePaymentRequest!(MINT1, 'creqInband', 100, 'sat');

    expect(sendNostrDM).not.toHaveBeenCalled();
    expect(mockManager.wallet.handleHttpPaymentRequest).not.toHaveBeenCalled();
    expect(mockManager.wallet.handleInbandPaymentRequest).toHaveBeenCalledOnce();
  });
});
