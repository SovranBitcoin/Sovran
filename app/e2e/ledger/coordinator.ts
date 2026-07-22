/**
 * The sole orchestration interface for test-harness value-moving effects.
 *
 * This module defines only a typed seam. It intentionally ships no live
 * adapter and is not wired to CLI/device commands. A caller must supply an
 * already-approved custody readiness check and an effects adapter; the
 * coordinator then persists every liability transition around those effects.
 */
import type { CustodyHandle } from './custody';
import type { DurableLease } from './durable';
import { RunLedger, type AssetLocation, type FundingLiability, type LegStatus } from './ledger';

export type FundingLegState = 'intent' | 'funded' | 'swept' | 'quarantined' | 'reconciled';

declare const fundingLegBrand: unique symbol;
export interface FundingLeg<State extends FundingLegState> extends FundingLiability {
  readonly runId: string;
  readonly state: State;
  readonly [fundingLegBrand]: true;
}

export interface CustodyReadinessRequest {
  runId: string;
  legId: string;
  custody: CustodyHandle;
  asset: AssetLocation;
}

/** Abstract proof seam; this module does not create or export recovery material. */
export interface CustodyReadiness {
  assertReady(request: CustodyReadinessRequest): void;
}

export interface FundingEffectRequest extends CustodyReadinessRequest {
  counterparty: string;
  expectedAmount: number;
}

export interface FundingEffectResult {
  amount: number;
  fees: number;
  txId?: string;
}

export interface OutflowEffectRequest extends CustodyReadinessRequest {
  counterparty: string;
  amount: number;
}

export interface OutflowEffectResult {
  amount: number;
  fees: number;
  txId?: string;
}

export type SweepEffectRequest = CustodyReadinessRequest;

export interface SweepEffectResult {
  ok: boolean;
  recoveredAmount: number;
  residualAmount: number;
  fees: number;
  txId?: string;
}

/**
 * Adapter seam for effects that may move value. Implementations must be passed
 * only to FundingCoordinator; calling one directly bypasses the durable
 * liability contract. No live implementation exists in this slice.
 */
export interface FundingEffects {
  fund(request: FundingEffectRequest): Promise<FundingEffectResult>;
  outflow(request: OutflowEffectRequest): Promise<OutflowEffectResult>;
  sweep(request: SweepEffectRequest): Promise<SweepEffectResult>;
}

export type QuarantineReason =
  | 'funding-effect-uncertain'
  | 'funding-result-invalid'
  | 'outflow-effect-uncertain'
  | 'outflow-result-invalid'
  | 'sweep-effect-uncertain'
  | 'sweep-failed'
  | 'sweep-result-invalid'
  | 'startup-resume-required'
  | 'operator-halt';

export interface PrepareFundingInput {
  legId: string;
  custody: CustodyHandle;
  counterparty: string;
  asset: AssetLocation;
  expectedAmount: number;
}

export interface OutflowInput {
  counterparty: string;
  amount: number;
}

export class FundingCoordinator {
  readonly #ledger: RunLedger;
  readonly #effects: FundingEffects;
  readonly #readiness: CustodyReadiness;
  readonly #issued = new WeakSet<object>();
  readonly #busy = new Set<string>();

  constructor(ledger: RunLedger, effects: FundingEffects, readiness: CustodyReadiness) {
    this.#ledger = ledger;
    this.#effects = effects;
    this.#readiness = readiness;
  }

  #issue<State extends FundingLegState>(
    liability: FundingLiability,
    state: State
  ): FundingLeg<State> {
    const leg = Object.freeze({
      ...liability,
      runId: this.#ledger.runId,
      state,
    }) as FundingLeg<State>;
    this.#issued.add(leg);
    return leg;
  }

  #assertIssued<State extends FundingLegState>(leg: FundingLeg<State>, expected: State): void {
    if (!this.#issued.has(leg) || leg.runId !== this.#ledger.runId || leg.state !== expected) {
      throw new Error(`invalid ${expected} funding leg capability`);
    }
    if (this.#ledger.status().get(leg.legId) !== expected) {
      throw new Error(`funding leg "${leg.legId}" is not durably ${expected}`);
    }
  }

  #assertCapability<State extends FundingLegState>(leg: FundingLeg<State>, expected: State): void {
    if (!this.#issued.has(leg) || leg.runId !== this.#ledger.runId || leg.state !== expected) {
      throw new Error(`invalid ${expected} funding leg capability`);
    }
  }

  #consumeCapability<State extends FundingLegState>(leg: FundingLeg<State>, expected: State): void {
    this.#assertCapability(leg, expected);
    this.#issued.delete(leg);
  }

  #assertReady(leg: FundingLiability): void {
    this.#readiness.assertReady({
      runId: this.#ledger.runId,
      legId: leg.legId,
      custody: leg.custody,
      asset: leg.asset,
    });
  }

  #enterEffect(legId: string, expectedStatus: LegStatus): DurableLease {
    if (this.#busy.has(legId)) throw new Error(`value effect already in flight for "${legId}"`);
    this.#busy.add(legId);
    let lease: DurableLease | undefined;
    try {
      lease = this.#ledger.acquireEffectLease(legId);
      const current = this.#ledger.status().get(legId);
      if (current !== expectedStatus) {
        lease.release();
        lease = undefined;
        throw new Error(
          `funding leg "${legId}" changed from ${expectedStatus} to ${current ?? 'missing'} before effect`
        );
      }
      return lease;
    } catch (error) {
      this.#busy.delete(legId);
      throw error;
    }
  }

  #leaveEffect(legId: string, lease: DurableLease, releaseDurableLease: boolean): void {
    try {
      if (releaseDurableLease) lease.release();
    } finally {
      this.#busy.delete(legId);
    }
  }

  #quarantine(legId: string, reason: QuarantineReason): void {
    if (this.#ledger.status().get(legId) !== 'quarantined') {
      this.#ledger.quarantine(legId, reason);
    }
  }

  prepareFunding(input: PrepareFundingInput): FundingLeg<'intent'> {
    this.#assertReady(input);
    this.#ledger.registerFunding(input);
    return this.#issue(this.#ledger.liability(input.legId), 'intent');
  }

  async fund(leg: FundingLeg<'intent'>): Promise<FundingLeg<'funded'>> {
    this.#assertIssued(leg, 'intent');
    this.#assertReady(leg);
    this.#issued.delete(leg);
    const lease = this.#enterEffect(leg.legId, 'intent');
    let releaseDurableLease = false;
    let result: FundingEffectResult;
    try {
      try {
        result = await this.#effects.fund({
          runId: this.#ledger.runId,
          legId: leg.legId,
          custody: leg.custody,
          counterparty: leg.counterparty,
          asset: leg.asset,
          expectedAmount: leg.expectedAmount,
        });
      } catch (cause) {
        this.#quarantine(leg.legId, 'funding-effect-uncertain');
        // Surface the underlying effect error — losing it costs the entire
        // diagnosis of an uncertain outcome (e.g. which relay refused a wrap).
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`funding effect outcome is uncertain for leg "${leg.legId}": ${detail}`, {
          cause,
        });
      }

      try {
        this.#ledger.markFunded(leg.legId, result);
        releaseDurableLease = true;
      } catch {
        this.#quarantine(leg.legId, 'funding-result-invalid');
        throw new Error(`funding result could not be durably recorded for leg "${leg.legId}"`);
      }
      return this.#issue(this.#ledger.liability(leg.legId), 'funded');
    } finally {
      this.#leaveEffect(leg.legId, lease, releaseDurableLease);
    }
  }

  async outflow(leg: FundingLeg<'funded'>, input: OutflowInput): Promise<FundingLeg<'funded'>> {
    if (
      !Number.isSafeInteger(input.amount) ||
      input.amount <= 0 ||
      input.counterparty.length === 0
    ) {
      throw new Error('invalid outflow request');
    }
    this.#assertIssued(leg, 'funded');
    this.#assertReady(leg);
    this.#issued.delete(leg);
    const lease = this.#enterEffect(leg.legId, 'funded');
    let releaseDurableLease = false;
    let result: OutflowEffectResult;
    try {
      try {
        result = await this.#effects.outflow({
          runId: this.#ledger.runId,
          legId: leg.legId,
          custody: leg.custody,
          asset: leg.asset,
          amount: input.amount,
          counterparty: input.counterparty,
        });
      } catch (cause) {
        this.#quarantine(leg.legId, 'outflow-effect-uncertain');
        // Surface the underlying effect error — losing it costs the entire
        // diagnosis of an uncertain outcome (e.g. which relay refused a wrap).
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`outflow effect outcome is uncertain for leg "${leg.legId}": ${detail}`, {
          cause,
        });
      }

      try {
        this.#ledger.recordOutflow(leg.legId, {
          amount: result.amount,
          fees: result.fees,
          counterparty: input.counterparty,
          txId: result.txId,
        });
        releaseDurableLease = true;
      } catch {
        this.#quarantine(leg.legId, 'outflow-result-invalid');
        throw new Error(`outflow result could not be durably recorded for leg "${leg.legId}"`);
      }
      if (result.amount !== input.amount) {
        this.#quarantine(leg.legId, 'outflow-result-invalid');
        throw new Error(`outflow amount mismatch quarantined leg "${leg.legId}"`);
      }
      return this.#issue(this.#ledger.liability(leg.legId), 'funded');
    } finally {
      this.#leaveEffect(leg.legId, lease, releaseDurableLease);
    }
  }

  async sweep(leg: FundingLeg<'funded'> | FundingLeg<'quarantined'>): Promise<FundingLeg<'swept'>> {
    if (leg.state === 'funded') this.#assertIssued(leg, 'funded');
    else this.#assertIssued(leg, 'quarantined');
    this.#assertReady(leg);
    this.#issued.delete(leg);
    const lease = this.#enterEffect(leg.legId, leg.state);
    let releaseDurableLease = false;
    let result: SweepEffectResult;
    try {
      try {
        result = await this.#effects.sweep({
          runId: this.#ledger.runId,
          legId: leg.legId,
          custody: leg.custody,
          asset: leg.asset,
        });
      } catch (cause) {
        this.#quarantine(leg.legId, 'sweep-effect-uncertain');
        // Surface the underlying effect error — losing it costs the entire
        // diagnosis of an uncertain outcome (e.g. which relay refused a wrap).
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`sweep effect outcome is uncertain for leg "${leg.legId}": ${detail}`, {
          cause,
        });
      }

      try {
        this.#ledger.recordSweep(leg.legId, { asset: leg.asset, ...result });
        releaseDurableLease = true;
      } catch {
        this.#quarantine(leg.legId, 'sweep-result-invalid');
        throw new Error(`sweep result could not be durably recorded for leg "${leg.legId}"`);
      }
      if (!result.ok || result.residualAmount !== 0) {
        this.#quarantine(leg.legId, 'sweep-failed');
        throw new Error(`sweep did not clear liability for leg "${leg.legId}"`);
      }
      return this.#issue(this.#ledger.liability(leg.legId), 'swept');
    } finally {
      this.#leaveEffect(leg.legId, lease, releaseDurableLease);
    }
  }

  reconcile(leg: FundingLeg<'swept'>): FundingLeg<'reconciled'> {
    this.#consumeCapability(leg, 'swept');
    try {
      this.#ledger.reconcile(leg.legId);
    } catch {
      this.#quarantine(leg.legId, 'sweep-result-invalid');
      throw new Error(`reconciliation failed and quarantined leg "${leg.legId}"`);
    }
    return this.#issue(this.#ledger.liability(leg.legId), 'reconciled');
  }

  quarantine<State extends 'intent' | 'funded' | 'swept'>(
    leg: FundingLeg<State>,
    reason: Extract<QuarantineReason, 'operator-halt'> = 'operator-halt'
  ): FundingLeg<'quarantined'> {
    this.#consumeCapability(leg, leg.state);
    this.#quarantine(leg.legId, reason);
    return this.#issue(this.#ledger.liability(leg.legId), 'quarantined');
  }

  /**
   * The only restart bridge to a value-effect capability. It first persists a
   * quarantine marker; callers never regain a funded capability from startup.
   */
  quarantineForResume(legId: string): FundingLeg<'quarantined'> | FundingLeg<'swept'> {
    const status = this.#ledger.status().get(legId);
    if (!status || status === 'reconciled') {
      throw new Error(`leg "${legId}" has no resumable liability`);
    }
    const entries = this.#ledger.read().filter((entry) => entry.legId === legId);
    const fundingConfirmed = entries.some((entry) => entry.kind === 'funded');
    if (!fundingConfirmed) {
      this.#quarantine(legId, 'startup-resume-required');
      throw new Error(`funding outcome remains unconfirmed for leg "${legId}"`);
    }
    const latestTransition = entries.filter((entry) => entry.kind !== 'quarantined').at(-1);
    if (
      latestTransition?.kind === 'sweep' &&
      latestTransition.ok &&
      latestTransition.residualAmount === 0
    ) {
      return this.#issue(this.#ledger.liability(legId), 'swept');
    }
    this.#quarantine(legId, 'startup-resume-required');
    return this.#issue(this.#ledger.liability(legId), 'quarantined');
  }
}
