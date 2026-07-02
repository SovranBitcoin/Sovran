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
import type { Manager } from '@cashu/coco-core';
import { createDefaultOperations } from '../../src/operations/defaultOperations';

import { defaultDetectors } from '../../src/detectors';

const MINT1 = 'https://mint1.example.com';

interface MockManagerOverrides {
  history?: Record<string, unknown>;
  wallet?: Record<string, unknown>;
  mint?: Record<string, unknown>;
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
      getMintInfo: vi.fn().mockResolvedValue({ name: 'Mock Mint' }),
      ...overrides?.mint,
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

describe('buildMintReviewInfo — social enrichment', () => {
  it('merges mint contact profile and aggregated reviews from callbacks', async () => {
    const contactPubkey = 'a'.repeat(64);
    const mockManager = createMockManager({
      mint: {
        getMintInfo: vi.fn().mockResolvedValue({
          name: 'Mint One',
          icon_url: 'https://mint.example.com/icon.png',
          contact: [{ method: 'nostr', info: contactPubkey }],
        }),
      },
      wallet: {
        balances: {
          byMint: vi.fn().mockResolvedValue({ [MINT1]: { total: 12 } }),
        },
      },
    });
    const resolveMintContactProfile = vi.fn().mockResolvedValue({
      pubkey: contactPubkey,
      displayName: 'Mint Operator',
      picture: 'https://example.com/operator.png',
      followers: 42,
      score: 91.4,
    });
    const fetchMintReviews = vi.fn().mockResolvedValue({
      mintUrl: MINT1,
      score: 4.5,
      recommendations: [
        {
          score: 5,
          comment: 'fast',
          pubkey: 'b'.repeat(64),
          eventId: 'c'.repeat(64),
          created_at: 1_710_000_000,
          displayName: 'Reviewer',
          picture: 'https://example.com/reviewer.png',
        },
      ],
      lastUpdated: 1_710_000_000,
      fromCache: true,
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      resolveMintContactProfile,
      fetchMintReviews,
    });

    const info = await ops.buildMintReviewInfo!(MINT1);

    expect(resolveMintContactProfile).toHaveBeenCalledWith(contactPubkey, MINT1);
    expect(fetchMintReviews).toHaveBeenCalledWith(MINT1);
    expect(info.contactProfile?.displayName).toBe('Mint Operator');
    expect(info.contactFollowers).toBe(42);
    expect(info.contactReputation).toBe(91);
    expect(info.reviews?.recommendations[0]?.displayName).toBe('Reviewer');
    expect(info.kymScore).toBe(4.5);
    expect(info.reviewCount).toBe(1);
  });

  it('skips the redundant review + profile fetches when the row already carries them', async () => {
    const contactPubkey = 'a'.repeat(64);
    const mockManager = createMockManager({
      mint: {
        getMintInfo: vi.fn().mockResolvedValue({
          name: 'Mint One',
          icon_url: 'https://mint.example.com/icon.png',
          contact: [{ method: 'nostr', info: contactPubkey }],
        }),
      },
      wallet: {
        balances: {
          byMint: vi.fn().mockResolvedValue({ [MINT1]: { total: 12 } }),
        },
      },
    });
    const resolveMintContactProfile = vi.fn().mockResolvedValue(undefined);
    const fetchMintReviews = vi.fn().mockResolvedValue(undefined);

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      resolveMintContactProfile,
      fetchMintReviews,
    });

    // The selector hands the catalog-enriched row straight through, so the
    // operator-profile + reviews fetches must NOT fire — the screen opens from
    // this data instead of waiting on two Nostr round-trips.
    const info = await ops.buildMintReviewInfo!(MINT1, {
      mintUrl: MINT1,
      displayName: 'Mint One',
      balance: 12,
      unit: 'sat',
      status: 'available',
      reason: null,
      isPreferred: false,
      kymScore: 4.2,
      reviewCount: 7,
      auditScore: 3.5,
      auditState: 'OK',
      contactFollowers: 99,
      contactReputation: 88,
    });

    expect(resolveMintContactProfile).not.toHaveBeenCalled();
    expect(fetchMintReviews).not.toHaveBeenCalled();
    expect(info.kymScore).toBe(4.2);
    expect(info.reviewCount).toBe(7);
    expect(info.contactFollowers).toBe(99);
    expect(info.contactReputation).toBe(88);
    expect(info.reviews).toBeUndefined();
  });

  it('still fetches reviews when the row has a kym score but no review count', async () => {
    const contactPubkey = 'a'.repeat(64);
    const mockManager = createMockManager({
      mint: {
        getMintInfo: vi.fn().mockResolvedValue({
          name: 'Mint One',
          icon_url: 'https://mint.example.com/icon.png',
          contact: [{ method: 'nostr', info: contactPubkey }],
        }),
      },
      wallet: {
        balances: { byMint: vi.fn().mockResolvedValue({ [MINT1]: { total: 12 } }) },
      },
    });
    const resolveMintContactProfile = vi.fn().mockResolvedValue(undefined);
    const fetchMintReviews = vi.fn().mockResolvedValue(undefined);

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      resolveMintContactProfile,
      fetchMintReviews,
    });

    // A kym score WITHOUT a review count is an incomplete review aggregate — the
    // fetch (which fills reviewCount + the list) must still run. Social is
    // complete here, so only the profile fetch is skipped.
    await ops.buildMintReviewInfo!(MINT1, {
      mintUrl: MINT1,
      displayName: 'Mint One',
      balance: 12,
      unit: 'sat',
      status: 'available',
      reason: null,
      isPreferred: false,
      kymScore: 4.2,
      contactFollowers: 99,
      contactReputation: 88,
    });

    expect(fetchMintReviews).toHaveBeenCalledWith(MINT1);
    expect(resolveMintContactProfile).not.toHaveBeenCalled();
  });

  it('still fetches the operator profile when the row has followers but no reputation', async () => {
    const contactPubkey = 'a'.repeat(64);
    const mockManager = createMockManager({
      mint: {
        getMintInfo: vi.fn().mockResolvedValue({
          name: 'Mint One',
          icon_url: 'https://mint.example.com/icon.png',
          contact: [{ method: 'nostr', info: contactPubkey }],
        }),
      },
      wallet: {
        balances: { byMint: vi.fn().mockResolvedValue({ [MINT1]: { total: 12 } }) },
      },
    });
    const resolveMintContactProfile = vi.fn().mockResolvedValue(undefined);
    const fetchMintReviews = vi.fn().mockResolvedValue(undefined);

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      resolveMintContactProfile,
      fetchMintReviews,
    });

    // Followers WITHOUT reputation is an incomplete social aggregate — the
    // operator-profile fetch (which yields reputation) must still run. Reviews
    // are complete here, so only the review fetch is skipped.
    await ops.buildMintReviewInfo!(MINT1, {
      mintUrl: MINT1,
      displayName: 'Mint One',
      balance: 12,
      unit: 'sat',
      status: 'available',
      reason: null,
      isPreferred: false,
      reviewCount: 7,
      contactFollowers: 99,
    });

    expect(resolveMintContactProfile).toHaveBeenCalledWith(contactPubkey, MINT1);
    expect(fetchMintReviews).not.toHaveBeenCalled();
  });

  it('still returns mint info when enrichment callbacks fail', async () => {
    const contactPubkey = 'a'.repeat(64);
    const mockManager = createMockManager({
      mint: {
        getMintInfo: vi.fn().mockResolvedValue({
          name: 'Mint One',
          contact: [{ method: 'nostr', info: contactPubkey }],
        }),
      },
      wallet: {
        balances: {
          byMint: vi.fn().mockResolvedValue({ [MINT1]: { total: 0 } }),
        },
      },
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      resolveMintContactProfile: vi.fn().mockRejectedValue(new Error('profile offline')),
      fetchMintReviews: vi.fn().mockRejectedValue(new Error('reviews offline')),
    });

    const info = await ops.buildMintReviewInfo!(MINT1);

    expect(info.mintUrl).toBe(MINT1);
    expect(info.displayName).toBe('Mint One');
    expect(info.contactProfile).toBeUndefined();
    expect(info.reviews).toBeUndefined();
  });
});

describe('executeMintQuote — onchain', () => {
  it('creates a fresh reusable onchain quote and prepares the operation against it (quote-first)', async () => {
    const quote = {
      mintUrl: MINT1,
      method: 'onchain',
      quoteId: 'oq-1',
      request: 'bc1qexampleaddress',
      unit: 'sat',
      reusable: true,
      expiry: null,
    };
    const prepared = {
      id: 'mint-op-1',
      mintUrl: MINT1,
      quoteId: 'oq-1',
      createdAt: 1111,
      unit: 'sat',
      amount: 123,
      request: 'bc1qexampleaddress',
      state: 'pending',
    };
    const create = vi.fn().mockResolvedValue(quote);
    const prepare = vi.fn().mockResolvedValue(prepared);
    const mockManager = createMockManager({
      quotes: { mint: { create } },
      ops: { mint: { prepare } },
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
    });

    const result = await ops.executeMintQuote!(MINT1, 123, 'sat', 'onchain');

    // v2 quote-first contract: the canonical quote row exists before the
    // durable operation, and reusable quotes take an explicit amount.
    expect(create).toHaveBeenCalledWith({ mintUrl: MINT1, method: 'onchain', unit: 'sat' });
    expect(prepare).toHaveBeenCalledWith({ quote, amount: 123 });
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(prepare.mock.invocationCallOrder[0]);

    const entry = JSON.parse(result.historyEntry);
    expect(entry).toMatchObject({
      type: 'mint',
      quoteId: 'oq-1',
      state: 'UNPAID',
      amount: 123,
      paymentRequest: 'bc1qexampleaddress',
    });
  });
});
