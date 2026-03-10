/**
 * Debug session logger — sends NDJSON to the debug ingest endpoint.
 * Only active in __DEV__. Remove this file when debug session ends.
 */
const DEBUG_ENDPOINT =
  'http://127.0.0.1:7698/ingest/ce075d2d-89ca-4ed1-9c00-ab62c19adc09';
const SESSION_ID = 'cbe07b';

export function debugLog(payload: {
  location: string;
  message: string;
  data?: Record<string, unknown>;
  hypothesisId?: string;
  runId?: string;
}): void {
  if (!__DEV__) return;
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
}

/** Build a compact mint context for routing-decision logs. See PAYMENT_FLOWS.md. */
export function buildMintContext(data: {
  trustedMintCount?: number;
  mintBalances?: Record<string, number>;
  allowedMints?: string[];
  minAmount?: number;
  validMintCount?: number;
  validMintBalances?: Record<string, number>;
}): Record<string, unknown> {
  const { mintBalances = {}, validMintBalances } = data;
  const balancesSummary =
    Object.keys(mintBalances).length > 0
      ? Object.fromEntries(
          Object.entries(mintBalances).map(([url, bal]) => [
            url.slice(-20),
            bal,
          ])
        )
      : undefined;
  const validBalancesSummary =
    validMintBalances && Object.keys(validMintBalances).length > 0
      ? Object.fromEntries(
          Object.entries(validMintBalances).map(([url, bal]) => [
            url.slice(-20),
            bal,
          ])
        )
      : undefined;
  return {
    trustedMintCount: data.trustedMintCount,
    allowedMintsCount: data.allowedMints?.length,
    minAmount: data.minAmount,
    validMintCount: data.validMintCount,
    balancesSummary,
    validMintBalancesSummary: validBalancesSummary,
  };
}
