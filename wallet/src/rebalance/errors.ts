// ---------------------------------------------------------------------------
// Rebalance error classification
//
// The rebalance engine decides re-preparation, reconciliation and middleman
// routing from `classifyRebalanceError` alone. Typed data (coco error classes,
// NUT error codes) is checked first; message patterns are the fallback only
// where coco and the mints expose no code for the condition.
// ---------------------------------------------------------------------------

import {
  MintOperationError,
  OperationInProgressError,
  ProofValidationError,
} from '@cashu/coco-core';

export type RebalanceErrorKind =
  /** Local proof selection could not cover amount + fees. Nothing was sent to the mint. */
  | 'insufficient_proofs'
  /** The mint rejected the melt inputs as too small for amount + fee reserve. Nothing was spent. */
  | 'input_shortfall'
  /** The melt (or its proofs/quote) is already being processed; its outcome is unknown. */
  | 'operation_in_progress'
  /** The Lightning backend found no route; the payment did not leave the mint. */
  | 'no_route'
  | 'other';

/** NUT-00 codes whose meaning is unambiguous for a melt. */
const NUT_PROOFS_PENDING = 11002;
const NUT_TRANSACTION_UNBALANCED = 11005;
const NUT_QUOTE_PENDING = 20005;

// Message fallbacks. Each exists because the condition has no code of its own:
// - coco raises every proof-validation failure as ProofValidationError, so only
//   the text separates "not enough proofs" from, say, a missing mint URL;
// - older mints report the melt input shortfall as a generic TransactionError
//   (no NUT code) with this detail text;
// - mints surface Lightning routing failures under generic codes (20004 or
//   none), and the backend's reason appears only in the detail text;
// - legacy coco builds threw a plain Error for an in-progress melt.
const INSUFFICIENT_PROOFS_TEXT = /not enough proofs/i;
const INPUT_SHORTFALL_TEXT = /not enough inputs|inputs provided for melt/i;
const NO_ROUTE_TEXT = /no_route|failure_reason_no_route|ran out of routes/i;
const IN_PROGRESS_TEXT = /operation already in progress/i;

function mintErrorCode(err: unknown): number | undefined {
  if (err instanceof MintOperationError) return err.code;
  // A second copy of cashu-ts (another realm) fails `instanceof`; its name and code survive.
  if (err instanceof Error && err.name === 'MintOperationError') {
    const { code } = err as Error & { code?: unknown };
    return typeof code === 'number' ? code : undefined;
  }
  return undefined;
}

export function classifyRebalanceError(err: unknown): RebalanceErrorKind {
  if (err instanceof OperationInProgressError) return 'operation_in_progress';

  const code = mintErrorCode(err);
  if (code === NUT_QUOTE_PENDING || code === NUT_PROOFS_PENDING) return 'operation_in_progress';
  if (code === NUT_TRANSACTION_UNBALANCED) return 'input_shortfall';

  if (!(err instanceof Error)) return 'other';
  const { message } = err;
  if (err instanceof ProofValidationError && INSUFFICIENT_PROOFS_TEXT.test(message)) {
    return 'insufficient_proofs';
  }
  if (IN_PROGRESS_TEXT.test(message)) return 'operation_in_progress';
  if (INPUT_SHORTFALL_TEXT.test(message)) return 'input_shortfall';
  if (NO_ROUTE_TEXT.test(message)) return 'no_route';
  // Wrappers that lost the ProofValidationError class keep coco's text.
  if (INSUFFICIENT_PROOFS_TEXT.test(message)) return 'insufficient_proofs';
  return 'other';
}

/** The mint rolled a melt back: the payment definitively did not happen. */
export class RebalanceMeltRolledBackError extends Error {
  readonly operationId: string;
  constructor(operationId: string, message = 'Melt payment rolled back by mint') {
    super(message);
    this.name = 'RebalanceMeltRolledBackError';
    this.operationId = operationId;
  }
}

/** Every candidate middleman route failed; `cause` is the last route's error. */
export class RebalanceRoutesExhaustedError extends Error {
  readonly triedCount: number;
  constructor(triedCount: number, options: { cause: unknown }) {
    super(
      `All ${triedCount} middleman routes failed. Some funds may be on intermediary mints — check the debug panel.`
    );
    // Assigned rather than passed as ErrorOptions so the cause survives on
    // runtimes without the ES2022 Error constructor.
    this.cause = options.cause;
    this.name = 'RebalanceRoutesExhaustedError';
    this.triedCount = triedCount;
  }
}
