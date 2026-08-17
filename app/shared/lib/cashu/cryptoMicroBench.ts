/**
 * Per-operation BDHKE micro-benchmark: CDK (Rust, via cdk-nitro) vs cashu-ts
 * (JS, via @noble/curves), measured on the device that will actually run them.
 *
 * The point is to put a number on each primitive separately, because the
 * aggregate recovery timing hides which operation the cost is in — and it turns
 * out to be the one our native binding does NOT expose.
 *
 * Coverage is deliberately honest about that asymmetry. `cdk-nitro` exposes six
 * `create*Data` methods and nothing else, so:
 *
 *   hash-to-curve   cashu-ts only  — not exposed by the binding
 *   blind           BOTH           — the one operation we can compare
 *   sign            cashu-ts only  — mint-side; a wallet never runs it
 *   unblind         cashu-ts only  — not exposed, and it is ~90% of a restore
 *   verify DLEQ     cashu-ts only  — not exposed
 *
 * A missing CDK column is a finding, not a gap in this harness. Rows are
 * reported in microseconds per operation so they line up with the numbers other
 * Cashu implementations publish.
 */
import {
  blindMessage,
  createBlindSignature,
  hashToCurve,
  unblindSignature,
  verifyDLEQProof,
  OutputData,
  type HasKeysetKeys,
} from '@cashu/cashu-ts';

import { cashuLog } from '@/shared/lib/logger';
import { isNativeCryptoAvailable, loadNativeCreatorForBench } from './nativeOutputDataCreator';

/**
 * Iteration counts are sized for Hermes on a phone, not for Node. The same
 * rows cost roughly 30x more there — a single JS `Blind batch (100)` is
 * milliseconds on V8 and seconds on device — so the batch row gets its own
 * much smaller count. Everything still runs long enough to swamp
 * `performance.now()` granularity.
 */
const ITERATIONS = 25;
const BATCH_ITERATIONS = 2;
/** Outputs per batch-blind row — one restore batch. */
const BATCH_SIZE = 100;

const BENCH_KEYSET_ID = '009a1f293253e41e';
const BENCH_SEED = new Uint8Array(64).fill(11);

function benchKeyset(): HasKeysetKeys {
  const keys: Record<string, string> = {};
  for (let i = 0; i < 32; i++) keys[String(2 ** i)] = '02'.padEnd(66, 'a');
  return { id: BENCH_KEYSET_ID, keys };
}

export interface BenchRow {
  operation: string;
  /** Microseconds per operation, or null when an implementation cannot do it. */
  cdkUs: number | null;
  cashuTsUs: number | null;
  /** Present only when both sides ran. */
  winner: 'cdk' | 'cashu-ts' | null;
  speedup: number | null;
  note?: string;
}

function us(totalMs: number, iterations: number): number {
  return Math.round((totalMs * 1000) / iterations);
}

/** `Blind batch (100)` -> `blind_batch_100`, so each row gets its own event name. */
function slug(operation: string): string {
  return operation
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Hands the thread back so a multi-second benchmark does not freeze the UI. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function time(iterations: number, run: (i: number) => void): number {
  // One untimed pass so JIT warmup and lazy table building land outside the
  // measurement — noble precomputes wNAF tables on first use of a point.
  run(0);
  const start = performance.now();
  for (let i = 0; i < iterations; i++) run(i);
  return performance.now() - start;
}

function compare(
  operation: string,
  cdkUs: number | null,
  cashuTsUs: number | null,
  note?: string
): BenchRow {
  if (cdkUs == null || cashuTsUs == null) {
    return { operation, cdkUs, cashuTsUs, winner: null, speedup: null, note };
  }
  const winner = cdkUs < cashuTsUs ? 'cdk' : 'cashu-ts';
  const speedup =
    Math.round((Math.max(cdkUs, cashuTsUs) / Math.max(1, Math.min(cdkUs, cashuTsUs))) * 100) / 100;
  return { operation, cdkUs, cashuTsUs, winner, speedup, note };
}

/**
 * Runs every row and logs `cashu.microbench.row` per operation plus one
 * `cashu.microbench` summary. Safe to call on any device: rows the native
 * binding cannot serve simply report `null` for CDK.
 */
export async function runCryptoMicroBench(): Promise<BenchRow[]> {
  const keyset = benchKeyset();
  const native = loadNativeCreatorForBench();
  const rows: BenchRow[] = [];

  // ── hash-to-curve — Y = H2C(secret) ──────────────────────────────────────
  const secrets = Array.from({ length: ITERATIONS + 1 }, (_, i) =>
    new TextEncoder().encode(`bench-secret-${i}`)
  );
  const h2cMs = time(ITERATIONS, (i) => {
    hashToCurve(secrets[i]!);
  });
  rows.push(compare('Hash-to-curve', null, us(h2cMs, ITERATIONS), 'not exposed by cdk-nitro'));
  await yieldToEventLoop();

  // ── blind — B_ = Y + rG. The ONE operation both sides can do. ────────────
  const blindJsMs = time(ITERATIONS, (i) => {
    blindMessage(secrets[i]!);
  });
  const blindNativeMs = native
    ? time(ITERATIONS, (i) => {
        native.createSingleDeterministicData(0, BENCH_SEED, i, BENCH_KEYSET_ID);
      })
    : null;
  // Like-for-like against the native call, which derives its own secret from the
  // seed and counter rather than taking one.
  const blindJsDeterministicMs = time(ITERATIONS, (i) => {
    OutputData.createSingleDeterministicData(0, BENCH_SEED, i, BENCH_KEYSET_ID);
  });
  rows.push(
    compare(
      'Blind (deterministic)',
      blindNativeMs == null ? null : us(blindNativeMs, ITERATIONS),
      us(blindJsDeterministicMs, ITERATIONS)
    )
  );
  rows.push(
    compare(
      'Blind (raw secret)',
      null,
      us(blindJsMs, ITERATIONS),
      'native takes a counter, not a secret'
    )
  );

  await yieldToEventLoop();

  // ── blind batch — one restore batch of 100 counters ──────────────────────
  const split = new Array(BATCH_SIZE).fill(0);
  const batchJsMs = time(BATCH_ITERATIONS, (i) => {
    OutputData.createDeterministicData(0, BENCH_SEED, i * BATCH_SIZE, keyset, split);
  });
  const batchNativeMs = native
    ? time(BATCH_ITERATIONS, (i) => {
        native.createDeterministicData(0, BENCH_SEED, i * BATCH_SIZE, keyset, split);
      })
    : null;
  rows.push(
    compare(
      `Blind batch (${BATCH_SIZE})`,
      batchNativeMs == null ? null : us(batchNativeMs, BATCH_ITERATIONS),
      us(batchJsMs, BATCH_ITERATIONS)
    )
  );

  await yieldToEventLoop();

  // ── sign — mint-side, for reference against published tables ─────────────
  const mintKey = new Uint8Array(32).fill(9);
  const blinded = secrets.slice(0, ITERATIONS + 1).map((s) => blindMessage(s));
  const signMs = time(ITERATIONS, (i) => {
    createBlindSignature(blinded[i]!.B_, mintKey, BENCH_KEYSET_ID);
  });
  rows.push(compare('Sign', null, us(signMs, ITERATIONS), 'mint-side; a wallet never runs it'));

  await yieldToEventLoop();

  // ── unblind — C = C_ - rA. 90% of a restore, and CDK cannot be asked. ────
  const signatures = blinded
    .slice(0, ITERATIONS + 1)
    .map((b) => createBlindSignature(b.B_, mintKey, BENCH_KEYSET_ID));
  const mintPub = signatures[0]!.C_;
  const unblindMs = time(ITERATIONS, (i) => {
    unblindSignature(signatures[i]!.C_, blinded[i]!.r, mintPub);
  });
  rows.push(
    compare('Unblind', null, us(unblindMs, ITERATIONS), 'NOT exposed by cdk-nitro — see summary')
  );

  await yieldToEventLoop();

  // ── DLEQ verify — 79% of restored proofs carry one ──────────────────────
  let dleqUs: number | null = null;
  try {
    // Scalars only need to be well-formed, not valid: a proof that fails still
    // performs the same point arithmetic, and we are timing the work rather
    // than asserting the result.
    const scalar = new Uint8Array(32).fill(3);
    const dleqMs = time(ITERATIONS, (i) => {
      verifyDLEQProof(
        { s: scalar, e: scalar, r: blinded[i]!.r },
        blinded[i]!.B_,
        signatures[i]!.C_,
        mintPub
      );
    });
    dleqUs = us(dleqMs, ITERATIONS);
  } catch {
    dleqUs = null;
  }
  rows.push(compare('Verify DLEQ', null, dleqUs, 'not exposed by cdk-nitro'));

  // One event per operation, each with its OWN event name.
  //
  // Two logger behaviours make the obvious shapes lossy: consecutive entries
  // sharing an event name are collapsed inside a 50ms dedup window (seven
  // `cashu.microbench.row` lines in a tight loop became one row plus
  // `{_suppressed: 6}`), and nested arrays are truncated to `maxArrayItems`
  // (default 5), which would clip a seven-row table packed into one event.
  // Distinct names carrying flat scalars survive both.
  for (const row of rows) {
    cashuLog.info(`cashu.microbench.${slug(row.operation)}`, {
      operation: row.operation,
      cdk_us: row.cdkUs,
      cashu_ts_us: row.cashuTsUs,
      winner: row.winner,
      speedup: row.speedup,
      note: row.note ?? null,
    });
  }
  cashuLog.info('cashu.microbench', {
    iterations: ITERATIONS,
    batchIterations: BATCH_ITERATIONS,
    batchSize: BATCH_SIZE,
    nativeAvailable: isNativeCryptoAvailable(),
    rowsCompared: rows.filter((r) => r.winner !== null).length,
    rowsJsOnly: rows.filter((r) => r.cdkUs === null).length,
  });
  return rows;
}
