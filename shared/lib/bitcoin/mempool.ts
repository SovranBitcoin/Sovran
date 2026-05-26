import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import type { ParseError } from '@sovranbitcoin/schemas';
import type { RequestControls } from 'colada';

import { fetchJson } from '@/shared/lib/apiClient';

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

const MempoolTxSchema = z
  .object({
    txid: z.string().min(1),
    status: z
      .object({
        confirmed: z.boolean(),
        block_height: z.number().int().nonnegative().optional(),
      })
      .passthrough(),
    vout: z
      .array(
        z
          .object({
            scriptpubkey_address: z.string().optional(),
            value: z.number().int().nonnegative(),
          })
          .passthrough()
      )
      .default([]),
  })
  .passthrough();

const MempoolTxsSchema = z.array(MempoolTxSchema);
const MempoolTipHeightSchema = z.number().int().nonnegative();

type MempoolTx = z.infer<typeof MempoolTxSchema>;

export interface MempoolAddressSummary {
  address: string;
  confirmedTxCount: number;
  confirmedReceivedSats: number;
  confirmedBalanceSats: number;
  confirmedFundingConfirmations: number | null;
  unconfirmedTxCount: number;
  unconfirmedReceivedSats: number;
  unconfirmedNetSats: number;
  totalReceivedSats: number;
  explorerUrl: string;
}

const parseMempoolAddressStats = (input: unknown): Result<MempoolAddressStats, ParseError> => {
  const parsed = MempoolAddressStatsSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      type: 'schema/zod',
      where: 'mempool/address',
      issues: parsed.error.issues,
    });
  }
  return ok(parsed.data);
};

const parseMempoolAddressTxs = (input: unknown): Result<MempoolTx[], ParseError> => {
  const parsed = MempoolTxsSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      type: 'schema/zod',
      where: 'mempool/address/txs',
      issues: parsed.error.issues,
    });
  }
  return ok(parsed.data);
};

const parseMempoolTipHeight = (input: unknown): Result<number, ParseError> => {
  const parsed = MempoolTipHeightSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      type: 'schema/zod',
      where: 'mempool/blocks/tip/height',
      issues: parsed.error.issues,
    });
  }
  return ok(parsed.data);
};

async function fetchMempoolAddressTxs(
  address: string,
  controls: RequestControls = {}
): Promise<MempoolTx[]> {
  const result = await fetchJson(
    `${MEMPOOL_API_BASE_URL}/address/${encodeURIComponent(address)}/txs`,
    parseMempoolAddressTxs,
    'mempool/address/txs',
    { headers: { Accept: 'application/json' } },
    { timeoutMs: MEMPOOL_TIMEOUT_MS, ...controls }
  );

  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}

async function fetchMempoolTipHeight(controls: RequestControls = {}): Promise<number> {
  const result = await fetchJson(
    `${MEMPOOL_API_BASE_URL}/blocks/tip/height`,
    parseMempoolTipHeight,
    'mempool/blocks/tip/height',
    { headers: { Accept: 'text/plain' } },
    { timeoutMs: MEMPOOL_TIMEOUT_MS, ...controls }
  );

  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
}

function getFundingTxs(
  txs: MempoolTx[],
  address: string,
  tipHeight: number
): MempoolAddressStats['fundingTxs'] {
  const fundingTxs = txs
    .filter((tx) => tx.status.confirmed && tx.status.block_height != null)
    .map((tx) => {
      const valueSats = tx.vout.reduce(
        (sum, output) => (output.scriptpubkey_address === address ? sum + output.value : sum),
        0
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

export async function fetchMempoolAddressStats(
  address: string,
  controls: RequestControls = {}
): Promise<MempoolAddressStats> {
  const result = await fetchJson(
    `${MEMPOOL_API_BASE_URL}/address/${encodeURIComponent(address)}`,
    parseMempoolAddressStats,
    'mempool/address',
    { headers: { Accept: 'application/json' } },
    { timeoutMs: MEMPOOL_TIMEOUT_MS, ...controls }
  );

  if (result.isErr()) {
    throw result.error;
  }
  const stats = result.value;

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

export function summarizeMempoolAddress(stats: MempoolAddressStats): MempoolAddressSummary {
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
