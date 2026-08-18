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
 * Phases of a recovery run, in order.
 *
 * `finalizing` exists because the work after the last mint resolves — untrust
 * probed-but-empty mints, drop stuck pending mint ops, reload the mint list —
 * used to run under the `restoring` copy. Every mint row would show its green
 * check while the hero kept spinning under "Recovering Wallet", which reads as
 * a hung app. Cleanup is real work and now says so.
 */
export type RecoveryPhase =
  'idle' | 'discovering' | 'restoring' | 'finalizing' | 'complete' | 'error';

/**
 * `already-recovered` is a success: every keyset this mint holds was already in
 * the database, which is exactly what a second recovery run should find.
 * `skipped` means we never tried — the mint was cancelled past, or its keysets
 * were not restorable NUT-02 ids.
 */
type MintRecoveryStatus =
  'waiting' | 'restoring' | 'done' | 'already-recovered' | 'skipped' | 'failed';

export interface MintRecoveryState {
  mint: string;
  /** Probed from the audit API rather than already trusted by the wallet. */
  isDiscovered: boolean;
  status: MintRecoveryStatus;
  /** null until `addMint` resolves and the keyset count is known. */
  keysetsTotal: number | null;
  keysetsDone: number;
  failedKeysets: number;
  /** Keysets already present in full, and keysets whose id we cannot restore. */
  alreadyRecoveredKeysets: number;
  skippedKeysets: number;
  /** Whether this mint holds a balance after restore. */
  fundsFound: boolean;
  startedAtMs: number | null;
  durationMs: number | null;
  error?: string;
}

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

export function createInitialMintStates(
  knownMintUrls: readonly string[],
  discoveredMintUrls: readonly string[]
): MintRecoveryState[] {
  return [...knownMintUrls, ...discoveredMintUrls].map((mint, index) => ({
    mint,
    isDiscovered: index >= knownMintUrls.length,
    status: 'waiting' as const,
    keysetsTotal: null,
    keysetsDone: 0,
    failedKeysets: 0,
    alreadyRecoveredKeysets: 0,
    skippedKeysets: 0,
    fundsFound: false,
    startedAtMs: null,
    durationMs: null,
  }));
}

export function computeRecoveryCounts(states: readonly MintRecoveryState[]): RecoveryCounts {
  const total = states.length;
  const succeeded = states.filter((s) => isSuccess(s.status)).length;
  const failed = states.filter((s) => s.status === 'failed').length;
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
  return states.filter((s) => !s.isDiscovered && s.status === 'failed').length;
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
  if (state.status === 'failed') {
    return state.error ?? 'Failed';
  }
  if (state.status === 'already-recovered') {
    return 'Already recovered';
  }
  if (state.status === 'skipped') {
    return state.error ?? 'Skipped';
  }
  if (state.status === 'done') {
    return null;
  }
  if (state.status === 'waiting') {
    return 'Waiting';
  }
  if (state.keysetsTotal == null) {
    return 'Reading keysets';
  }
  const base = `${state.keysetsDone} of ${state.keysetsTotal} keysets`;
  const elapsed = state.startedAtMs == null ? 0 : nowMs - state.startedAtMs;
  return elapsed >= slowAfterMs ? `${base} · still scanning` : base;
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
