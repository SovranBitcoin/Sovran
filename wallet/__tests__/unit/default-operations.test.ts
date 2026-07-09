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
    // parsePaymentInput (used by executeMelt's onchain-target detection)
    // walks the full detector surface; stub the rest as no-matches so raw
    // onchain addresses fall through to the built-in address recognizer.
    parseNpub: vi.fn(() => null),
    isLightningInvoice: vi.fn(() => false),
    isBolt12Offer: vi.fn(() => false),
    getBolt12Amount: vi.fn(() => null),
    isLightningAddress: vi.fn(() => false),
    isLnurlp: vi.fn(() => false),
    isPaymentRequest: vi.fn(() => false),
    isValidEcashToken: vi.fn(() => false),
    getLightningAmount: vi.fn(() => null),
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

describe('executeMelt — onchain (coco v2)', () => {
  const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  const FEE_OPTIONS = [
    { fee_index: 0, fee_reserve: 900, estimated_blocks: 1 },
    { fee_index: 1, fee_reserve: 300, estimated_blocks: 6 },
  ];

  function onchainMocks() {
    const quote = {
      mintUrl: MINT1,
      method: 'onchain',
      quoteId: 'omq-1',
      fee_options: FEE_OPTIONS,
    };
    const create = vi.fn().mockResolvedValue(quote);
    const prepare = vi.fn().mockResolvedValue({ id: 'melt-op-1', quoteId: 'omq-1' });
    const execute = vi.fn().mockResolvedValue({
      id: 'melt-op-1',
      quoteId: 'omq-1',
      mintUrl: MINT1,
      createdAt: 1111,
      state: 'pending',
      amount: 500,
    });
    const cancel = vi.fn().mockResolvedValue(undefined);
    return { quote, create, prepare, execute, cancel };
  }

  it('threads the picked feeIndex into ops.melt.prepare', async () => {
    const { quote, create, prepare, execute } = onchainMocks();
    const selectOnchainFeeIndex = vi.fn().mockResolvedValue(1);
    const mockManager = createMockManager({
      quotes: { melt: { create } },
      ops: { melt: { prepare, execute, cancel: vi.fn() } },
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      selectOnchainFeeIndex,
    });

    const result = await ops.executeMelt!(MINT1, ADDRESS, 500, 'sat');

    expect(create).toHaveBeenCalledWith({
      mintUrl: MINT1,
      method: 'onchain',
      methodData: { address: ADDRESS, amountSats: 500 },
      unit: 'sat',
    });
    expect(selectOnchainFeeIndex).toHaveBeenCalledWith(FEE_OPTIONS);
    expect(prepare).toHaveBeenCalledWith({ quote, feeIndex: 1 });
    const entry = JSON.parse(result.historyEntry);
    expect(entry).toMatchObject({
      type: 'melt',
      state: 'PENDING',
      amount: 500,
      metadata: { method: 'onchain', onchainAddress: ADDRESS },
    });
  });

  it('cancels before prepare when the fee picker is dismissed', async () => {
    const { create, prepare, execute } = onchainMocks();
    const mockManager = createMockManager({
      quotes: { melt: { create } },
      ops: { melt: { prepare, execute, cancel: vi.fn() } },
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      selectOnchainFeeIndex: vi.fn().mockResolvedValue(null),
    });

    // The named cancel error routes as a quiet user-cancel (no failure toast).
    await expect(ops.executeMelt!(MINT1, ADDRESS, 500, 'sat')).rejects.toMatchObject({
      name: 'MeltUserCancelledError',
    });
    // No proofs were ever reserved: prepare/execute never ran.
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('auto-selects a lone fee option without showing the picker', async () => {
    const { create, prepare, execute } = onchainMocks();
    const soleOption = [{ fee_index: 3, fee_reserve: 450, estimated_blocks: 6 }];
    create.mockResolvedValue({
      mintUrl: MINT1,
      method: 'onchain',
      quoteId: 'omq-1',
      fee_options: soleOption,
    });
    const selectOnchainFeeIndex = vi.fn().mockResolvedValue(0);
    const mockManager = createMockManager({
      quotes: { melt: { create } },
      ops: { melt: { prepare, execute, cancel: vi.fn() } },
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      selectOnchainFeeIndex,
    });

    await ops.executeMelt!(MINT1, ADDRESS, 500, 'sat');
    // NUT-30 requires echoing a fee_index, not that the user pick one — a
    // one-button sheet is noise.
    expect(selectOnchainFeeIndex).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledWith({
      quote: expect.objectContaining({ quoteId: 'omq-1' }),
      feeIndex: 3,
    });
  });

  it('falls back to the cheapest fee option without a picker', async () => {
    const { quote, create, prepare, execute } = onchainMocks();
    const mockManager = createMockManager({
      quotes: { melt: { create } },
      ops: { melt: { prepare, execute, cancel: vi.fn() } },
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
    });

    await ops.executeMelt!(MINT1, ADDRESS, 500, 'sat');
    expect(prepare).toHaveBeenCalledWith({ quote, feeIndex: 1 });
  });

  it('cancels the operation when execute throws (reservation rescue)', async () => {
    const { create, prepare } = onchainMocks();
    const execute = vi.fn().mockRejectedValue(new Error('mint 500'));
    const cancel = vi.fn().mockResolvedValue(undefined);
    const mockManager = createMockManager({
      quotes: { melt: { create } },
      ops: { melt: { prepare, execute, cancel } },
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      selectOnchainFeeIndex: vi.fn().mockResolvedValue(0),
    });

    await expect(ops.executeMelt!(MINT1, ADDRESS, 500, 'sat')).rejects.toThrow('mint 500');
    expect(cancel).toHaveBeenCalledWith('melt-op-1', 'Execute failed');
  });

  it('converts fiat-unit cents to sats for onchain amountSats', async () => {
    const { create, prepare, execute } = onchainMocks();
    const mockManager = createMockManager({
      quotes: { melt: { create } },
      ops: { melt: { prepare, execute, cancel: vi.fn() } },
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      selectOnchainFeeIndex: vi.fn().mockResolvedValue(0),
      // 1 usd-cent = 10 sats (BTC at $100k)
      getSatsPerUnitMinor: (unit) => (unit === 'usd' ? 10 : null),
    });

    await ops.executeMelt!(MINT1, ADDRESS, 500, 'usd');

    expect(create).toHaveBeenCalledWith({
      mintUrl: MINT1,
      method: 'onchain',
      methodData: { address: ADDRESS, amountSats: 5000 },
      unit: 'usd',
    });
  });

  it('throws UnitRateUnavailableError instead of booking cents as sats', async () => {
    const { create, prepare, execute } = onchainMocks();
    const mockManager = createMockManager({
      quotes: { melt: { create } },
      ops: { melt: { prepare, execute, cancel: vi.fn() } },
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
      selectOnchainFeeIndex: vi.fn().mockResolvedValue(0),
      getSatsPerUnitMinor: () => null,
    });

    await expect(ops.executeMelt!(MINT1, ADDRESS, 500, 'usd')).rejects.toMatchObject({
      name: 'UnitRateUnavailableError',
    });
    expect(create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// executeMelt — bolt12 (coco v2, NUT-25)
// ---------------------------------------------------------------------------

describe('executeMelt — bolt12 (coco v2)', () => {
  const OFFER = 'lno1pqps7sjqpgtyzm3qv4uxzmtsd3jjqer9wd3hy6tsw35k7msjz';

  it('creates a bolt12 melt quote (quote-first, no fee picker) and books the entry', async () => {
    // The offer must classify as bolt12Offer — override the module-level mock.
    (defaultDetectors.isBolt12Offer as ReturnType<typeof vi.fn>).mockImplementation(
      (v: string) => v.toLowerCase().startsWith('lno1'),
    );
    const quote = { mintUrl: MINT1, method: 'bolt12', quoteId: 'b12q-1' };
    const create = vi.fn().mockResolvedValue(quote);
    const prepare = vi.fn().mockResolvedValue({ id: 'melt-op-b12', quoteId: 'b12q-1' });
    const execute = vi.fn().mockResolvedValue({
      id: 'melt-op-b12',
      quoteId: 'b12q-1',
      mintUrl: MINT1,
      createdAt: 2222,
      state: 'pending',
      amount: 400,
    });
    const mockManager = createMockManager({
      quotes: { melt: { create } },
      ops: { melt: { prepare, execute, cancel: vi.fn() } },
    });
    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
    });

    const result = await ops.executeMelt!(MINT1, OFFER, 400, 'sat');

    // amountSats always supplied (required for amountless, validated for fixed).
    expect(create).toHaveBeenCalledWith({
      mintUrl: MINT1,
      method: 'bolt12',
      methodData: { offer: OFFER, amountSats: 400 },
      unit: 'sat',
    });
    // Single fee_reserve → no feeIndex, unlike onchain.
    expect(prepare).toHaveBeenCalledWith({ quote });
    const entry = JSON.parse(result.historyEntry);
    expect(entry).toMatchObject({
      type: 'melt',
      state: 'PENDING',
      amount: 400,
      metadata: { method: 'bolt12', meltTarget: OFFER },
    });

    (defaultDetectors.isBolt12Offer as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });
});

// ---------------------------------------------------------------------------
// createPaymentRequestReceive — fixed-amount "as Ecash" MUST be single-use
// ---------------------------------------------------------------------------

describe('createPaymentRequestReceive — single-use invariant', () => {
  it('creates the fixed-amount request with singleUse: true', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'pr-op-1',
      encodedRequest: 'creqAbc',
      mints: [MINT1],
      unit: 'sat',
    });
    const mockManager = createMockManager({
      mint: {
        getAllTrustedMints: vi.fn().mockResolvedValue([{ mintUrl: MINT1 }]),
      },
      paymentRequests: { incoming: { create } },
    });

    const ops = createDefaultOperations({
      getManager: () => mockManager as unknown as Manager,
    });

    await ops.createPaymentRequestReceive!({ amount: 100, unit: 'sat' });

    // A fixed amount is a one-off — it must never be reusable, unlike the
    // amountless standing QR-Display request (which is created singleUse:false).
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      amount: 100,
      unit: 'sat',
      singleUse: true,
    });
  });
});
