/**
 * A recovery run: restore the ecash of each mint from the recovery phrase, one
 * mint at a time, then tidy up. One run value, held by one owner, says where
 * the run is; cancellation and each mint's timeout are decided here, and the
 * end of the run is decided from each mint's outcome.
 */
import { describeError } from '@/shared/lib/errors';
import { cashuLog, mintUrlLogFields, redactError } from '@/shared/lib/logger';
import { CocoManager } from '@/shared/lib/cashu/manager';
import {
  deleteMintOperation,
  restoreKeysetForMint,
  isRestorableKeysetId,
  isAlreadyRecoveredError,
  probeMintForHistory,
} from '@/shared/lib/cashu/managerInternals';
import { withTimeout } from 'wallet';
import { amountToNumber } from 'wallet/amount';
import {
  beginRecoverySuppression,
  endRecoverySuppression,
} from '@/shared/lib/cashu/recoverySuppression';
import {
  countKnownFailures,
  createInitialMintStates,
  fundsFound,
  isSuccess,
  knownEmpty,
  isTerminal,
  type FundsFound,
  type MintRecoveryState,
} from '@/features/settings/lib/recoveryProgress';

/**
 * The work a running recovery is doing. `finalizing` exists because the work
 * after the last mint resolves (untrust probed-but-empty mints, drop stuck
 * pending mint ops, reload the mint list) used to run under the `restoring`
 * copy: every mint row showed its green check while the hero kept spinning,
 * which reads as a hung app. Cleanup is real work and says so.
 */
type RecoveryStep = 'discovering' | 'restoring' | 'finalizing';

/** How a run ended: every known mint recovered, one did not, it was stopped, or it threw. */
type RecoveryEnd =
  | { kind: 'complete' }
  | { kind: 'incomplete' }
  | { kind: 'stopped' }
  | { kind: 'error'; message: string };

/**
 * - `idle`: no run on this screen yet.
 * - `running`: doing `step`; `label` names the work when the step has no mint to show.
 * - `cancelling`: as running, with a stop asked for: it stops at the next mint
 *   or keyset, never inside one.
 * - `finished`: over, with each mint's outcome in its row.
 */
export type RecoveryRun =
  | { phase: 'idle' }
  | { phase: 'running'; step: RecoveryStep; rows: MintRecoveryState[]; label: string | null }
  | { phase: 'cancelling'; step: RecoveryStep; rows: MintRecoveryState[]; label: string | null }
  | { phase: 'finished'; rows: MintRecoveryState[]; end: RecoveryEnd };

type RecoveryEvent =
  | { type: 'stepStarted'; step: 'discovering' | 'restoring'; rows: MintRecoveryState[] }
  | { type: 'finalizing' }
  | { type: 'labelled'; label: string | null }
  | { type: 'mintUpdated'; index: number; state: MintRecoveryState }
  | { type: 'cancelRequested' }
  | { type: 'ended'; end: RecoveryEnd };

const STOPPING_LABEL = 'Stopping after this mint';

export function recoveryTransition(run: RecoveryRun, event: RecoveryEvent): RecoveryRun {
  switch (event.type) {
    case 'stepStarted':
      return run.phase === 'cancelling'
        ? { ...run, step: event.step, rows: event.rows, label: null }
        : { phase: 'running', step: event.step, rows: event.rows, label: null };
    case 'finalizing':
      if (run.phase !== 'running' && run.phase !== 'cancelling') return run;
      return { ...run, step: 'finalizing' };
    case 'labelled':
      if (run.phase !== 'running' && run.phase !== 'cancelling') return run;
      return { ...run, label: event.label };
    case 'mintUpdated': {
      if (run.phase === 'idle') return run;
      const row = run.rows[event.index]!;
      let next: MintRecoveryState = event.state;
      if (isTerminal(row.status)) {
        // A mint's outcome is final. A restore that timed out is not
        // cancelled, and its late result must not rewrite the row; the
        // funds it found are kept on it.
        if (row.status !== 'timed-out' || fundsFound(row) || !fundsFound(event.state)) return run;
        next = { ...row, fundsFound: true };
      }
      const rows = [...run.rows];
      rows[event.index] = next;
      return { ...run, rows };
    }
    case 'cancelRequested':
      if (run.phase !== 'running') return run;
      return { ...run, phase: 'cancelling', label: STOPPING_LABEL };
    case 'ended':
      return { phase: 'finished', rows: run.phase === 'idle' ? [] : run.rows, end: event.end };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/** Whether a run is doing work and must not be interrupted (navigation is held). */
export function isRecoveryActive(run: RecoveryRun): boolean {
  switch (run.phase) {
    case 'running':
    case 'cancelling':
      return true;
    case 'idle':
    case 'finished':
      return false;
  }
}

/**
 * Module-scoped, deliberately not React state.
 *
 * Two full recoveries once ran concurrently on-device (two `recovery.start`,
 * each taking ~180s instead of ~100s) because the screen remounted — a Metro
 * reload, or AppGate re-rendering — and remounting resets any state- or
 * ref-based guard back to "idle". Module scope is the only thing that survives
 * that, and running two restores against one wallet database races counters.
 */
let runOwned = false;
/** Runs started in this process; a run is the latest while no other has started since. */
let runsStarted = 0;

export interface RecoveryRunOwner {
  /** Ask the run to stop after the mint or keyset in flight. */
  cancel(): void;
}

/** A mint that stops answering must not strand the whole (now serial) run. */
const MINT_RESTORE_TIMEOUT_MS = 120_000;

/** Probed mints get one cheap batch to prove they hold anything at all. */
const PROBE_CONCURRENCY = 4;

/**
 * Hand the thread back so timers fire and React can paint.
 *
 * A `setTimeout` and not `queueMicrotask`/`await null`: restore's cost lands as
 * promise continuations, and microtasks drain fully before the timer queue, so
 * four batches' worth of unblinding chain back-to-back into one 34-second block.
 * Only a macrotask boundary actually breaks that chain.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface RecoveryInput {
  knownMintUrls: string[];
  /** Mints from the audit API to probe first; only those holding history are restored. */
  probeCandidates: string[];
  loadMints: () => Promise<unknown>;
}

/**
 * Start a recovery run. Nothing starts while another run is going in this
 * process (`busy`) or when there is no mint to ask (`noMints`). `publish` is
 * told the run value each time it changes, starting from `from` (the screen's
 * value now). `done` resolves once the run is over and given up, with its
 * final value and how long it took.
 */
export function startRecoveryRun(
  input: RecoveryInput,
  from: RecoveryRun,
  publish: (run: RecoveryRun) => void
):
  | { status: 'busy' }
  | { status: 'noMints' }
  | {
      status: 'started';
      owner: RecoveryRunOwner;
      done: Promise<{ rows: MintRecoveryState[]; end: RecoveryEnd; totalMs: number }>;
    } {
  // Module-scoped, so a remount cannot reset it. Two concurrent recoveries
  // race the same counters and each takes ~1.8x as long.
  if (runOwned) {
    cashuLog.warn('recovery.start.rejected', { reason: 'already_in_flight' });
    return { status: 'busy' };
  }
  if (input.knownMintUrls.length === 0 && input.probeCandidates.length === 0) {
    return { status: 'noMints' };
  }
  runOwned = true;
  const generation = ++runsStarted;
  let run = from;
  // A stop belongs to this run, for good: a mint that timed out is still
  // restoring behind the run, and must not go on once the run has ended.
  let stopped = false;
  const dispatch = (event: RecoveryEvent) => {
    const next = recoveryTransition(run, event);
    if (next === run) return;
    run = next;
    if (run.phase === 'cancelling') stopped = true;
    publish(run);
  };
  const stopRequested = () => stopped;
  // Hold the app-wide refresh storm until the run is over — see the module
  // doc for what it costs when left on.
  beginRecoverySuppression();
  const done = (async () => {
    const t0 = performance.now();
    let end: RecoveryEnd;
    try {
      end = await recover(input, {
        dispatch,
        stopRequested,
        rows: () => rowsOf(run),
        isLatestRun: () => runsStarted === generation,
      });
    } catch (error) {
      end = { kind: 'error', message: describeError(error, 'cashu').text };
    } finally {
      runOwned = false;
      // Replays one refresh per subscriber.
      endRecoverySuppression();
    }
    dispatch({ type: 'ended', end });
    return { rows: rowsOf(run), end, totalMs: Math.round((performance.now() - t0) * 100) / 100 };
  })();
  return {
    status: 'started',
    owner: { cancel: () => dispatch({ type: 'cancelRequested' }) },
    done,
  };
}

/** Ids of the pending mint operations now; none when they cannot be read, so none is deleted. */
async function pendingMintOperationIds(
  manager: ReturnType<typeof CocoManager.getInstance>
): Promise<ReadonlySet<string>> {
  try {
    return new Set((await manager.ops.mint.listPending()).map((op) => op.id));
  } catch (error) {
    cashuLog.warn('recovery.cleanup.list_failed', { error: redactError(error) });
    return new Set();
  }
}

/** Untrust a mint the run trusted and found nothing at; a failure is logged, never thrown. */
async function untrustProbedMint(
  manager: ReturnType<typeof CocoManager.getInstance>,
  mint: string
): Promise<void> {
  try {
    await manager.mint.untrustMint(mint);
    cashuLog.info('recovery.cleanup.discovered_mint_untrusted', { ...mintUrlLogFields(mint) });
  } catch (e) {
    cashuLog.warn('recovery.cleanup.untrust_failed', {
      ...mintUrlLogFields(mint),
      error: redactError(e),
    });
  }
}

function rowsOf(run: RecoveryRun): MintRecoveryState[] {
  return run.phase === 'idle' ? [] : run.rows;
}

interface RunControl {
  dispatch: (event: RecoveryEvent) => void;
  stopRequested: () => boolean;
  rows: () => MintRecoveryState[];
  /** False once another run has started: it may hold this run's mints as its own. */
  isLatestRun: () => boolean;
}

async function recover(
  { knownMintUrls, probeCandidates, loadMints }: RecoveryInput,
  { dispatch, stopRequested, rows, isLatestRun }: RunControl
): Promise<RecoveryEnd> {
  const t0 = performance.now();
  let allMintUrls = knownMintUrls;
  const probeMintUrls: string[] = [];
  // Probing calls addMint({ trusted: true }) on EVERY candidate, so the
  // misses must be untrusted too — they are not in `allMintUrls`, so the
  // discovered-but-empty cleanup below cannot see them.
  const probeMissUrls: string[] = [];

  const manager = CocoManager.getInstance();
  // Pending mint operations are read before anything is restored: only those
  // can be stale from before the run (see the cleanup below).
  const pendingBefore = await pendingMintOperationIds(manager);

  // Shallow probe pass. Ask each unknown mint one cheap question — does
  // this seed have anything here — instead of running a full gap walk over
  // every keyset of up to 100 mints. Empty probes produce no signatures and
  // therefore no unblinding, so these are safe to run a few at a time.
  if (probeCandidates.length > 0) {
    dispatch({
      type: 'stepStarted',
      step: 'discovering',
      rows: createInitialMintStates(knownMintUrls, []),
    });
    for (let start = 0; start < probeCandidates.length; start += PROBE_CONCURRENCY) {
      if (stopRequested()) break;
      const slice = probeCandidates.slice(start, start + PROBE_CONCURRENCY);
      dispatch({
        type: 'labelled',
        label: `Checking ${Math.min(start + slice.length, probeCandidates.length)} of ${probeCandidates.length} mints`,
      });
      const hits = await Promise.all(
        slice.map((url) =>
          probeMintForHistory(manager, url)
            .then((found) => (found ? url : null))
            .catch(() => null)
        )
      );
      probeMintUrls.push(...hits.filter((url): url is string => url != null));
      probeMissUrls.push(...slice.filter((url) => !hits.includes(url)));
      await yieldToEventLoop();
    }
    cashuLog.info('recovery.probe.done', {
      candidates: probeCandidates.length,
      hits: probeMintUrls.length,
    });
    allMintUrls = [...knownMintUrls, ...probeMintUrls];
  }

  cashuLog.info('recovery.start', {
    mintCount: allMintUrls.length,
    knownMints: knownMintUrls.length,
    discoveredMints: probeMintUrls.length,
    probeCandidates: probeCandidates.length,
    deepProbe: probeCandidates.length > 0,
  });
  dispatch({
    type: 'stepStarted',
    step: 'restoring',
    rows: createInitialMintStates(knownMintUrls, probeMintUrls),
  });

  const update = (index: number, state: MintRecoveryState) =>
    dispatch({ type: 'mintUpdated', index, state });

  /** Restore one mint; resolves whether it holds funds after the restore, `unknown` when unread. */
  const restoreOneUrl = async (mintUrl: string, i: number): Promise<FundsFound> => {
    const isDiscovered = i >= knownMintUrls.length;
    const mintT0 = performance.now();
    cashuLog.info('recovery.mint.start', {
      ...mintUrlLogFields(mintUrl),
      mintIndex: i,
      totalMints: allMintUrls.length,
      isDiscovered,
    });
    const startedAtMs = Date.now();
    update(i, {
      mint: mintUrl,
      isDiscovered,
      status: 'restoring',
      startedAtMs,
      keysetsTotal: null,
      keysetsDone: 0,
    });

    // Drive coco's own restore loop keyset by keyset instead of calling
    // `wallet.restore(mintUrl)`. That call walks every keyset silently and
    // throws once at the end, so it can report neither how far along a mint
    // is nor which keyset failed — and a single mint can hold this screen
    // for over a minute.
    let keysetsTotal = 0;
    let keysetsDone = 0;
    let failedKeysets = 0;
    let alreadyRecoveredKeysets = 0;
    let skippedKeysets = 0;
    let stoppedBeforeLastKeyset = false;
    let mintError: string | undefined;
    try {
      // Same call `wallet.restore` makes first, so this stays idempotent —
      // and it is the only way to learn the keyset count up front.
      const { keysets } = await manager.mint.addMint(mintUrl, { trusted: true });
      keysetsTotal = keysets.length;
      update(i, {
        mint: mintUrl,
        isDiscovered,
        status: 'restoring',
        startedAtMs,
        keysetsTotal,
        keysetsDone,
      });
      cashuLog.info('recovery.mint.keysets', {
        ...mintUrlLogFields(mintUrl),
        keysetCount: keysets.length,
      });

      for (const keyset of keysets) {
        if (stopRequested()) {
          stoppedBeforeLastKeyset = true;
          break;
        }
        // Mirrors coco's normalizeUnit(keyset.unit ?? DEFAULT_UNIT).
        const unit = (keyset.unit ?? 'sat').toLowerCase();
        if (!isRestorableKeysetId(keyset.id)) {
          skippedKeysets += 1;
          cashuLog.info('recovery.keyset.skipped', {
            ...mintUrlLogFields(mintUrl),
            keysetId: keyset.id,
            reason: 'non_nut02_id',
          });
        } else {
          try {
            await restoreKeysetForMint(manager, { mintUrl, keysetId: keyset.id, unit });
          } catch (error) {
            if (isAlreadyRecoveredError(error)) {
              // Every proof was already in the database — a second run
              // finding nothing new is success, not failure.
              alreadyRecoveredKeysets += 1;
              cashuLog.info('recovery.keyset.already_recovered', {
                ...mintUrlLogFields(mintUrl),
                keysetId: keyset.id,
              });
            } else {
              failedKeysets += 1;
              cashuLog.warn('recovery.keyset.failed', {
                ...mintUrlLogFields(mintUrl),
                keysetId: keyset.id,
                unit,
                error: redactError(error),
              });
            }
          }
        }
        keysetsDone += 1;
        update(i, {
          mint: mintUrl,
          isDiscovered,
          status: 'restoring',
          startedAtMs,
          keysetsTotal,
          keysetsDone,
        });
        // Between keysets, not inside them: unblinding a batch is one
        // uninterruptible JS turn, so this is the only place the thread
        // can be handed back.
        await yieldToEventLoop();
      }
    } catch (error) {
      // addMint failed — the mint is unreachable, so no keyset ran at all.
      failedKeysets = Math.max(failedKeysets, 1);
      mintError = describeError(error, 'cashu').text;
      cashuLog.warn('recovery.mint.restore_threw', {
        ...mintUrlLogFields(mintUrl),
        error: redactError(error),
      });
    }

    // Scoped to this mint. Unscoped, coco falls through to
    // `getAllReadyProofs` — a full ready-proof scan across every mint,
    // once per mint completion.
    const balances = await manager.wallet.balances
      .byMint({ mintUrls: [mintUrl] })
      .catch(() => null);
    // A read that failed says nothing: the restore may have saved ecash there.
    const found: FundsFound =
      balances === null ? 'unknown' : amountToNumber(balances[mintUrl]?.total) > 0;
    const durationMs = Math.round((performance.now() - mintT0) * 100) / 100;

    // Report what actually happened. This used to be an unconditional
    // `success: true`, which made "Recovery Partial" dead code and let the
    // screen claim it recovered from every mint while restore threw.
    //
    // A mint stopped before its last keyset was not recovered: it is
    // `skipped`, and its pending operations are kept for the next run.
    //
    // A mint whose keysets were ALL screened out was never attempted, so it
    // is `skipped`, not `done` — otherwise a mint serving only legacy
    // non-NUT-02 ids (mint.minibits.cash) shows a green check and, in gate
    // mode, Continue permanently clears the restore gate for funds that
    // were never looked for.
    const attemptedKeysets = keysetsTotal - skippedKeysets;
    const restoredSomething = alreadyRecoveredKeysets === 0 || failedKeysets > 0;
    const base = { mint: mintUrl, isDiscovered };
    update(
      i,
      failedKeysets > 0
        ? {
            ...base,
            status: 'failed',
            error: mintError ?? `${failedKeysets} keyset(s) failed`,
            fundsFound: found,
            durationMs,
          }
        : stoppedBeforeLastKeyset
          ? { ...base, status: 'skipped', reason: 'cancelled', fundsFound: found }
          : skippedKeysets > 0 && attemptedKeysets === 0
            ? {
                ...base,
                status: 'skipped',
                reason: 'not-restorable',
                fundsFound: found,
                durationMs,
              }
            : {
                ...base,
                status: restoredSomething ? 'done' : 'already-recovered',
                fundsFound: found,
                durationMs,
              }
    );
    cashuLog.info('recovery.mint.done', {
      ...mintUrlLogFields(mintUrl),
      durationMs,
      failedKeysets,
      alreadyRecoveredKeysets,
      skippedKeysets,
      fundsFound: found,
    });
    return found;
  };

  // A discovered mint that timed out is left trusted by the tidy-up below:
  // its restore goes on behind the run and may yet find funds. Its late
  // result decides it as the tidy-up would have, however late it comes:
  // untrusted when it found nothing, kept when it found funds or its balance
  // could not be read. One whose result never comes stays trusted, and so
  // does one a later run has taken up: that run lists it as trusted and
  // restores it as its own.
  const awaitingLateResult = new Set<string>();
  const decideWhenRestored = (mintUrl: string, restore: Promise<FundsFound>) => {
    awaitingLateResult.add(mintUrl);
    void restore.then(
      async (found) => {
        awaitingLateResult.delete(mintUrl);
        if (found !== false || !isLatestRun()) {
          cashuLog.info('recovery.cleanup.timed_out_mint_kept', {
            ...mintUrlLogFields(mintUrl),
            fundsFound: found,
          });
          return;
        }
        await untrustProbedMint(manager, mintUrl);
      },
      (error: unknown) => {
        awaitingLateResult.delete(mintUrl);
        cashuLog.warn('recovery.cleanup.timed_out_mint_left_trusted', {
          ...mintUrlLogFields(mintUrl),
          error: redactError(error),
        });
      }
    );
  };

  // ONE MINT AT A TIME.
  //
  // This used to be `Promise.allSettled(allMintUrls.map(...))`. Every other
  // Cashu wallet — cashu.me, macadamia, minibits — and CDK's own Rust
  // restore run mints strictly sequentially, and the measured reason is
  // stark: with N mints in flight, cashu-ts's 4-way in-keyset batch pool
  // becomes 4N concurrent responses whose unblinding drains as one
  // unbroken microtask chain. On-device that produced 34s and 39s JS
  // blocks, and it punished the innocent — the two mints that restored
  // NOTHING still took 35s each, with request latency up to 56s, purely
  // from contention. Network concurrency inside a keyset is kept, because
  // that part is bounded and not CPU-bound.
  for (let i = 0; i < allMintUrls.length; i += 1) {
    const mintUrl = allMintUrls[i]!;
    const base = { mint: mintUrl, isDiscovered: i >= knownMintUrls.length };
    if (stopRequested()) {
      update(i, { ...base, status: 'skipped', reason: 'cancelled', fundsFound: false });
      continue;
    }
    const restore = restoreOneUrl(mintUrl, i);
    try {
      await withTimeout(restore, MINT_RESTORE_TIMEOUT_MS, 'recovery.mint');
    } catch (error) {
      // coco's request provider has no HTTP timeout, so one unresponsive
      // mint would otherwise stall every mint behind it.
      // The catalogue's timeout copy is about a payment whose outcome is
      // unknown, which a restore is not.
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      update(
        i,
        timedOut
          ? { ...base, status: 'timed-out', fundsFound: false }
          : {
              ...base,
              status: 'failed',
              error: describeError(error, 'cashu').text,
              fundsFound: false,
              durationMs: null,
            }
      );
      cashuLog.warn(timedOut ? 'recovery.mint.timed_out' : 'recovery.mint.restore_failed', {
        ...mintUrlLogFields(mintUrl),
        timeoutMs: MINT_RESTORE_TIMEOUT_MS,
        error: redactError(error),
      });
      // Only a mint this run trusted is this run's to untrust.
      if (timedOut && base.isDiscovered && !knownMintUrls.includes(mintUrl)) {
        decideWhenRestored(mintUrl, restore);
      }
    }
  }

  dispatch({ type: 'finalizing' });

  // Untrust discovered mints that returned no funds; one that timed out
  // may yet, and is left trusted until its late result decides it, and one
  // whose balance could not be read may hold funds and is left trusted. `wallet.restore`
  // calls `mintService.addMintByUrl(url, { trusted: true })` for every
  // probed URL (see ../coco/packages/core/api/WalletApi.ts), which would
  // otherwise leave attacker-supplied URLs from the audit API permanently
  // in the trusted-mints set used by the routing surface.
  const untrustUrls = [
    ...new Set([
      ...rows()
        .filter((r) => r.isDiscovered && knownEmpty(r))
        .map((r) => r.mint),
      ...probeMissUrls,
    ]),
  ].filter((url) => !knownMintUrls.includes(url));
  if (untrustUrls.length > 0) {
    dispatch({ type: 'labelled', label: `Tidying up ${untrustUrls.length} probed mints` });
    await Promise.all(untrustUrls.map((mint) => untrustProbedMint(manager, mint)));
  }
  if (awaitingLateResult.size > 0) {
    cashuLog.info('recovery.cleanup.timed_out_mints_left_trusted', {
      count: awaitingLateResult.size,
    });
  }

  // Clean up stuck pending mint operations from before the restore.
  // These were queued (typically by NPC sync) when the wallet's
  // deterministic counter was out of sync with the mint, so their
  // outputData was generated against a counter the mint had already
  // signed. They will fail forever with `outputs already signed` and
  // re-loop via the operation watcher. Dropping one is non-destructive only
  // where the proofs were recovered above: so only an operation that was
  // pending before the run, on a mint this run restored. The others (a mint
  // that failed, timed out or was skipped, and anything that appeared during
  // the run) are kept for the next run.
  try {
    const restored = new Set(
      rows()
        .filter((r) => isSuccess(r.status))
        .map((r) => r.mint)
    );
    const pendingOps = await manager.ops.mint.listPending();
    const stale = pendingOps.filter((op) => pendingBefore.has(op.id) && restored.has(op.mintUrl));
    if (stale.length > 0) {
      dispatch({ type: 'labelled', label: `Clearing ${stale.length} stale operations` });
      // Coco doesn't expose a public abandon API for pending operations,
      // so go through the typed seam in shared/lib/cashu/managerInternals.
      for (const op of stale) {
        await deleteMintOperation(manager, op.id).catch((e) =>
          cashuLog.warn('recovery.cleanup.delete_failed', {
            operationId: op.id,
            ...mintUrlLogFields(op.mintUrl),
            error: redactError(e),
          })
        );
      }
      cashuLog.info('recovery.cleanup.dropped_stuck_pending_ops', {
        count: stale.length,
        operationIds: stale.map((o) => o.id),
      });
    }
    if (stale.length < pendingOps.length) {
      cashuLog.info('recovery.cleanup.kept_pending_ops', {
        count: pendingOps.length - stale.length,
      });
    }
  } catch (cleanupErr) {
    cashuLog.warn('recovery.cleanup.failed', {
      error: redactError(cleanupErr),
    });
  }

  dispatch({ type: 'labelled', label: 'Refreshing your mints' });
  await loadMints();
  const stopped = stopRequested();
  const results = rows();
  const knownFailureCount = countKnownFailures(results);
  cashuLog.info(stopped ? 'recovery.cancelled' : 'recovery.complete', {
    totalMs: Math.round((performance.now() - t0) * 100) / 100,
    knownFailureCount,
    totalResults: results.length,
  });
  if (stopped) return { kind: 'stopped' };
  return knownFailureCount === 0 ? { kind: 'complete' } : { kind: 'incomplete' };
}
