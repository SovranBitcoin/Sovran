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

/** Coco's wrappers for a mint that could not be read while refreshing it. */
const MINT_UNREACHABLE_ERROR_NAMES = new Set([
  "MintFetchError",
  "KeysetSyncError",
]);
/** Enough for coco's wrapper around cashu-ts's around fetch's. */
const MAX_CAUSE_DEPTH = 4;

function isMintUnreachableCause(err: unknown): boolean {
  return (
    err instanceof NetworkError ||
    (err instanceof HttpResponseError && err.status >= 500) ||
    (err instanceof Error && MINT_UNREACHABLE_ERROR_NAMES.has(err.name))
  );
}

/**
 * Returns true when the error indicates the mint could not be reached —
 * either a raw network failure, a server error (5xx), or coco's
 * MintFetchError / KeysetSyncError from refreshing mint info or keysets —
 * directly or as the `cause` of the error that was thrown.
 */
export function isMintOfflineError(err: unknown): boolean {
  let current: unknown = err;
  let result = false;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current != null; depth += 1) {
    if (isMintUnreachableCause(current)) {
      result = true;
      break;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  logger.debug("errors.mintOffline.classify", {
    ...summarizeError(err),
    result,
  });
  return result;
}

/**
 * An error whose message this package wrote for the person using the app.
 * Everything else that can be thrown here (a mint's reply, a library's
 * exception) carries someone else's wording: the app shows its own copy for
 * that instead of the text.
 */
export class AuthoredError extends Error {
  readonly authored = true;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AuthoredError";
  }
}

export interface FailureText {
  message: string;
  /** True when `message` was written by this package and can be shown as is. */
  authored: boolean;
}

/** The message a failure is reported with, and whether this package wrote it. */
export function failureText(cause: unknown, fallback: string): FailureText {
  if (!(cause instanceof Error)) return { message: fallback, authored: true };
  return {
    message: cause.message,
    authored: (cause as { authored?: unknown }).authored === true,
  };
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
