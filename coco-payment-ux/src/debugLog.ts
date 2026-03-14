/**
 * Debug session logging for coco-payment-ux flows.
 * Sends events to the debug ingest server. Never throws.
 */

import type { FlowContext } from './machine/types';
import type { WalletContext } from './types';

const DEBUG_ENDPOINT =
  'https://nonfarm-madie-unenhanced.ngrok-free.dev/ingest/ce075d2d-89ca-4ed1-9c00-ab62c19adc09';
const SESSION_ID = '3a3711';

export interface DebugLogPayload {
  location: string;
  message: string;
  data?: Record<string, unknown>;
  phase?: 'before' | 'after' | 'entry' | 'exit';
}

/** Serialize FlowContext for logging — compact, agent-readable. */
export function serializeFlowContext(ctx: FlowContext | null | undefined): Record<string, unknown> {
  if (!ctx) return { _: 'null' };
  return {
    unit: ctx.unit,
    mintUrl: ctx.mintUrl ?? null,
    amount: ctx.amount ?? null,
    destination: ctx.destination ?? null,
    intentType: ctx.intent?.type ?? null,
    hasParsed: !!ctx.parsed,
    paymentRequest: ctx.paymentRequest ? `${ctx.paymentRequest.slice(0, 30)}...` : null,
    meltTarget: ctx.meltTarget ? `${ctx.meltTarget.slice(0, 30)}...` : null,
    supportedMintUrls: ctx.supportedMintUrls
      ? { count: ctx.supportedMintUrls.length, urls: ctx.supportedMintUrls }
      : null,
  };
}

/** Serialize WalletContext for logging — compact, agent-readable. */
export function serializeWalletContext(
  ctx: WalletContext | null | undefined
): Record<string, unknown> {
  if (!ctx) return { _: 'null' };
  const balances: Record<string, number> = {};
  for (const [url, bal] of Object.entries(ctx.mintBalances)) {
    if (bal > 0) balances[url] = bal;
  }
  const proofCounts: Record<string, number> = {};
  for (const [url, arr] of Object.entries(ctx.proofAmounts)) {
    if (arr.length > 0) proofCounts[url] = arr.length;
  }
  return {
    preferredMintUrl: ctx.preferredMintUrl ?? null,
    trustedMintCount: ctx.trustedMintUrls.length,
    trustedMintUrls: ctx.trustedMintUrls,
    mintBalances: balances,
    proofCountsByMint: proofCounts,
  };
}

export function debugLog(payload: DebugLogPayload): void {
  try {
    fetch(DEBUG_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': SESSION_ID,
      },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        ...payload,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  } catch {
    // Never throw
  }
}
