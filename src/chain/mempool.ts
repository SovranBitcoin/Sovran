import { z } from 'zod';

import type {
  ChainAdapter,
  ChainAddressStats,
  ChainAddressSummary,
  ChainFeeEstimate,
  ChainTransactionStatus,
} from '../adapters';
import { safeFetch, type RequestControls } from '../safeFetch';

const MEMPOOL_API_BASE_URL = 'https://mempool.space/api';
const MEMPOOL_TIMEOUT_MS = 5_000;

const AddressStats = z.object({
  tx_count: z.number().int().nonnegative(),
  funded_txo_count: z.number().int().nonnegative(),
  funded_txo_sum: z.number().int().nonnegative(),
  spent_txo_count: z.number().int().nonnegative(),
  spent_txo_sum: z.number().int().nonnegative(),
});

const FundingTx = z.object({
  txid: z.string().min(1),
  valueSats: z.number().int().nonnegative(),
  confirmations: z.number().int().positive(),
});

export const MempoolAddressStatsSchema = z
  .object({
    address: z.string().min(1).max(256),
    chain_stats: AddressStats,
    mempool_stats: AddressStats,
    fundingTxs: z.array(FundingTx).optional(),
  })
  .passthrough();

export type MempoolAddressStats = z.infer<typeof MempoolAddressStatsSchema>;
export type MempoolAddressSummary = ChainAddressSummary;

const MempoolTxSchema = z
  .object({
    txid: z.string().min(1),
    status: z
      .object({
        confirmed: z.boolean(),
        block_height: z.number().int().nonnegative().optional(),
        block_hash: z.string().optional(),
      })
      .passthrough(),
    vout: z
      .array(
        z
          .object({
            scriptpubkey_address: z.string().optional(),
            value: z.number().int().nonnegative(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

const MempoolTxsSchema = z.array(MempoolTxSchema);
const MempoolTipHeightSchema = z.number().int().nonnegative();
const MempoolFeeEstimateSchema = z.object({
  fastestFee: z.number().nonnegative(),
  halfHourFee: z.number().nonnegative(),
  hourFee: z.number().nonnegative(),
  minimumFee: z.number().nonnegative(),
});
const MempoolTxStatusSchema = z
  .object({
    confirmed: z.boolean(),
    block_height: z.number().int().nonnegative().optional(),
    block_hash: z.string().optional(),
  })
  .passthrough();

type MempoolTx = z.infer<typeof MempoolTxSchema>;

async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  where: string,
  controls: RequestControls = {},
  init: RequestInit = {},
): Promise<T> {
  const response = await safeFetch(
    url,
    { timeoutMs: MEMPOOL_TIMEOUT_MS, ...controls },
    { headers: { Accept: 'application/json', ...init.headers }, ...init },
  );
  if (!response.ok) {
    throw new Error(`${where} failed with HTTP ${response.status}`);
  }
  const json = await response.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${where} response did not match expected schema`);
  }
  return parsed.data;
}

async function fetchText(
  url: string,
  where: string,
  controls: RequestControls = {},
  init: RequestInit = {},
): Promise<string> {
  const response = await safeFetch(
    url,
    { timeoutMs: MEMPOOL_TIMEOUT_MS, ...controls },
    { headers: { Accept: 'text/plain', ...init.headers }, ...init },
  );
  if (!response.ok) {
    throw new Error(`${where} failed with HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchMempoolAddressTxs(
  address: string,
  controls: RequestControls = {},
): Promise<MempoolTx[]> {
  return fetchJson(
    `${MEMPOOL_API_BASE_URL}/address/${encodeURIComponent(address)}/txs`,
    MempoolTxsSchema,
    'mempool/address/txs',
    controls,
  );
}

async function fetchMempoolTipHeight(controls: RequestControls = {}): Promise<number> {
  const text = await fetchText(
    `${MEMPOOL_API_BASE_URL}/blocks/tip/height`,
    'mempool/blocks/tip/height',
    controls,
  );
  const parsed = MempoolTipHeightSchema.safeParse(Number(text));
  if (!parsed.success) {
    throw new Error('mempool/blocks/tip/height response did not match expected schema');
  }
  return parsed.data;
}

function getFundingTxs(
  txs: MempoolTx[],
  address: string,
  tipHeight: number,
): MempoolAddressStats['fundingTxs'] {
  const fundingTxs = txs
    .filter((tx) => tx.status.confirmed && tx.status.block_height != null)
    .map((tx) => {
      const valueSats = tx.vout.reduce(
        (sum, output) => (output.scriptpubkey_address === address ? sum + output.value : sum),
        0,
      );
      if (valueSats <= 0 || tx.status.block_height == null) return null;
      return {
        txid: tx.txid,
        valueSats,
        confirmations: Math.max(1, tipHeight - tx.status.block_height + 1),
      };
    })
    .filter((tx): tx is NonNullable<MempoolAddressStats['fundingTxs']>[number] => tx !== null);

  return fundingTxs.length > 0 ? fundingTxs : undefined;
}

function toChainTransactionStatus(
  tx: MempoolTx,
  tipHeight: number | null,
): ChainTransactionStatus {
  const blockHeight = tx.status.block_height;
  const confirmations =
    tx.status.confirmed && blockHeight != null && tipHeight != null
      ? Math.max(1, tipHeight - blockHeight + 1)
      : 0;

  return {
    txid: tx.txid,
    confirmed: tx.status.confirmed,
    ...(blockHeight != null ? { blockHeight } : {}),
    ...(tx.status.block_hash ? { blockHash: tx.status.block_hash } : {}),
    confirmations,
  };
}

export async function fetchMempoolAddressStats(
  address: string,
  controls: RequestControls = {},
): Promise<MempoolAddressStats> {
  const stats = await fetchJson(
    `${MEMPOOL_API_BASE_URL}/address/${encodeURIComponent(address)}`,
    MempoolAddressStatsSchema,
    'mempool/address',
    controls,
  );

  if (stats.chain_stats.tx_count === 0) {
    return stats;
  }

  try {
    const [txs, tipHeight] = await Promise.all([
      fetchMempoolAddressTxs(address, controls),
      fetchMempoolTipHeight(controls),
    ]);
    return {
      ...stats,
      fundingTxs: getFundingTxs(txs, stats.address, tipHeight),
    };
  } catch {
    return stats;
  }
}

export function summarizeMempoolAddress(stats: ChainAddressStats): ChainAddressSummary {
  const confirmedReceivedSats = stats.chain_stats.funded_txo_sum;
  const confirmedBalanceSats = stats.chain_stats.funded_txo_sum - stats.chain_stats.spent_txo_sum;
  const unconfirmedNetSats = stats.mempool_stats.funded_txo_sum - stats.mempool_stats.spent_txo_sum;
  const fundingConfirmations = stats.fundingTxs?.map((tx) => tx.confirmations) ?? [];

  return {
    address: stats.address,
    confirmedTxCount: stats.chain_stats.tx_count,
    confirmedReceivedSats,
    confirmedBalanceSats: Math.max(0, confirmedBalanceSats),
    confirmedFundingConfirmations:
      fundingConfirmations.length > 0 ? Math.min(...fundingConfirmations) : null,
    unconfirmedTxCount: stats.mempool_stats.tx_count,
    unconfirmedReceivedSats: stats.mempool_stats.funded_txo_sum,
    unconfirmedNetSats: Math.max(0, unconfirmedNetSats),
    totalReceivedSats: confirmedReceivedSats + stats.mempool_stats.funded_txo_sum,
    explorerUrl: `https://mempool.space/address/${encodeURIComponent(stats.address)}`,
  };
}

export interface MempoolSpaceChainAdapterOptions {
  network?: ChainAdapter['network'];
}

export function createMempoolSpaceChainAdapter(
  options: MempoolSpaceChainAdapterOptions = {},
): ChainAdapter {
  return {
    network: options.network ?? 'mainnet',
    estimateFees: (): Promise<ChainFeeEstimate> =>
      fetchJson(
        `${MEMPOOL_API_BASE_URL}/v1/fees/recommended`,
        MempoolFeeEstimateSchema,
        'mempool/fees',
      ),
    getAddressTransactions: async (address): Promise<ChainTransactionStatus[]> => {
      const [txs, tipHeight] = await Promise.all([
        fetchMempoolAddressTxs(address),
        fetchMempoolTipHeight().catch(() => null),
      ]);
      return txs.map((tx) => toChainTransactionStatus(tx, tipHeight));
    },
    getAddressStats: (address): Promise<ChainAddressStats> => fetchMempoolAddressStats(address),
    getAddressSummary: async (address): Promise<ChainAddressSummary> =>
      summarizeMempoolAddress(await fetchMempoolAddressStats(address)),
    getTransactionStatus: async (txid): Promise<ChainTransactionStatus | null> => {
      const status = await fetchJson(
        `${MEMPOOL_API_BASE_URL}/tx/${encodeURIComponent(txid)}/status`,
        MempoolTxStatusSchema,
        'mempool/tx/status',
      );
      const tipHeight = status.confirmed ? await fetchMempoolTipHeight().catch(() => null) : null;
      const blockHeight = status.block_height;
      const confirmations =
        status.confirmed && blockHeight != null && tipHeight != null
          ? Math.max(1, tipHeight - blockHeight + 1)
          : 0;
      return {
        txid,
        confirmed: status.confirmed,
        ...(blockHeight != null ? { blockHeight } : {}),
        ...(status.block_hash ? { blockHash: status.block_hash } : {}),
        confirmations,
      };
    },
    broadcastTransaction: async (rawTxHex): Promise<{ txid: string }> => {
      const txid = await fetchText(`${MEMPOOL_API_BASE_URL}/tx`, 'mempool/tx', {}, {
        method: 'POST',
        body: rawTxHex,
        headers: { 'Content-Type': 'text/plain' },
      });
      return { txid: txid.trim() };
    },
  };
}

export const defaultChainAdapter = createMempoolSpaceChainAdapter();
