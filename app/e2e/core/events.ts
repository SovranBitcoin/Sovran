/**
 * The structured event stream is the single source of truth. The runner emits
 * typed `RunnerEvent`s; every current reporter (TTY, plain, JSONL) is a pure
 * consumer. The bus stamps a monotonic `seq` + wall-clock `t`, and `redactDeep`s
 * every event before dispatch, so no observer can ever see raw secret material.
 */
import { redactDeep } from './redact';

export type Phase = 'precondition' | 'test' | 'verify' | 'cleanup';
export type FundsState = 'reconciled' | 'quarantined' | 'n/a';
export type RunProof = 'orchestration-smoke' | 'product-run';

interface Base {
  seq: number;
  t: number;
}

export type RunnerEvent = Base &
  (
    | {
        type: 'run.begin';
        runId: string;
        proof: RunProof;
        suite?: string;
        lane?: string;
        totalScenarios: number;
      }
    | {
        type: 'run.end';
        runId: string;
        passed: number;
        failed: number;
        skipped: number;
        deferred: number;
        durationMs: number;
        funds: FundsState;
        proof: RunProof;
      }
    | { type: 'suite.begin'; suite: string }
    | { type: 'suite.end'; suite: string; durationMs: number }
    | { type: 'lifecycle'; message: string }
    | {
        type: 'scenario.begin';
        id: string;
        name: string;
        lane: string;
        index: number;
        total: number;
      }
    | { type: 'scenario.end'; id: string; ok: boolean; durationMs: number; funds?: FundsState }
    | { type: 'fixture.begin'; id: string; invocation: number }
    | { type: 'fixture.end'; id: string; invocation: number; ok: boolean; durationMs: number }
    | { type: 'phase.begin'; phase: Phase }
    | { type: 'phase.end'; phase: Phase; ok: boolean; durationMs: number }
    | { type: 'step.begin'; index: number; stepId: string; kind: string; label: string }
    | {
        type: 'step.end';
        index: number;
        stepId: string;
        kind: string;
        label: string;
        ok: boolean;
        durationMs: number;
        detail?: unknown;
        error?: string;
      }
    | { type: 'assertion.begin'; index: number; stepId: string; label: string }
    | {
        type: 'assertion.end';
        index: number;
        stepId: string;
        label: string;
        ok: boolean;
        durationMs: number;
        error?: string;
      }
    | { type: 'retry'; index: number; attempt: number; max: number }
    | { type: 'baseline.failure'; unit: string; error: string }
    | { type: 'skip'; index?: number; reason: string }
    | { type: 'deferred'; scenarioId: string; capability: string; reason: string }
    | {
        type: 'artifact';
        artifactSeq: number;
        stepId: string;
        kind: 'screenshot' | 'ax' | 'log';
        path: string;
      }
    | { type: 'funding'; leg: string; unit: string; amountSat: number; mintHost: string }
    | { type: 'cleanup.begin' }
    | { type: 'cleanup.skipped'; count: number; reason: string }
    | { type: 'cleanup.end'; ok: boolean; durationMs: number }
    | { type: 'sweep-leg.begin'; mintHost: string; unit: string }
    | { type: 'sweep-leg.end'; mintHost: string; unit: string; ok: boolean; recoveredSat: number }
    | { type: 'reconciliation.begin' }
    | { type: 'reconciliation.end'; ok: boolean; state: FundsState }
    | { type: 'quarantine'; runId: string; reason: string }
    | {
        type: 'final-state';
        expected: string;
        actual: string;
        revision?: number;
        ok: boolean;
        skipped?: boolean;
        error?: string;
      }
  );

// Distributive Omit so a literal narrows to the matching discriminated member
// (a plain `Omit<Union, K>` collapses the union to only its common keys).
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type EmitInput = DistributiveOmit<RunnerEvent, 'seq' | 't'>;
export type Observer = (e: RunnerEvent) => void;

export class EventBus {
  #seq = 0;
  #observers: Observer[] = [];
  #now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  subscribe(o: Observer): () => void {
    this.#observers.push(o);
    return () => {
      this.#observers = this.#observers.filter((x) => x !== o);
    };
  }

  emit(input: EmitInput): RunnerEvent {
    // Event unions are preserved by the discriminant in `input`; object spread
    // cannot express that distributive relationship to TypeScript.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const stamped = { ...input, seq: this.#seq++, t: this.#now() } as RunnerEvent;
    // Redaction intentionally returns unknown because Secret descriptors change
    // shape; RunnerEvent has already constrained this event at the bus boundary.
    const safe = redactDeep(stamped) as RunnerEvent;
    for (const o of this.#observers) o(safe);
    return safe;
  }
}
