import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  accelerationTotalSats,
  createAccelerationInvoice,
  defaultAccelerationBidSats,
  fetchAccelerationEstimate,
  fetchAccelerationStatus,
  fetchAverageBlockTimeMinutes,
  isAcknowledgedAccelerationStatus,
  type AccelerationEstimate,
} from '../../src/chain';

const TXID = 'ab'.repeat(32);

// Live-verified guest response shape (2026-07-09).
const ESTIMATE_BODY = {
  txSummary: { txid: TXID, effectiveVsize: 110, effectiveFee: 550, ancestorCount: 1 },
  cost: 1000,
  targetFeeRate: 6,
  nextBlockFee: 660,
  userBalance: 0,
  mempoolBaseFee: 75_000,
  vsizeFee: 50_000,
  pools: [44, 102],
  options: [{ fee: 1000 }, { fee: 2000 }, { fee: 10_000 }],
  isProUser: false,
  availablePaymentMethods: { bitcoin: { enabled: true, min: 1000, max: 10_000_000 } },
  unavailable: false,
};

function stubFetch(status: number, body?: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body === undefined) throw new Error('Unexpected end of JSON input');
        return body;
      },
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    };
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mempool accelerator — estimate', () => {
  it('parses a guest estimate and posts {txInput}', async () => {
    const calls = stubFetch(200, ESTIMATE_BODY);
    const estimate = await fetchAccelerationEstimate(TXID);
    expect(estimate).toMatchObject({ cost: 1000, mempoolBaseFee: 75_000, vsizeFee: 50_000 });
    expect(calls[0]!.url).toContain('/services/accelerator/estimate');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ txInput: TXID });
  });

  it('returns null for an ineligible tx (HTTP 400 cannot_accelerate_tx)', async () => {
    stubFetch(400, 'cannot_accelerate_tx');
    await expect(fetchAccelerationEstimate(TXID)).resolves.toBeNull();
  });

  it('returns null on an empty 204-style body', async () => {
    stubFetch(204);
    await expect(fetchAccelerationEstimate(TXID)).resolves.toBeNull();
  });

  it('returns null when the service reports itself unavailable', async () => {
    stubFetch(200, { ...ESTIMATE_BODY, unavailable: true });
    await expect(fetchAccelerationEstimate(TXID)).resolves.toBeNull();
  });

  it('returns null when Lightning payment is disabled', async () => {
    stubFetch(200, {
      ...ESTIMATE_BODY,
      availablePaymentMethods: { bitcoin: { enabled: false } },
    });
    await expect(fetchAccelerationEstimate(TXID)).resolves.toBeNull();
  });

  it('still throws on server errors', async () => {
    stubFetch(500);
    await expect(fetchAccelerationEstimate(TXID)).rejects.toThrow('HTTP 500');
  });
});

describe('mempool accelerator — pricing helpers', () => {
  const estimate = ESTIMATE_BODY as unknown as AccelerationEstimate;

  it('preselects the middle recommended bid', () => {
    expect(defaultAccelerationBidSats(estimate)).toBe(2000);
    expect(defaultAccelerationBidSats({ ...estimate, options: [{ fee: 700 }] })).toBe(700);
    expect(defaultAccelerationBidSats({ ...estimate, options: [] })).toBe(1000);
  });

  it('totals bid + base fee + vsize fee (the price the user pays)', () => {
    expect(accelerationTotalSats(estimate, 1000)).toBe(126_000);
  });
});

describe('mempool accelerator — invoice', () => {
  it('returns the BOLT11 from a BTCPay invoice and posts {txid, maxBidBoost}', async () => {
    const calls = stubFetch(200, {
      btcpayInvoiceId: 'XLzovvLjyiiETEqoVwtB8d',
      btcDue: 0.00126,
      addresses: { BTC_LightningLike: 'lnbc1260u1p49qyzn...' },
      expirationTime: 1_783_632_854,
    });
    const invoice = await createAccelerationInvoice(TXID, 1000);
    expect(invoice).toEqual({
      invoiceId: 'XLzovvLjyiiETEqoVwtB8d',
      bolt11: 'lnbc1260u1p49qyzn...',
      expiresAtSec: 1_783_632_854,
    });
    expect(calls[0]!.url).toContain('/services/accelerator/invoice');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ txid: TXID, maxBidBoost: 1000 });
  });

  it('returns null when the invoice carries no Lightning address', async () => {
    stubFetch(200, { btcpayInvoiceId: 'abc123', addresses: {} });
    await expect(createAccelerationInvoice(TXID, 1000)).resolves.toBeNull();
  });

  it('propagates a rejected invoice (400 txid_not_in_mempool)', async () => {
    stubFetch(400, 'txid_not_in_mempool');
    await expect(createAccelerationInvoice(TXID, 1000)).rejects.toThrow('HTTP 400');
  });
});

describe('mempool accelerator — status', () => {
  it('maps a live acceleration', async () => {
    stubFetch(200, { txid: TXID, status: 'accelerating', pools: [44] });
    await expect(fetchAccelerationStatus(TXID)).resolves.toEqual({
      txid: TXID,
      status: 'accelerating',
    });
  });

  it('returns null for a never-accelerated txid (404)', async () => {
    stubFetch(404);
    await expect(fetchAccelerationStatus(TXID)).resolves.toBeNull();
  });

  it('acknowledges only explicit active or completed statuses', () => {
    expect(isAcknowledgedAccelerationStatus({ txid: TXID, status: 'accelerating' })).toBe(true);
    expect(isAcknowledgedAccelerationStatus({ txid: TXID, status: 'mined' })).toBe(true);
    expect(isAcknowledgedAccelerationStatus({ txid: TXID, status: 'completed' })).toBe(true);
    expect(isAcknowledgedAccelerationStatus({ txid: TXID, status: 'failed' })).toBe(false);
    expect(isAcknowledgedAccelerationStatus({ txid: TXID, status: 'unknown' })).toBe(false);
    expect(isAcknowledgedAccelerationStatus(null)).toBe(false);
  });
});

describe('mempool accelerator — average block time', () => {
  it('converts adjustedTimeAvg ms to whole minutes', async () => {
    stubFetch(200, { timeAvg: 600_000, adjustedTimeAvg: 540_000 });
    await expect(fetchAverageBlockTimeMinutes()).resolves.toBe(9);
  });

  it('falls back to 10 minutes when the feed is unreachable', async () => {
    stubFetch(500);
    await expect(fetchAverageBlockTimeMinutes()).resolves.toBe(10);
  });
});
