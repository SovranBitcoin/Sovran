/**
 * Benchmark accumulator for a recovery run.
 *
 * Exists to answer one question with numbers instead of argument: what does a
 * restore actually cost, and how much of that is the native CDK blinding path
 * versus stock cashu-ts? The recovery screen can force either implementation,
 * so running it twice over the same wallet gives a clean A/B.
 *
 * Everything here is derived from counters the crypto seam already keeps
 * (`snapshotCryptoCounters`), diffed around each mint, plus the orchestration's
 * own tallies. One `recovery.benchmark` line at the end carries the whole run;
 * `recovery.benchmark.mint` carries each mint. Both are shaped for log-doctor.
 *
 * Note what "counters scanned" means: every blinded output produced during the
 * run. In a restore that is exactly the NUT-13 counter space walked, because
 * `batchRestore` blinds one output per counter it probes.
 */
import {
  diffCryptoCounters,
  isNativeCryptoEnabled,
  snapshotCryptoCounters,
  type CryptoCounters,
} from './nativeOutputDataCreator';
import { cashuLog } from '@/shared/lib/logger';

function roundMs(ms: number): number {
  return Math.round(ms * 100) / 100;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : null;
}

interface MintBenchmark {
  mintUrl: string;
  isDiscovered: boolean;
  status: string;
  keysetsTotal: number;
  keysetsAttempted: number;
  keysetsSkipped: number;
  keysetsAlreadyRecovered: number;
  keysetsFailed: number;
  durationMs: number;
  /** NUT-07 verdict on everything this mint's restore unblinded. */
  proofsReady: number;
  proofsSpent: number;
  crypto: CryptoCounters;
}

interface RunState {
  startedAt: number;
  impl: 'cdk-native' | 'cashu-ts';
  knownMints: number;
  probeCandidates: number;
  probeHits: number;
  mints: MintBenchmark[];
  cryptoAtStart: CryptoCounters;
  probeMs: number;
  finalizeMs: number;
}

let run: RunState | null = null;

export function beginRecoveryBenchmark(input: {
  knownMints: number;
  probeCandidates: number;
}): void {
  run = {
    startedAt: performance.now(),
    impl: isNativeCryptoEnabled() ? 'cdk-native' : 'cashu-ts',
    knownMints: input.knownMints,
    probeCandidates: input.probeCandidates,
    probeHits: 0,
    mints: [],
    cryptoAtStart: snapshotCryptoCounters(),
    probeMs: 0,
    finalizeMs: 0,
  };
  cashuLog.info('recovery.benchmark.start', {
    impl: run.impl,
    knownMints: input.knownMints,
    probeCandidates: input.probeCandidates,
  });
}

/** Snapshot to pass to `recordMintBenchmark` once the mint finishes. */
export function markMintStart(): CryptoCounters {
  return snapshotCryptoCounters();
}

export function recordMintBenchmark(
  entry: Omit<MintBenchmark, 'crypto'>,
  cryptoAtMintStart: CryptoCounters
): void {
  if (!run) return;
  const crypto = diffCryptoCounters(cryptoAtMintStart, snapshotCryptoCounters());
  run.mints.push({ ...entry, crypto });
  cashuLog.info('recovery.benchmark.mint', {
    hasMintUrl: !!entry.mintUrl,
    mintUrlLength: entry.mintUrl.length,
    status: entry.status,
    isDiscovered: entry.isDiscovered,
    keysets: entry.keysetsTotal,
    keysetsAttempted: entry.keysetsAttempted,
    keysetsSkipped: entry.keysetsSkipped,
    keysetsAlreadyRecovered: entry.keysetsAlreadyRecovered,
    keysetsFailed: entry.keysetsFailed,
    duration_ms: roundMs(entry.durationMs),
    countersScanned: crypto.blindOutputs,
    proofsUnblinded: crypto.unblindProofs,
    proofsReady: entry.proofsReady,
    proofsSpent: entry.proofsSpent,
    blind_ms: roundMs(crypto.blindMs),
    unblind_ms: roundMs(crypto.unblindMs),
    ms_per_proof:
      crypto.unblindProofs > 0 ? roundMs(crypto.unblindMs / crypto.unblindProofs) : null,
  });
}

export function recordProbePhase(input: { hits: number; durationMs: number }): void {
  if (!run) return;
  run.probeHits = input.hits;
  run.probeMs = input.durationMs;
}

export function recordFinalizePhase(durationMs: number): void {
  if (!run) return;
  run.finalizeMs = durationMs;
}

/**
 * Emits the run summary. Read it back with:
 *   bun run codereview/log-doctor/index.ts errors --latest --grep recovery.benchmark
 */
export function endRecoveryBenchmark(): void {
  if (!run) return;
  const totalMs = performance.now() - run.startedAt;
  const crypto = diffCryptoCounters(run.cryptoAtStart, snapshotCryptoCounters());
  const keysets = run.mints.reduce((sum, m) => sum + m.keysetsTotal, 0);
  const attempted = run.mints.reduce((sum, m) => sum + m.keysetsAttempted, 0);
  const cryptoMs = crypto.blindMs + crypto.unblindMs;
  const proofsReady = run.mints.reduce((sum, m) => sum + m.proofsReady, 0);
  const proofsSpent = run.mints.reduce((sum, m) => sum + m.proofsSpent, 0);
  const checked = proofsReady + proofsSpent;
  // The cost of unblinding proofs the mint then declared already spent. Derived
  // from the measured per-proof rate rather than timed separately, because the
  // spent/unspent verdict does not arrive until every proof in the keyset has
  // already been unblinded — that ordering IS the finding.
  const wastedUnblindMs =
    crypto.unblindProofs > 0 ? (crypto.unblindMs / crypto.unblindProofs) * proofsSpent : 0;

  cashuLog.info('recovery.benchmark', {
    impl: run.impl,
    // Scope of the run.
    mints: run.mints.length,
    knownMints: run.knownMints,
    probeCandidates: run.probeCandidates,
    probeHits: run.probeHits,
    keysets,
    keysetsAttempted: attempted,
    keysetsSkipped: run.mints.reduce((s, m) => s + m.keysetsSkipped, 0),
    keysetsAlreadyRecovered: run.mints.reduce((s, m) => s + m.keysetsAlreadyRecovered, 0),
    keysetsFailed: run.mints.reduce((s, m) => s + m.keysetsFailed, 0),
    countersScanned: crypto.blindOutputs,
    proofsUnblinded: crypto.unblindProofs,
    proofsReady,
    proofsSpent,
    // Cost.
    total_ms: roundMs(totalMs),
    probe_ms: roundMs(run.probeMs),
    finalize_ms: roundMs(run.finalizeMs),
    blind_ms: roundMs(crypto.blindMs),
    blind_calls: crypto.blindCalls,
    unblind_ms: roundMs(crypto.unblindMs),
    crypto_ms: roundMs(cryptoMs),
    // The headline ratios.
    crypto_share: ratio(cryptoMs, totalMs),
    blind_share: ratio(crypto.blindMs, totalMs),
    unblind_share: ratio(crypto.unblindMs, totalMs),
    ms_per_counter: crypto.blindOutputs > 0 ? roundMs(crypto.blindMs / crypto.blindOutputs) : null,
    ms_per_proof:
      crypto.unblindProofs > 0 ? roundMs(crypto.unblindMs / crypto.unblindProofs) : null,
    dleq_ratio: ratio(crypto.unblindWithDleq, crypto.unblindProofs),
    // How much of the run's dominant cost was spent on proofs that were thrown
    // away. `discard_ratio` near 1 means a faster restore is not a matter of
    // faster crypto but of not doing it: NUT-07 identifies spent proofs from the
    // secret alone, so the state check could precede the unblinding entirely.
    discard_ratio: ratio(proofsSpent, checked),
    wasted_unblind_ms: roundMs(wastedUnblindMs),
    wasted_share: ratio(wastedUnblindMs, totalMs),
  });
  run = null;
}
