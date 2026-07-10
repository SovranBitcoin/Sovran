import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addressExplorerUrl,
  buildOnchainConfirmationProgressFromTx,
  createMempoolSpaceChainAdapter,
  getOnchainConfirmationProgress,
  matchUniqueSendOutpoint,
  parseOutpoint,
  shouldStopTxConfirmationPolling,
  summarizeMempoolAddress,
  transactionExplorerUrlForTxid,
  type AddressOutpointCandidateTx,
  type MempoolAddressStats,
} from '../../src/chain';

const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

function stats(overrides: Partial<MempoolAddressStats> = {}): MempoolAddressStats {
  return {
    address: ADDRESS,
    chain_stats: {
      tx_count: 2,
      funded_txo_count: 2,
      funded_txo_sum: 5_000,
      spent_txo_count: 1,
      spent_txo_sum: 1_000,
    },
    mempool_stats: {
      tx_count: 1,
      funded_txo_count: 1,
      funded_txo_sum: 2_000,
      spent_txo_count: 1,
      spent_txo_sum: 500,
    },
    ...overrides,
  };
}

describe('chain address summaries', () => {
  it('summarizes confirmed and unconfirmed address stats', () => {
    expect(summarizeMempoolAddress(stats())).toMatchObject({
      address: ADDRESS,
      confirmedTxCount: 2,
      confirmedReceivedSats: 5_000,
      confirmedBalanceSats: 4_000,
      confirmedFundingConfirmations: null,
      unconfirmedTxCount: 1,
      unconfirmedReceivedSats: 2_000,
      unconfirmedNetSats: 1_500,
      totalReceivedSats: 7_000,
      explorerUrl: `https://mempool.space/address/${ADDRESS}`,
    });
  });

  it('summarizes funding transaction confirmations', () => {
    const summary = summarizeMempoolAddress(
      stats({
        fundingTxs: [
          { txid: 'a', valueSats: 3_000, confirmations: 6 },
          { txid: 'b', valueSats: 2_000, confirmations: 2 },
        ],
      }),
    );

    expect(summary.confirmedFundingConfirmations).toBe(2);
  });

  it('builds onchain confirmation progress from an address summary', () => {
    const summary = summarizeMempoolAddress(
      stats({ mempool_stats: { ...stats().mempool_stats, tx_count: 0, funded_txo_sum: 0 } }),
    );

    expect(getOnchainConfirmationProgress(summary, 6)).toMatchObject({
      hasPayment: true,
      hasUnconfirmedPayment: false,
      currentConfirmations: null,
      requiredConfirmations: 6,
      isSatisfied: false,
    });
  });
});

describe('parseOutpoint (onchain melt txid:vout)', () => {
  const TXID = 'a'.repeat(64);

  it('splits a valid outpoint into txid + vout', () => {
    expect(parseOutpoint(`${TXID.toUpperCase()}:2`)).toEqual({ txid: TXID, vout: 2 });
    expect(parseOutpoint(`${TXID}:0`)).toEqual({ txid: TXID, vout: 0 });
  });

  it('rejects null / malformed outpoints', () => {
    expect(parseOutpoint(null)).toBeNull();
    expect(parseOutpoint(undefined)).toBeNull();
    expect(parseOutpoint(TXID)).toBeNull(); // no vout
    expect(parseOutpoint(`${TXID}:x`)).toBeNull(); // non-numeric vout
    expect(parseOutpoint('deadbeef:0')).toBeNull(); // short txid
  });
});

describe('matchUniqueSendOutpoint (heuristic outpoint discovery)', () => {
  const TXID_A = 'a'.repeat(64);
  const TXID_B = 'b'.repeat(64);
  const CRITERIA = { address: ADDRESS, amountSats: 5_000, notBeforeSec: 1_000 };

  const tx = (
    txid: string,
    vout: AddressOutpointCandidateTx['vout'],
    over: Partial<AddressOutpointCandidateTx> = {}
  ): AddressOutpointCandidateTx => ({ txid, confirmed: false, vout, ...over });

  it('adopts a unique exact-amount match (correct vout index)', () => {
    const txs = [
      tx(TXID_A, [
        { address: 'bc1qother', valueSats: 5_000 }, // right amount, wrong address
        { address: ADDRESS, valueSats: 123 }, // right address, wrong amount (batch change)
        { address: ADDRESS, valueSats: 5_000 }, // ours — index 2
      ]),
    ];
    expect(matchUniqueSendOutpoint(txs, CRITERIA)).toBe(`${TXID_A}:2`);
  });

  it('returns null when two transactions both match (ambiguous)', () => {
    const txs = [
      tx(TXID_A, [{ address: ADDRESS, valueSats: 5_000 }]),
      tx(TXID_B, [{ address: ADDRESS, valueSats: 5_000 }]),
    ];
    expect(matchUniqueSendOutpoint(txs, CRITERIA)).toBeNull();
  });

  it('returns null when one transaction has two matching outputs', () => {
    const txs = [
      tx(TXID_A, [
        { address: ADDRESS, valueSats: 5_000 },
        { address: ADDRESS, valueSats: 5_000 },
      ]),
    ];
    expect(matchUniqueSendOutpoint(txs, CRITERIA)).toBeNull();
  });

  it('returns null when no output pays the exact amount', () => {
    const txs = [tx(TXID_A, [{ address: ADDRESS, valueSats: 4_999 }])];
    expect(matchUniqueSendOutpoint(txs, CRITERIA)).toBeNull();
  });

  it('ignores a tx confirmed before the quote existed (address reuse)', () => {
    const txs = [
      tx(TXID_A, [{ address: ADDRESS, valueSats: 5_000 }], {
        confirmed: true,
        blockTimeSec: 500, // mined before notBeforeSec
      }),
      tx(TXID_B, [{ address: ADDRESS, valueSats: 5_000 }]),
    ];
    expect(matchUniqueSendOutpoint(txs, CRITERIA)).toBe(`${TXID_B}:0`);
  });

  it('accepts an unconfirmed tx when Esplora provides no first-seen timestamp', () => {
    const txs = [tx(TXID_A, [{ address: ADDRESS, valueSats: 5_000 }])];
    expect(matchUniqueSendOutpoint(txs, CRITERIA)).toBe(`${TXID_A}:0`);
  });

  it('accepts a confirmed tx mined after the quote', () => {
    const txs = [
      tx(TXID_A, [{ address: ADDRESS, valueSats: 5_000 }], {
        confirmed: true,
        blockTimeSec: 2_000,
      }),
    ];
    expect(matchUniqueSendOutpoint(txs, CRITERIA)).toBe(`${TXID_A}:0`);
  });

  it('rejects invalid criteria', () => {
    const txs = [tx(TXID_A, [{ address: ADDRESS, valueSats: 5_000 }])];
    expect(matchUniqueSendOutpoint(txs, { ...CRITERIA, amountSats: 0 })).toBeNull();
    expect(matchUniqueSendOutpoint(txs, { ...CRITERIA, address: '' })).toBeNull();
  });
});

describe('buildOnchainConfirmationProgressFromTx (onchain SEND)', () => {
  it('returns null when the tx is not observable yet', () => {
    expect(buildOnchainConfirmationProgressFromTx(null, 6)).toBeNull();
  });

  it('treats a mempool (0-conf) tx as an unconfirmed payment', () => {
    expect(buildOnchainConfirmationProgressFromTx({ confirmed: false, confirmations: 0 }, 6)).toMatchObject({
      hasPayment: true,
      hasUnconfirmedPayment: true,
      currentConfirmations: null,
      requiredConfirmations: 6,
      isSatisfied: false,
    });
  });

  it('counts confirmations, capping at the required target', () => {
    expect(buildOnchainConfirmationProgressFromTx({ confirmed: true, confirmations: 3 }, 6)).toMatchObject({
      hasUnconfirmedPayment: false,
      currentConfirmations: 3,
      isSatisfied: false,
    });
    expect(buildOnchainConfirmationProgressFromTx({ confirmed: true, confirmations: 9 }, 6)).toMatchObject({
      currentConfirmations: 6, // capped
      isSatisfied: true,
    });
  });
});

describe('shouldStopTxConfirmationPolling', () => {
  it('keeps polling while unmined or below the required depth', () => {
    expect(shouldStopTxConfirmationPolling(null, 6)).toBe(false);
    expect(shouldStopTxConfirmationPolling({ confirmed: false, confirmations: 0 }, 6)).toBe(false);
    expect(shouldStopTxConfirmationPolling({ confirmed: true, confirmations: 5 }, 6)).toBe(false);
  });

  it('stops exactly at the required depth (display is capped there)', () => {
    expect(shouldStopTxConfirmationPolling({ confirmed: true, confirmations: 6 }, 6)).toBe(true);
    expect(shouldStopTxConfirmationPolling({ confirmed: true, confirmations: 9 }, 6)).toBe(true);
  });

  it('normalizes an invalid required count to the default of 6', () => {
    expect(shouldStopTxConfirmationPolling({ confirmed: true, confirmations: 5 }, 0)).toBe(false);
    expect(shouldStopTxConfirmationPolling({ confirmed: true, confirmations: 6 }, -2)).toBe(true);
  });
});

describe('explorer URL helpers', () => {
  const TXID = 'ab'.repeat(32);

  it('builds the transaction explorer URL', () => {
    expect(transactionExplorerUrlForTxid(TXID)).toBe(`https://mempool.space/tx/${TXID}`);
  });

  it('builds the address explorer URL', () => {
    expect(addressExplorerUrl(ADDRESS)).toBe(`https://mempool.space/address/${ADDRESS}`);
  });

  it('is the same URL the address summary links to', () => {
    const summary = summarizeMempoolAddress(
      stats({ fundingTxs: [{ txid: TXID, valueSats: 1_000, confirmations: 1 }] }),
    );
    expect(summary.explorerUrl).toBe(addressExplorerUrl(ADDRESS));
    expect(summary.transactionExplorerUrl).toBe(transactionExplorerUrlForTxid(TXID));
  });
});

describe('getTransactionStatus HTTP contract', () => {
  const TXID = 'cd'.repeat(32);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetchStatus(status: number, body?: unknown) {
    vi.stubGlobal('fetch', async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body ?? ''),
    }));
  }

  it('returns null for an unindexed (404) txid instead of throwing', async () => {
    stubFetchStatus(404);
    const adapter = createMempoolSpaceChainAdapter();
    await expect(adapter.getTransactionStatus(TXID)).resolves.toBeNull();
  });

  it('still throws on non-404 HTTP errors', async () => {
    stubFetchStatus(500);
    const adapter = createMempoolSpaceChainAdapter();
    await expect(adapter.getTransactionStatus(TXID)).rejects.toThrow('HTTP 500');
  });
});
