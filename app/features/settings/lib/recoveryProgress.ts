/**
 * Recovery progress model — the single source of truth for "how far along is
 * this recovery, and what is it doing right now".
 *
 * Split out from the screen so the counting rules are testable without
 * rendering, and so "what does done mean when a mint failed" has exactly one
 * answer. Mirrors `features/mint/lib/rebalanceRunState.ts`, the app's existing
 * multi-step-job progress reducer.
 */
import type { CheckpointStatus } from '@/shared/blocks/status';

/**
 * Whether the balance read after a mint's restore found funds there;
 * `unknown` when that read failed, so the restore may have saved ecash there.
 */
export type FundsFound = boolean | 'unknown';

/**
 * Where one mint is in a recovery run, and once it is over, its outcome:
 * restored (`done`, or `already-recovered` when every proof was already in the
 * database, which is what a second run should find), `failed` with its reason,
 * `timed-out`, or `skipped`: never tried, because the run was stopped first
 * (`cancelled`, including a mint stopped before its last keyset) or because
 * none of its keysets has an id that can be restored (`not-restorable`).
 *
 * An outcome is final: nothing moves a mint out of it. A mint that timed out
 * is still restoring behind the run; what its late result found is recorded
 * on it, and it stays timed out.
 */
type MintRecoveryProgress =
  | { status: 'waiting' }
  | {
      status: 'restoring';
      startedAtMs: number;
      /** null until `addMint` resolves and the keyset count is known. */
      keysetsTotal: number | null;
      keysetsDone: number;
    }
  | {
      status: 'done' | 'already-recovered';
      /** Whether this mint holds a balance after restore. */
      fundsFound: FundsFound;
      durationMs: number;
    }
  | { status: 'failed'; error: string; fundsFound: FundsFound; durationMs: number | null }
  | {
      status: 'timed-out';
      /** A late result of its restore read a balance there. */
      fundsFound: FundsFound;
    }
  | {
      status: 'skipped';
      reason: 'cancelled';
      /** A mint the stop cut short may already hold what its first keysets restored. */
      fundsFound: FundsFound;
    }
  | { status: 'skipped'; reason: 'not-restorable'; fundsFound: FundsFound; durationMs: number };

type MintRecoveryStatus = MintRecoveryProgress['status'];

export type MintRecoveryState = {
  mint: string;
  /** Probed from the audit API rather than already trusted by the wallet. */
  isDiscovered: boolean;
} & MintRecoveryProgress;

interface RecoveryCounts {
  /** Mints that reached a terminal status, successful or not. */
  settled: number;
  succeeded: number;
  failed: number;
  total: number;
  allSettled: boolean;
  /** 0–1, over every mint in the run. */
  progressPct: number;
}

const TERMINAL: ReadonlySet<MintRecoveryStatus> = new Set<MintRecoveryStatus>([
  'done',
  'already-recovered',
  'skipped',
  'failed',
  'timed-out',
]);

/** Terminal statuses that are a problem. */
const FAILED: ReadonlySet<MintRecoveryStatus> = new Set<MintRecoveryStatus>([
  'failed',
  'timed-out',
]);

/** Terminal statuses that are not a problem. */
const SUCCEEDED: ReadonlySet<MintRecoveryStatus> = new Set<MintRecoveryStatus>([
  'done',
  'already-recovered',
]);

export function isTerminal(status: MintRecoveryStatus): boolean {
  return TERMINAL.has(status);
}

export function isSuccess(status: MintRecoveryStatus): boolean {
  return SUCCEEDED.has(status);
}

export function isFailure(status: MintRecoveryStatus): boolean {
  return FAILED.has(status);
}

/** What a mint's restore found there; false for a mint never restored. */
function fundsRead(state: MintRecoveryState): FundsFound {
  switch (state.status) {
    case 'done':
    case 'already-recovered':
    case 'failed':
    case 'skipped':
    case 'timed-out':
      return state.fundsFound;
    case 'waiting':
    case 'restoring':
      return false;
  }
}

/** Whether a mint's funds were found after its restore. */
export function fundsFound(state: MintRecoveryState): boolean {
  return fundsRead(state) === true;
}

/**
 * Whether the run learned that a mint holds nothing. Not for a mint that
 * timed out, whose restore may still find funds there, nor for one whose
 * balance could not be read.
 */
export function knownEmpty(state: MintRecoveryState): boolean {
  return state.status !== 'timed-out' && fundsRead(state) === false;
}

/** Why a mint did not recover, for a row's error line; undefined when it did or is not over. */
export function mintRecoveryError(state: MintRecoveryState): string | undefined {
  switch (state.status) {
    case 'failed':
      return state.error;
    case 'timed-out':
      return 'Timed out';
    case 'skipped':
      return state.reason === 'cancelled' ? 'Cancelled' : undefined;
    case 'waiting':
    case 'restoring':
    case 'done':
    case 'already-recovered':
      return undefined;
  }
}

export function createInitialMintStates(
  knownMintUrls: readonly string[],
  discoveredMintUrls: readonly string[]
): MintRecoveryState[] {
  return [...knownMintUrls, ...discoveredMintUrls].map((mint, index) => ({
    mint,
    isDiscovered: index >= knownMintUrls.length,
    status: 'waiting' as const,
  }));
}

export function computeRecoveryCounts(states: readonly MintRecoveryState[]): RecoveryCounts {
  const total = states.length;
  const succeeded = states.filter((s) => isSuccess(s.status)).length;
  const failed = states.filter((s) => isFailure(s.status)).length;
  const settled = states.filter((s) => isTerminal(s.status)).length;
  return {
    settled,
    succeeded,
    failed,
    total,
    allSettled: total > 0 && settled === total,
    progressPct: total === 0 ? 0 : Math.max(0, Math.min(1, settled / total)),
  };
}

/**
 * Failures on *known* mints are what make a run partial. A probed mint that
 * fails is the expected case — we guessed the user might have used it and were
 * wrong — so it must not turn a clean recovery red.
 */
export function countKnownFailures(states: readonly MintRecoveryState[]): number {
  return states.filter((s) => !s.isDiscovered && isFailure(s.status)).length;
}

/**
 * Sublabel for one mint row. Keeps the "is this thing still alive" answer in
 * one place: a keyset count once we know the denominator, and an explicit
 * long-running note past `slowAfterMs`, because a single mint can legitimately
 * scan for over a minute and silence there is indistinguishable from a hang.
 */
export function describeMintProgress(
  state: MintRecoveryState,
  nowMs: number,
  slowAfterMs = 20_000
): string | null {
  switch (state.status) {
    case 'failed':
    case 'timed-out':
      return mintRecoveryError(state) ?? 'Failed';
    case 'already-recovered':
      return 'Already recovered';
    case 'skipped':
      return mintRecoveryError(state) ?? 'Skipped';
    case 'done':
      return null;
    case 'waiting':
      return 'Waiting';
    case 'restoring': {
      if (state.keysetsTotal == null) {
        return 'Reading keysets';
      }
      const base = `${state.keysetsDone} of ${state.keysetsTotal} keysets`;
      const elapsed = nowMs - state.startedAtMs;
      return elapsed >= slowAfterMs ? `${base} · still scanning` : base;
    }
  }
}

/**
 * Maps a mint's recovery status onto the checkpoint vocabulary the payment
 * timeline and transfer chain already speak, so the recovery rows render
 * through `mapCheckpointStatusToIndicator` exactly like every other status dot
 * in the app rather than hand-rolling phase/result pairs.
 *
 * The important one is `waiting` → `future`, which resolves to phase `idle`:
 * a dimmed dashed ring that does NOT rotate. A queued mint is genuinely doing
 * nothing, and spinning on it is the same lie the whole screen used to tell.
 */
export function mintStatusToCheckpoint(status: MintRecoveryStatus): CheckpointStatus {
  switch (status) {
    case 'waiting':
      return 'future';
    case 'restoring':
      return 'current';
    case 'done':
    case 'already-recovered':
      // Already-recovered is a success — the sublabel carries the nuance, the
      // dot should not imply something went wrong.
      return 'complete';
    case 'skipped':
      return 'already-spent';
    case 'failed':
    case 'timed-out':
      return 'failed';
  }
}

/**
 * The mint currently being restored. Meaningful only because mints now run one
 * at a time — with the old parallel fan-out there was no such thing as "the"
 * current mint, which is why the screen could only ever show a bare spinner.
 */
export function currentMint(states: readonly MintRecoveryState[]): MintRecoveryState | null {
  return states.find((s) => s.status === 'restoring') ?? null;
}

/** 1-based position of the current mint, for "Mint 2 of 5". */
export function currentMintPosition(states: readonly MintRecoveryState[]): number {
  const index = states.findIndex((s) => s.status === 'restoring');
  return index === -1 ? computeRecoveryCounts(states).settled : index + 1;
}
