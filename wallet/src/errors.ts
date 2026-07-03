import { NetworkError, HttpResponseError } from "@cashu/coco-core";

import { logger } from "./logger";

function summarizeError(err: unknown): Record<string, unknown> {
  if (err instanceof HttpResponseError) {
    return {
      errorKind: "http-response",
      status: err.status,
      name: err.name,
      messageLength: err.message.length,
    };
  }
  if (err instanceof Error) {
    return {
      errorKind: err instanceof NetworkError ? "network" : "error",
      name: err.name,
      messageLength: err.message.length,
    };
  }
  return {
    errorKind: err == null ? "nullish" : typeof err,
  };
}

/**
 * Returns true when the error indicates the mint could not be reached —
 * either a raw network failure, a server error (5xx), or a MintFetchError
 * (coco-core wraps network failures when refreshing mint info/keysets).
 */
export function isMintOfflineError(err: unknown): boolean {
  const result =
    err instanceof NetworkError ||
    (err instanceof HttpResponseError && err.status >= 500) ||
    (err instanceof Error && err.name === "MintFetchError");
  logger.debug("errors.mintOffline.classify", {
    ...summarizeError(err),
    result,
  });
  return result;
}

/**
 * The user deliberately backed out of a melt mid-flow (e.g. dismissed the
 * onchain NUT-30 fee sheet before any proofs were reserved). Failure routing
 * treats this as a quiet cancel — no failure toast, no error step.
 */
export class MeltUserCancelledError extends Error {
  constructor(message = "Melt cancelled by user") {
    super(message);
    this.name = "MeltUserCancelledError";
  }
}

export function isMeltUserCancelledError(err: unknown): boolean {
  return (
    err instanceof MeltUserCancelledError ||
    (err instanceof Error && err.name === "MeltUserCancelledError")
  );
}

/**
 * A melt from a fiat-unit balance needed a sat-denominated payment amount
 * (LNURL invoice request, onchain amountSats) but no exchange rate was
 * available to convert the unit's minor amount to sats.
 */
export class UnitRateUnavailableError extends Error {
  readonly unit: string;
  constructor(unit: string) {
    super(`No exchange rate available to convert ${unit} to sats`);
    this.name = "UnitRateUnavailableError";
    this.unit = unit;
  }
}

export function isUnitRateUnavailableError(err: unknown): boolean {
  return (
    err instanceof UnitRateUnavailableError ||
    (err instanceof Error && err.name === "UnitRateUnavailableError")
  );
}
