// ---------------------------------------------------------------------------
// mempool.space Transaction Accelerator — guest Lightning checkout
// ---------------------------------------------------------------------------
//
// mempool.space explicitly supports third-party integration without an
// account: estimate the cost, create a BTCPay invoice (returns a BOLT11
// directly), pay it over Lightning, then watch the public per-txid
// acceleration status. Endpoint chain mirrors the official web checkout
// (frontend services-api.service.ts / accelerate-checkout.component.ts).
//
// Total price (sats) = userBid + mempoolBaseFee + vsizeFee. The invoice
// endpoint takes only the bid (`maxBidBoost`); the service adds its own fees.

import { z } from "zod";

import { errField, logger } from "../logger";
import type { RequestControls } from "../safeFetch";
import { fetchJson, MempoolHttpError } from "./mempool";

const MEMPOOL_SERVICES_API_BASE_URL = "https://mempool.space/api/v1/services";
const MEMPOOL_V1_API_BASE_URL = "https://mempool.space/api/v1";

const AccelerationEstimateSchema = z
  .object({
    cost: z.number().int().nonnegative(),
    targetFeeRate: z.number().nonnegative(),
    mempoolBaseFee: z.number().int().nonnegative(),
    vsizeFee: z.number().int().nonnegative(),
    options: z
      .array(z.object({ fee: z.number().int().nonnegative() }).passthrough())
      .default([]),
    unavailable: z.boolean().optional(),
    availablePaymentMethods: z
      .object({
        bitcoin: z
          .object({
            enabled: z.boolean(),
            min: z.number().optional(),
            max: z.number().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type AccelerationEstimate = z.infer<typeof AccelerationEstimateSchema>;

const AccelerationInvoiceSchema = z
  .object({
    btcpayInvoiceId: z.string().min(1),
    addresses: z
      .object({ BTC_LightningLike: z.string().min(1).optional() })
      .passthrough(),
    expirationTime: z.number().int().positive().optional(),
  })
  .passthrough();

export interface AccelerationInvoice {
  invoiceId: string;
  /** BOLT11 payment request. */
  bolt11: string;
  /** Unix seconds; pay before this. */
  expiresAtSec: number | null;
}

const AccelerationStatusSchema = z
  .object({
    txid: z.string().min(1),
    status: z.string().min(1),
  })
  .passthrough();

export interface AccelerationStatus {
  txid: string;
  /** 'accelerating' while queued with pools; 'mined'/'completed' after. */
  status: string;
}

const ACKNOWLEDGED_ACCELERATION_STATUSES = new Set([
  "accelerating",
  "mined",
  "completed",
]);

/** Whether mempool.space explicitly reports an accepted/finished boost. */
export function isAcknowledgedAccelerationStatus(
  acceleration: AccelerationStatus | null,
): boolean {
  return acceleration != null &&
    ACKNOWLEDGED_ACCELERATION_STATUSES.has(acceleration.status.toLowerCase());
}

const DifficultyAdjustmentSchema = z
  .object({
    timeAvg: z.number().positive(),
    adjustedTimeAvg: z.number().positive().optional(),
  })
  .passthrough();

/**
 * Cost estimate for accelerating `txid`. Returns `null` when the tx is not
 * eligible — already confirmed, unknown, or the service reports itself
 * unavailable (HTTP 400 `cannot_accelerate_tx`, HTTP 204, `unavailable`).
 */
export async function fetchAccelerationEstimate(
  txid: string,
  controls: RequestControls = {},
): Promise<AccelerationEstimate | null> {
  try {
    const estimate = await fetchJson(
      `${MEMPOOL_SERVICES_API_BASE_URL}/accelerator/estimate`,
      AccelerationEstimateSchema,
      "mempool/accelerator/estimate",
      controls,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txInput: txid }),
      },
    );
    if (estimate.unavailable) return null;
    if (estimate.availablePaymentMethods?.bitcoin?.enabled === false) {
      return null;
    }
    return estimate;
  } catch (error) {
    // 400 = not eligible (confirmed/unknown tx); a 204 empty body fails JSON
    // parsing. Both mean "nothing to offer", not a caller error.
    if (error instanceof MempoolHttpError && error.status === 400) return null;
    if (error instanceof Error && /not valid JSON/.test(error.message)) {
      return null;
    }
    throw error;
  }
}

/** The bid the official UI preselects: the middle recommended option. */
export function defaultAccelerationBidSats(
  estimate: AccelerationEstimate,
): number {
  return estimate.options[1]?.fee ?? estimate.options[0]?.fee ?? estimate.cost;
}

/** What the user actually pays for a given bid. */
export function accelerationTotalSats(
  estimate: AccelerationEstimate,
  bidSats: number,
): number {
  return bidSats + estimate.mempoolBaseFee + estimate.vsizeFee;
}

/**
 * Create a guest acceleration invoice for `txid` with the given bid. The
 * service prices the invoice at `bid + mempoolBaseFee + vsizeFee` itself.
 * Returns `null` if no Lightning address came back.
 */
export async function createAccelerationInvoice(
  txid: string,
  maxBidBoostSats: number,
  controls: RequestControls = {},
): Promise<AccelerationInvoice | null> {
  const invoice = await fetchJson(
    `${MEMPOOL_SERVICES_API_BASE_URL}/accelerator/invoice`,
    AccelerationInvoiceSchema,
    "mempool/accelerator/invoice",
    controls,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txid, maxBidBoost: maxBidBoostSats }),
    },
  );
  const bolt11 = invoice.addresses.BTC_LightningLike;
  if (!bolt11) {
    logger.warn("chain.mempool.accelerator.invoice.noLightning", {
      invoiceIdLength: invoice.btcpayInvoiceId.length,
    });
    return null;
  }
  return {
    invoiceId: invoice.btcpayInvoiceId,
    bolt11,
    expiresAtSec: invoice.expirationTime ?? null,
  };
}

/**
 * Public per-txid acceleration status. `null` = this txid was never
 * accelerated (HTTP 404).
 */
export async function fetchAccelerationStatus(
  txid: string,
  controls: RequestControls = {},
): Promise<AccelerationStatus | null> {
  try {
    const status = await fetchJson(
      `${MEMPOOL_SERVICES_API_BASE_URL}/accelerator/accelerations/${encodeURIComponent(txid)}`,
      AccelerationStatusSchema,
      "mempool/accelerator/status",
      controls,
    );
    return { txid: status.txid, status: status.status };
  } catch (error) {
    if (error instanceof MempoolHttpError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Current average block interval in minutes (difficulty-adjustment feed) —
 * the accelerated tx targets the next block, so this ≈ the new confirmation
 * time. Falls back to 10 minutes when the feed is unreachable.
 */
export async function fetchAverageBlockTimeMinutes(
  controls: RequestControls = {},
): Promise<number> {
  try {
    const adjustment = await fetchJson(
      `${MEMPOOL_V1_API_BASE_URL}/difficulty-adjustment`,
      DifficultyAdjustmentSchema,
      "mempool/difficulty-adjustment",
      controls,
    );
    const avgMs = adjustment.adjustedTimeAvg ?? adjustment.timeAvg;
    return Math.max(1, Math.round(avgMs / 60_000));
  } catch (error) {
    logger.warn("chain.mempool.accelerator.blockTimeFallback", {
      error: errField(error),
    });
    return 10;
  }
}
