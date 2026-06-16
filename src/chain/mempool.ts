import { z } from 'zod';

import type {
  ChainAdapter,
  ChainAddressStats,
  ChainAddressSummary,
  ChainFeeEstimate,
  ChainTransactionStatus,
} from '../adapters';
import { errField, logger } from '../logger';
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

function loggableIssues(error: z.ZodError): Array<{
  path: string;
  code: string;
}> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
  }));
}

function summarizeControls(controls: RequestControls): Record<string, unknown> {
  return {
    hasSignal: !!controls.signal,
    signalAborted: controls.signal?.aborted === true,
    timeoutMs: controls.timeoutMs ?? MEMPOOL_TIMEOUT_MS,
  };
}

function summarizeAddress(address: string): Record<string, unknown> {
  return { addressLength: address.length };
}

async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  where: string,
  controls: RequestControls = {},
  init: RequestInit = {},
): Promise<T> {
  const startedAt = Date.now();
  const method = init.method ?? 'GET';
  logger.debug('chain.mempool.fetchJson.start', {
    where,
    method,
    ...summarizeControls(controls),
  });
  let response: Response;
  try {
    response = await safeFetch(
      url,
      { timeoutMs: MEMPOOL_TIMEOUT_MS, ...controls },
      { headers: { Accept: 'application/json', ...init.headers }, ...init },
    );
  } catch (error) {
    logger.warn('chain.mempool.fetchJson.failed', {
      where,
      method,
      durationMs: Date.now() - startedAt,
      error: errField(error),
    });
    throw error;
  }
  logger.debug('chain.mempool.fetchJson.response', {
    where,
    method,
    status: response.status,
    ok: response.ok,
    durationMs: Date.now() - startedAt,
  });
  if (!response.ok) {
    logger.warn('chain.mempool.fetchJson.httpError', {
      where,
      method,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    throw new Error(`${where} failed with HTTP ${response.status}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    logger.warn('chain.mempool.fetchJson.invalidJson', {
      where,
      method,
      durationMs: Date.now() - startedAt,
      error: errField(error),
    });
    throw new Error(`${where} response was not valid JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    logger.warn('chain.mempool.fetchJson.invalidShape', {
      where,
      method,
      durationMs: Date.now() - startedAt,
      issues: loggableIssues(parsed.error),
    });
    throw new Error(`${where} response did not match expected schema`);
  }
  logger.debug('chain.mempool.fetchJson.done', {
    where,
    method,
    durationMs: Date.now() - startedAt,
  });
  return parsed.data;
}

async function fetchText(
  url: string,
  where: string,
  controls: RequestControls = {},
  init: RequestInit = {},
): Promise<string> {
  const startedAt = Date.now();
  const method = init.method ?? 'GET';
  logger.debug('chain.mempool.fetchText.start', {
    where,
    method,
    ...summarizeControls(controls),
  });
  let response: Response;
  try {
    response = await safeFetch(
      url,
      { timeoutMs: MEMPOOL_TIMEOUT_MS, ...controls },
      { headers: { Accept: 'text/plain', ...init.headers }, ...init },
    );
  } catch (error) {
    logger.warn('chain.mempool.fetchText.failed', {
      where,
      method,
      durationMs: Date.now() - startedAt,
      error: errField(error),
    });
    throw error;
  }
  logger.debug('chain.mempool.fetchText.response', {
    where,
    method,
    status: response.status,
    ok: response.ok,
    durationMs: Date.now() - startedAt,
  });
  if (!response.ok) {
    logger.warn('chain.mempool.fetchText.httpError', {
      where,
      method,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    throw new Error(`${where} failed with HTTP ${response.status}`);
  }
  const text = await response.text();
  logger.debug('chain.mempool.fetchText.done', {
    where,
    method,
    textLength: text.length,
    durationMs: Date.now() - startedAt,
  });
  return text;
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

async function fetchMempoolTipHeight(
  controls: RequestControls = {},
): Promise<number> {
  const text = await fetchText(
    `${MEMPOOL_API_BASE_URL}/blocks/tip/height`,
    'mempool/blocks/tip/height',
    controls,
  );
  const parsed = MempoolTipHeightSchema.safeParse(Number(text));
  if (!parsed.success) {
    throw new Error(
      'mempool/blocks/tip/height response did not match expected schema',
    );
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
        (sum, output) =>
          output.scriptpubkey_address === address ? sum + output.value : sum,
        0,
      );
      if (valueSats <= 0 || tx.status.block_height == null) return null;
      return {
        txid: tx.txid,
        valueSats,
        confirmations: Math.max(1, tipHeight - tx.status.block_height + 1),
      };
    })
    .filter(
      (tx): tx is NonNullable<MempoolAddressStats['fundingTxs']>[number] =>
        tx !== null,
    );

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
  logger.info('chain.mempool.addressStats.start', {
    ...summarizeAddress(address),
    ...summarizeControls(controls),
  });
  const stats = await fetchJson(
    `${MEMPOOL_API_BASE_URL}/address/${encodeURIComponent(address)}`,
    MempoolAddressStatsSchema,
    'mempool/address',
    controls,
  );
  logger.info('chain.mempool.addressStats.base', {
    ...summarizeAddress(address),
    confirmedTxCount: stats.chain_stats.tx_count,
    mempoolTxCount: stats.mempool_stats.tx_count,
    confirmedReceivedSats: stats.chain_stats.funded_txo_sum,
    mempoolReceivedSats: stats.mempool_stats.funded_txo_sum,
  });

  if (stats.chain_stats.tx_count === 0) {
    logger.info('chain.mempool.addressStats.done', {
      ...summarizeAddress(address),
      enriched: false,
      reason: 'no_confirmed_txs',
    });
    return stats;
  }

  try {
    const [txs, tipHeight] = await Promise.all([
      fetchMempoolAddressTxs(address, controls),
      fetchMempoolTipHeight(controls),
    ]);
    const fundingTxs = getFundingTxs(txs, stats.address, tipHeight);
    logger.info('chain.mempool.addressStats.enriched', {
      ...summarizeAddress(address),
      txCount: txs.length,
      tipHeight,
      fundingTxCount: fundingTxs?.length ?? 0,
      minConfirmations:
        fundingTxs && fundingTxs.length > 0
          ? Math.min(...fundingTxs.map((tx) => tx.confirmations))
          : null,
    });
    return {
      ...stats,
      fundingTxs,
    };
  } catch (error) {
    logger.warn('chain.mempool.addressStats.enrichmentFailed', {
      ...summarizeAddress(address),
      error: errField(error),
    });
    return stats;
  }
}

export function summarizeMempoolAddress(
  stats: ChainAddressStats,
): ChainAddressSummary {
  const confirmedReceivedSats = stats.chain_stats.funded_txo_sum;
  const confirmedBalanceSats =
    stats.chain_stats.funded_txo_sum - stats.chain_stats.spent_txo_sum;
  const unconfirmedNetSats =
    stats.mempool_stats.funded_txo_sum - stats.mempool_stats.spent_txo_sum;
  const fundingConfirmations =
    stats.fundingTxs?.map((tx) => tx.confirmations) ?? [];

  return {
    address: stats.address,
    confirmedTxCount: stats.chain_stats.tx_count,
    confirmedReceivedSats,
    confirmedBalanceSats: Math.max(0, confirmedBalanceSats),
    confirmedFundingConfirmations:
      fundingConfirmations.length > 0
        ? Math.min(...fundingConfirmations)
        : null,
    unconfirmedTxCount: stats.mempool_stats.tx_count,
    unconfirmedReceivedSats: stats.mempool_stats.funded_txo_sum,
    unconfirmedNetSats: Math.max(0, unconfirmedNetSats),
    totalReceivedSats:
      confirmedReceivedSats + stats.mempool_stats.funded_txo_sum,
    explorerUrl: `https://mempool.space/address/${encodeURIComponent(stats.address)}`,
  };
}

export interface MempoolSpaceChainAdapterOptions {
  network?: ChainAdapter['network'];
}

export function createMempoolSpaceChainAdapter(
  options: MempoolSpaceChainAdapterOptions = {},
): ChainAdapter {
  const network = options.network ?? 'mainnet';
  logger.info('chain.mempool.adapter.create', { network });
  return {
    network,
    estimateFees: async (): Promise<ChainFeeEstimate> => {
      logger.info('chain.mempool.estimateFees.start', { network });
      const fees = await fetchJson(
        `${MEMPOOL_API_BASE_URL}/v1/fees/recommended`,
        MempoolFeeEstimateSchema,
        'mempool/fees',
      );
      logger.info('chain.mempool.estimateFees.done', {
        network,
        fastestFee: fees.fastestFee,
        minimumFee: fees.minimumFee,
      });
      return fees;
    },
    getAddressTransactions: async (
      address,
    ): Promise<ChainTransactionStatus[]> => {
      logger.info('chain.mempool.addressTransactions.start', {
        network,
        ...summarizeAddress(address),
      });
      const [txs, tipHeight] = await Promise.all([
        fetchMempoolAddressTxs(address),
        fetchMempoolTipHeight().catch(() => null),
      ]);
      const transactions = txs.map((tx) =>
        toChainTransactionStatus(tx, tipHeight),
      );
      logger.info('chain.mempool.addressTransactions.done', {
        network,
        ...summarizeAddress(address),
        txCount: transactions.length,
        tipHeightKnown: tipHeight != null,
        confirmedCount: transactions.filter((tx) => tx.confirmed).length,
      });
      return transactions;
    },
    getAddressStats: (address): Promise<ChainAddressStats> =>
      fetchMempoolAddressStats(address),
    getAddressSummary: async (address): Promise<ChainAddressSummary> =>
      summarizeMempoolAddress(await fetchMempoolAddressStats(address)),
    getTransactionStatus: async (
      txid,
    ): Promise<ChainTransactionStatus | null> => {
      logger.info('chain.mempool.txStatus.start', {
        network,
        txidLength: txid.length,
      });
      const status = await fetchJson(
        `${MEMPOOL_API_BASE_URL}/tx/${encodeURIComponent(txid)}/status`,
        MempoolTxStatusSchema,
        'mempool/tx/status',
      );
      const tipHeight = status.confirmed
        ? await fetchMempoolTipHeight().catch(() => null)
        : null;
      const blockHeight = status.block_height;
      const confirmations =
        status.confirmed && blockHeight != null && tipHeight != null
          ? Math.max(1, tipHeight - blockHeight + 1)
          : 0;
      const result = {
        txid,
        confirmed: status.confirmed,
        ...(blockHeight != null ? { blockHeight } : {}),
        ...(status.block_hash ? { blockHash: status.block_hash } : {}),
        confirmations,
      };
      logger.info('chain.mempool.txStatus.done', {
        network,
        txidLength: txid.length,
        confirmed: result.confirmed,
        confirmations: result.confirmations,
        blockHeightKnown: blockHeight != null,
      });
      return result;
    },
    broadcastTransaction: async (rawTxHex): Promise<{ txid: string }> => {
      logger.info('chain.mempool.broadcast.start', {
        network,
        rawTxHexLength: rawTxHex.length,
      });
      const txid = await fetchText(
        `${MEMPOOL_API_BASE_URL}/tx`,
        'mempool/tx',
        {},
        {
          method: 'POST',
          body: rawTxHex,
          headers: { 'Content-Type': 'text/plain' },
        },
      );
      const trimmed = txid.trim();
      logger.info('chain.mempool.broadcast.done', {
        network,
        txidLength: trimmed.length,
      });
      return { txid: trimmed };
    },
  };
}

export const defaultChainAdapter = createMempoolSpaceChainAdapter();
