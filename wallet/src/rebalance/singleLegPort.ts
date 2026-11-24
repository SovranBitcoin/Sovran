// ---------------------------------------------------------------------------
// Single-leg transfer seam (ADR 0037)
//
// One transfer from a source mint to a destination mint, shaped like upstream
// Coco v3's `manager.ops.mintSwap`: a caller-chosen id, the two mints, the
// destination amount and an optional cap on what the source may be debited.
// The answer carries that id only. The mint quote and melt that make up a
// transfer under Coco 2.0.0 stay inside the implementation, so no caller comes
// to depend on how a transfer is built; adopting Coco v3 replaces
// `createEngineSingleLegTransferPort` with a call to `manager.ops.mintSwap`.
//
// The Coco 2.0.0 implementation runs the rebalance engine's own one-leg
// path (`executeTransfer` with `directOnly`), so every rule it keeps holds
// here too: fee headroom and the probed fee reserve, bounded re-preparation
// of a melt that has not paid, a melt that was sent never being sent again,
// and its mint left alone while its outcome is unknown. Multi-hop routing
// stays in the engine, as a sequence of single legs.
//
// Differences from Coco v3 that callers must allow for, until it is adopted:
// - the destination amount is the most delivered, not an exact amount: the
//   engine lowers it to fit the source balance and fees, and the completed
//   outcome reports what was delivered;
// - legs are remembered in memory, for the life of the port. A restart
//   forgets them; Coco 2.0.0's own recovery settles the operations.
// ---------------------------------------------------------------------------

import { meltDidNotPay } from '../melt-outcome';
import { amountToNumber } from '../amount';
import { isCleanReceiptFinalization, type RebalanceEngine } from './engine';
import { classifyRebalanceError } from './errors';
import type {
  RebalanceEventSink,
  RebalanceMintReceipt,
  RebalanceRunActivity,
  RebalanceTransferOutcome,
  RebalanceWalletPort,
} from './types';

export interface SingleLegTransferInput {
  /** Stable caller id. Reusing it with a changed intent is an error. */
  id: string;
  sourceMintUrl: string;
  destinationMintUrl: string;
  /** Whole sats to deliver to the destination. */
  destinationAmount: number;
  /**
   * Most the source may be debited, in sats, fees included. At least
   * `destinationAmount`. Exceeding it fails the leg before anything is paid.
   */
  sourceDebitCap?: number;
  /** Coco v3 mint swaps are BOLT11 and sat only. */
  unit: string;
}

type SingleLegFailureReason =
  | 'invalid_input'
  | 'source_debit_cap_exceeded'
  | 'no_route'
  | 'other';

export type SingleLegOutcome =
  /** The destination issued; `destinationAmount` is what it issued. */
  | { status: 'completed'; id: string; destinationAmount: number }
  /**
   * The source payment was sent and its outcome is unknown. Never sent again:
   * `refreshLeg` reads it back, and its mint is not drawn from meanwhile.
   */
  | { status: 'pending'; id: string }
  /** The source paid; the destination has not issued yet. */
  | { status: 'settling'; id: string }
  /** Nothing to move: the source balance is below the transfer minimum. */
  | { status: 'skipped'; id: string }
  /** Nothing was paid. */
  | { status: 'failed'; id: string; reason: SingleLegFailureReason; error: unknown }
  /** The run was stopped before the leg finished; see `pending` for a sent leg. */
  | { status: 'cancelled'; id: string }
  /**
   * Nothing was started: another transfer held the execution lock, or an
   * earlier leg from the same source mint is still pending.
   */
  | { status: 'busy'; id: string };

export interface SingleLegTransferPort {
  /**
   * Run one leg to an outcome. Calling again with the same id and intent
   * never starts a second payment: it joins the leg in progress, returns a
   * settled outcome, or reads back a pending one.
   */
  executeLeg(
    input: SingleLegTransferInput,
    activity?: RebalanceRunActivity
  ): Promise<SingleLegOutcome>;
  /**
   * Read a leg's outcome back from the wallet without paying anything; null
   * for an id this port has not run.
   */
  refreshLeg(id: string): Promise<SingleLegOutcome | null>;
}

/** Reusing a leg id for a different transfer. */
export class SingleLegIntentMismatchError extends Error {
  constructor(readonly legId: string) {
    super(`Leg ${legId} was already used for a different transfer`);
    this.name = 'SingleLegIntentMismatchError';
  }
}

interface LegRecord {
  intent: string;
  running?: Promise<SingleLegOutcome>;
  outcome?: SingleLegOutcome;
  /** Child operations: kept here, never returned. */
  meltOperationId?: string;
  receipt?: RebalanceMintReceipt;
}

const SETTLED: ReadonlySet<SingleLegOutcome['status']> = new Set([
  'completed',
  'failed',
  'skipped',
]);

function intentKey(input: SingleLegTransferInput): string {
  return JSON.stringify([
    input.sourceMintUrl,
    input.destinationMintUrl,
    input.destinationAmount,
    input.sourceDebitCap ?? null,
    input.unit,
  ]);
}

function invalid(input: SingleLegTransferInput, unit: string): string | null {
  if (!input.id) return 'id is required';
  if (input.unit !== unit) return `unit must be ${unit}`;
  if (input.sourceMintUrl === input.destinationMintUrl) return 'mints must differ';
  if (!Number.isSafeInteger(input.destinationAmount) || input.destinationAmount <= 0) {
    return 'destinationAmount must be a positive whole number of sats';
  }
  if (
    input.sourceDebitCap !== undefined &&
    (!Number.isSafeInteger(input.sourceDebitCap) || input.sourceDebitCap < input.destinationAmount)
  ) {
    return 'sourceDebitCap must be a whole number of sats, at least destinationAmount';
  }
  return null;
}

function failureReason(error: unknown): SingleLegFailureReason {
  if (error instanceof Error && error.name === 'RebalanceSourceDebitCapError') {
    return 'source_debit_cap_exceeded';
  }
  return classifyRebalanceError(error) === 'no_route' ? 'no_route' : 'other';
}

/** A sink that keeps the child operations and reports nothing outward. */
function recordingSink(record: LegRecord): RebalanceEventSink {
  return {
    legOpened: () => {},
    legUpdated: () => {},
    mintReceiptCreated: (_legId, receipt) => {
      record.receipt = receipt;
    },
    meltPrepared: (_legId, melt) => {
      record.meltOperationId = melt.id;
    },
    // A direct-only leg never reaches the middleman router.
    routeAttemptStarted: () => ({ chainId: '', hopLegIds: [] }),
  };
}

function toLegOutcome(
  id: string,
  outcome: RebalanceTransferOutcome,
  record: LegRecord,
  classify: (error: unknown) => SingleLegFailureReason
): SingleLegOutcome {
  switch (outcome.status) {
    case 'done':
      return {
        status: 'completed',
        id,
        destinationAmount: amountToNumber(record.receipt?.amount),
      };
    case 'pending':
      record.meltOperationId = outcome.operationId;
      return { status: 'pending', id };
    case 'settling':
      return { status: 'settling', id };
    case 'skipped':
      return { status: 'skipped', id };
    case 'failed':
      return { status: 'failed', id, reason: classify(outcome.error), error: outcome.error };
    case 'aborted':
      // Stopped after its melt was prepared: it may have been sent, so it is
      // read back like a pending leg and never run again.
      return record.meltOperationId ? { status: 'pending', id } : { status: 'cancelled', id };
    case 'busy':
      return { status: 'busy', id };
  }
}

/**
 * The Coco 2.0.0 single-leg port: the rebalance engine's one-leg path, with
 * `wallet` for reading legs back.
 */
export function createEngineSingleLegTransferPort(options: {
  engine: Pick<RebalanceEngine, 'executeTransfer'>;
  wallet: Pick<RebalanceWalletPort, 'refreshMelt' | 'getMintOperation'>;
  unit: string;
  /** Map an engine failure to a reason. */
  classifyFailure?: (error: unknown) => SingleLegFailureReason;
}): SingleLegTransferPort {
  const { engine, wallet, unit } = options;
  const classify = options.classifyFailure ?? failureReason;
  const legs = new Map<string, LegRecord & { sourceMintUrl: string }>();

  /**
   * A leg still pending from this mint, after reading it back. While one is,
   * the mint is not drawn from: its proofs may be on their way out.
   */
  async function pendingFrom(sourceMintUrl: string, exceptId: string): Promise<boolean> {
    for (const [id, other] of legs) {
      if (id === exceptId || other.sourceMintUrl !== sourceMintUrl) continue;
      if (other.outcome?.status !== 'pending') continue;
      if ((await readBack(id, other)).status === 'pending') return true;
    }
    return false;
  }

  async function readBack(
    id: string,
    record: LegRecord & { sourceMintUrl: string }
  ): Promise<SingleLegOutcome> {
    const current = record.outcome;
    if (!current || SETTLED.has(current.status)) return current ?? { status: 'cancelled', id };
    if (current.status === 'pending' && record.meltOperationId) {
      let state: string | undefined;
      try {
        state = (await wallet.refreshMelt(record.meltOperationId)).state;
      } catch {
        // Unreadable: still unknown, still pending.
        return current;
      }
      // The engine's one execute has returned, so a melt never sent or
      // settled unpaid proves nothing was paid.
      if (state !== undefined && meltDidNotPay(state)) {
        record.outcome = {
          status: 'failed',
          id,
          reason: 'other',
          error: new Error(`Melt settled ${state}; nothing was paid`),
        };
        return record.outcome;
      }
      if (state !== 'finalized') return current;
      record.outcome = { status: 'settling', id };
    }
    if (record.outcome?.status === 'settling' && record.receipt) {
      try {
        const operation = await wallet.getMintOperation(record.receipt.id);
        if (isCleanReceiptFinalization(operation, record.receipt)) {
          record.outcome = {
            status: 'completed',
            id,
            destinationAmount: amountToNumber(record.receipt.amount),
          };
        }
      } catch {
        // Read again later.
      }
    }
    return record.outcome ?? current;
  }

  async function run(
    input: SingleLegTransferInput,
    record: LegRecord,
    activity: RebalanceRunActivity
  ): Promise<SingleLegOutcome> {
    // A fresh attempt: child operations of an earlier, unsent attempt do not
    // belong to it.
    record.meltOperationId = undefined;
    record.receipt = undefined;
    const outcome = await engine.executeTransfer(
      {
        id: input.id,
        fromMintUrl: input.sourceMintUrl,
        toMintUrl: input.destinationMintUrl,
        amount: input.destinationAmount,
        directOnly: true,
        ...(input.sourceDebitCap === undefined ? {} : { sourceDebitCap: input.sourceDebitCap }),
      },
      { ...activity, sink: recordingSink(record) }
    );
    return toLegOutcome(input.id, outcome, record, classify);
  }

  return {
    async executeLeg(input, activity = { isActive: () => true }) {
      const problem = invalid(input, unit);
      if (problem) {
        return { status: 'failed', id: input.id, reason: 'invalid_input', error: new TypeError(problem) };
      }
      const intent = intentKey(input);
      let record = legs.get(input.id);
      if (record && record.intent !== intent) throw new SingleLegIntentMismatchError(input.id);
      if (record?.running) return record.running;
      if (record?.outcome) {
        const { status } = record.outcome;
        // A sent leg is read back, never sent again.
        if (status === 'pending' || status === 'settling') return readBack(input.id, record);
        if (SETTLED.has(status)) return record.outcome;
        // Cancelled or busy before anything was sent: run it again.
      }
      record = record ?? { intent, sourceMintUrl: input.sourceMintUrl };
      // Registered before the first await, so a second call joins this one.
      legs.set(input.id, record);
      const leg = record;
      const attempt = async (): Promise<SingleLegOutcome> =>
        (await pendingFrom(input.sourceMintUrl, input.id))
          ? { status: 'busy', id: input.id }
          : run(input, leg, activity);
      leg.running = attempt().then(
        (outcome) => {
          leg.outcome = outcome;
          leg.running = undefined;
          return outcome;
        },
        (error: unknown) => {
          leg.running = undefined;
          throw error;
        }
      );
      return leg.running;
    },

    async refreshLeg(id) {
      const record = legs.get(id);
      if (!record) return null;
      if (record.running) return record.running;
      return readBack(id, record);
    },
  };
}
