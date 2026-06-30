// ---------------------------------------------------------------------------
// Mesh transport — mint-url helpers
// ---------------------------------------------------------------------------

import { logger } from "../logger";

/** Trailing-slash + case differences must not break mint-allowlist matching. */
export function normalizeMintUrl(url: string): string {
  const normalized = url.trim().replace(/\/+$/, "").toLowerCase();
  logger.debug("transport.normalizeMintUrl", {
    inputLength: url.length,
    normalizedLength: normalized.length,
  });
  return normalized;
}
