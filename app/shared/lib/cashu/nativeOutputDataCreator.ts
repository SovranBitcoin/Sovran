/**
 * Resolves the OutputDataCreator for coco's `outputDataCreator` seam: the
 * native (CDK Rust) implementation when enabled and proven, instrumented stock
 * cashu-ts otherwise. Always returns a creator so every blinding call — the
 * expensive secp256k1 work behind restore batches, send splits, and melt
 * change — emits a `cashu.output_data.created` log naming which implementation
 * ran it and how long it took. That log is the runtime proof of whether CDK or
 * cashu-ts is doing the crypto.
 *
 * Why a self-test rather than a version check: a blinding implementation can
 * match the TypeScript signatures perfectly and still produce different bytes.
 * That is exactly how `nutpatch` broke restore — its splitter dropped zero
 * amounts, so `Wallet.restore()` asked the mint for nothing, recovered nothing,
 * and reported an empty wallet without erroring. Type compatibility is not
 * protocol compatibility, so we check the actual output.
 *
 * The decision is made ONCE, at Manager init, and applies to every operation.
 * Never fall back per-operation: mixing two blinding paths inside a single
 * operation could pair outputs from one implementation with counters from the
 * other, which is unrecoverable.
 *
 * Native is the default; EXPO_PUBLIC_CASHU_NATIVE_CRYPTO='0' forces the JS path.
 */
import {
  OutputData,
  type HasKeysetKeys,
  type OutputDataCreator,
  type OutputDataLike,
} from '@cashu/cashu-ts';

import { cashuLog } from '../logger';

export const CASHU_NATIVE_CRYPTO_ENV = 'EXPO_PUBLIC_CASHU_NATIVE_CRYPTO' as const;

/**
 * A synthetic keyset. Only `id` and the denomination set matter here: the
 * blinded point is `Y + rG`, which does not depend on the mint's public keys,
 * and the keyset id is what feeds NUT-13 secret derivation. Using a fixed
 * keyset keeps the self-test independent of which mints happen to be loaded.
 */
function syntheticKeyset(id: string): HasKeysetKeys {
  const keys: Record<string, string> = {};
  for (let i = 0; i < 32; i++) {
    // Any valid compressed point; never used in the comparison.
    keys[String(2 ** i)] = '02'.padEnd(66, 'a');
  }
  return { id, keys };
}

// Fixed, non-secret vector. Deliberately NOT the user's seed — the self-test
// must never touch real key material.
const SELF_TEST_SEED = new Uint8Array(64).fill(7);

// Both keyset-id families: v1 (hex) and v2 (version byte 01, HMAC derivation).
const V1_KEYSET = syntheticKeyset('009a1f293253e41e');
const V2_KEYSET = syntheticKeyset(
  '012e23479a0029432eaad0d2040c09be53bab592d5cbf1d55e0dd26c9495951b30'
);

function sameOutput(a: OutputData, b: OutputData): boolean {
  if (a.blindedMessage.B_ !== b.blindedMessage.B_) return false;
  if (a.blindedMessage.id !== b.blindedMessage.id) return false;
  if (a.blindedMessage.amount.toNumber() !== b.blindedMessage.amount.toNumber()) return false;
  if (a.blindingFactor !== b.blindingFactor) return false;
  if (a.secret.length !== b.secret.length) return false;
  return a.secret.every((byte, index) => byte === b.secret[index]);
}

function sameOutputs(a: OutputData[], b: OutputData[]): boolean {
  return a.length === b.length && a.every((output, index) => sameOutput(output, b[index]!));
}

type SelfTestCase = {
  readonly name: string;
  readonly run: (creator: OutputDataCreator) => OutputData[];
};

/**
 * The vectors that matter. The restore case is first because it is the one that
 * loses funds silently when it is wrong.
 */
const SELF_TEST_CASES: readonly SelfTestCase[] = [
  {
    // coco's restore batch shape: amount 0 with an all-zero custom split. A
    // splitter that treats 0 as "skip" returns [] here and restore finds
    // nothing while reporting success.
    name: 'restore_zero_split',
    run: (creator) =>
      creator.createDeterministicData(0, SELF_TEST_SEED, 0, V2_KEYSET, new Array(8).fill(0)),
  },
  {
    // Same shape at a non-zero starting counter, since NUT-13 derivation is
    // counter-indexed.
    name: 'restore_zero_split_offset',
    run: (creator) =>
      creator.createDeterministicData(0, SELF_TEST_SEED, 1234, V1_KEYSET, new Array(4).fill(0)),
  },
  {
    name: 'deterministic_split',
    run: (creator) => creator.createDeterministicData(1023, SELF_TEST_SEED, 42, V1_KEYSET),
  },
  {
    name: 'deterministic_single',
    run: (creator) => [creator.createSingleDeterministicData(1, SELF_TEST_SEED, 7, V1_KEYSET.id)],
  },
];

/** The stock cashu-ts implementation, used as the reference. */
const referenceCreator: OutputDataCreator = OutputData;

export type OutputDataImpl = 'cdk-native' | 'cashu-ts';

function roundMs(ms: number): number {
  return Math.round(ms * 100) / 100;
}

// ─── Unblinding cost probe ──────────────────────────────────────────────────
//
// The native creator covers BLINDING only — 1.4% of a measured 102s recovery.
// The other 98% is cashu-ts `OutputData.toProof`: per restored proof it does
// ~2000 elliptic-curve point operations in JS (three point decompressions, four
// blinded 384-bit scalar multiplications, ~10 field inversions), and DLEQ
// verification is roughly three quarters of that.
//
// CDK's own restore does not verify DLEQ at all, so skipping it is a real
// option — but only worth taking if mints actually return DLEQ here and it
// actually costs what the code shape suggests. This probe answers both without
// changing behaviour. Strip it once the question is settled.

const UNBLIND_SAMPLE_SIZE = 100;

let unblindCount = 0;
let unblindMs = 0;
let unblindWithDleq = 0;

/**
 * Lifetime crypto tallies, for the recovery benchmark to diff around a run.
 * Monotonic and never reset by the sampler, so callers take snapshots and
 * subtract rather than coordinating ownership of a shared counter.
 */
export interface CryptoCounters {
  /** Deterministic/random/P2PK batch calls. */
  blindCalls: number;
  /** Blinded outputs produced — during a restore this IS counters scanned. */
  blindOutputs: number;
  blindMs: number;
  /** `toProof` calls — during a restore this is proofs the mint had signed. */
  unblindProofs: number;
  unblindMs: number;
  unblindWithDleq: number;
}

const totals: CryptoCounters = {
  blindCalls: 0,
  blindOutputs: 0,
  blindMs: 0,
  unblindProofs: 0,
  unblindMs: 0,
  unblindWithDleq: 0,
};

export function snapshotCryptoCounters(): CryptoCounters {
  return { ...totals };
}

/** Difference between two snapshots, for "what did this mint cost". */
export function diffCryptoCounters(from: CryptoCounters, to: CryptoCounters): CryptoCounters {
  return {
    blindCalls: to.blindCalls - from.blindCalls,
    blindOutputs: to.blindOutputs - from.blindOutputs,
    blindMs: to.blindMs - from.blindMs,
    unblindProofs: to.unblindProofs - from.unblindProofs,
    unblindMs: to.unblindMs - from.unblindMs,
    unblindWithDleq: to.unblindWithDleq - from.unblindWithDleq,
  };
}

function reportUnblindSample(): void {
  cashuLog.info('cashu.unblind.sample', {
    impl: activeImpl(),
    proofs: unblindCount,
    duration_ms: roundMs(unblindMs),
    ms_per_proof: roundMs(unblindMs / unblindCount),
    dleq_ratio: roundMs(unblindWithDleq / unblindCount),
  });
  unblindCount = 0;
  unblindMs = 0;
  unblindWithDleq = 0;
}

/**
 * Times `toProof` on each output and records whether the mint attached a DLEQ.
 * Patches the instance rather than wrapping it: cashu-ts mutates
 * `blindedMessage.amount` on the way past (`Wallet.restore`), so a proxy would
 * have to forward every property faithfully for no benefit.
 */
function probeUnblindCost(outputs: OutputDataLike[]): OutputDataLike[] {
  for (const output of outputs) {
    const original = output.toProof.bind(output);
    output.toProof = (signature, keyset) => {
      const start = performance.now();
      try {
        return original(signature, keyset);
      } finally {
        const elapsed = performance.now() - start;
        unblindMs += elapsed;
        unblindCount += 1;
        totals.unblindProofs += 1;
        totals.unblindMs += elapsed;
        if (signature?.dleq) {
          unblindWithDleq += 1;
          totals.unblindWithDleq += 1;
        }
        if (unblindCount >= UNBLIND_SAMPLE_SIZE) reportUnblindSample();
      }
    };
  }
  return outputs;
}

// ─── Which implementation is live ───────────────────────────────────────────
//
// Set once at Manager init, then selected per call. Switching at runtime is
// safe ONLY because `nativeCreator` is non-null exclusively after the self-test
// has proven it byte-identical to cashu-ts across every vector — the two are
// interchangeable by construction, so a counter blinded by one and unblinded by
// the other still lines up. Do not relax that self-test to make this toggle
// work in more cases; the whole safety argument rests on it.
//
// It is still a per-RUN switch, not a per-operation one: the recovery screen
// disables the toggle while a run is in flight.

let nativeCreator: OutputDataCreator | null = null;
let nativeDisabled = false;

export function isNativeCryptoAvailable(): boolean {
  return nativeCreator !== null;
}

/**
 * The proven native creator, for the micro-benchmark to time directly rather
 * than through the switching wrapper (whose per-call logging would dominate a
 * microsecond measurement). Null unless the self-test passed.
 */
export function loadNativeCreatorForBench(): OutputDataCreator | null {
  return nativeCreator;
}

export function isNativeCryptoEnabled(): boolean {
  return nativeCreator !== null && !nativeDisabled;
}

/** Force the JS path, for A/B benchmarking against the native one. */
export function setNativeCryptoEnabled(enabled: boolean): void {
  nativeDisabled = !enabled;
  cashuLog.info('cashu.native_crypto.toggled', {
    requested: enabled,
    available: nativeCreator !== null,
    effective: isNativeCryptoEnabled() ? 'cdk-native' : 'cashu-ts',
  });
}

function activeImpl(): OutputDataImpl {
  return isNativeCryptoEnabled() ? 'cdk-native' : 'cashu-ts';
}

function activeCreator(): OutputDataCreator {
  return isNativeCryptoEnabled() && nativeCreator ? nativeCreator : referenceCreator;
}

/**
 * The single creator handed to coco. It resolves native-vs-JS per call, so the
 * benchmark toggle takes effect without re-initialising the Manager (which
 * would mean tearing down the wallet's database handles mid-session).
 *
 * Each call logs the implementation that ran it, the output count, and the
 * wall-clock cost. Batch calls (a 100-output restore batch, a send's keep/send
 * splits) log at info; the `single` variants log at debug because melt change
 * creates blank outputs in a per-output loop and would flood the log at info.
 */
function createSwitchingCreator(): OutputDataCreator {
  function timed<T>(
    level: 'info' | 'debug',
    op: string,
    fields: Record<string, unknown>,
    run: (creator: OutputDataCreator) => T,
    outputCount: (result: T) => number
  ): T {
    const impl = activeImpl();
    const start = performance.now();
    const result = run(activeCreator());
    const elapsed = performance.now() - start;
    const outputs = outputCount(result);
    totals.blindCalls += 1;
    totals.blindOutputs += outputs;
    totals.blindMs += elapsed;
    cashuLog[level]('cashu.output_data.created', {
      impl,
      op,
      ...fields,
      outputs,
      duration_ms: roundMs(elapsed),
    });
    return result;
  }
  const many = (outputs: OutputDataLike[]) => outputs.length;
  const one = () => 1;

  return {
    createDeterministicData: (amount, seed, counter, keyset, customSplit) =>
      timed(
        'info',
        'deterministic',
        { keysetId: keyset.id, counter },
        // Restore's batches come through here, so this is where the unblinding
        // probe is armed.
        (creator) =>
          probeUnblindCost(
            creator.createDeterministicData(amount, seed, counter, keyset, customSplit)
          ),
        many
      ),
    createSingleDeterministicData: (amount, seed, counter, keysetId) =>
      timed(
        'debug',
        'deterministic_single',
        { keysetId, counter },
        (creator) => creator.createSingleDeterministicData(amount, seed, counter, keysetId),
        one
      ),
    createRandomData: (amount, keyset, customSplit) =>
      timed(
        'info',
        'random',
        { keysetId: keyset.id },
        (creator) => creator.createRandomData(amount, keyset, customSplit),
        many
      ),
    createSingleRandomData: (amount, keysetId) =>
      timed(
        'debug',
        'random_single',
        { keysetId },
        (creator) => creator.createSingleRandomData(amount, keysetId),
        one
      ),
    createP2PKData: (p2pk, amount, keyset, customSplit) =>
      timed(
        'info',
        'p2pk',
        { keysetId: keyset.id },
        (creator) => creator.createP2PKData(p2pk, amount, keyset, customSplit),
        many
      ),
    createSingleP2PKData: (p2pk, amount, keysetId) =>
      timed(
        'debug',
        'p2pk_single',
        { keysetId },
        (creator) => creator.createSingleP2PKData(p2pk, amount, keysetId),
        one
      ),
  };
}

/**
 * Loads the native module. Returns null in any environment without it (Node,
 * Vitest, Jest, or a build where the native side failed to link).
 */
function loadNative(): OutputDataCreator | null {
  try {
    // Deliberately lazy + guarded: importing this module instantiates the Nitro
    // HybridObject, which throws outside a React Native runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('@cashudevkit/react-native/native') as {
      cashuOutputDataCreator?: OutputDataCreator;
    };
    return native.cashuOutputDataCreator ?? null;
  } catch (error) {
    cashuLog.info('cashu.native_crypto.unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Returns the creator for coco's seam — always instrumented, so runtime logs
 * name the implementation behind every blinding call. The native creator is
 * used only if it is enabled AND provably byte-identical to cashu-ts across
 * every vector; otherwise this returns instrumented stock cashu-ts, which is
 * behaviorally identical to coco's own default.
 */
export function resolveOutputDataCreator(): OutputDataCreator {
  // One creator object for the Manager's lifetime; which implementation it
  // delegates to is decided per call, so the benchmark toggle does not require
  // re-initialising the Manager. `nativeCreator` stays null unless the
  // self-test below passes, and the toggle can only pick something that proved
  // itself byte-identical.
  nativeCreator = null;
  const reference = () => createSwitchingCreator();

  // Native is the default. The gate that matters is the byte-identical
  // self-test below, not an env var: this used to require
  // EXPO_PUBLIC_CASHU_NATIVE_CRYPTO=1, which lived only in a local .env that
  // .easignore excludes from uploads and no eas.json profile set — so every
  // shipped build silently ran stock cashu-ts. Set the var to '0' to force the
  // JS path (a kill switch for debugging, not the normal route).
  if (process.env[CASHU_NATIVE_CRYPTO_ENV] === '0') {
    cashuLog.info('cashu.native_crypto.disabled', { reason: 'env_opt_out' });
    return reference();
  }

  const native = loadNative();
  if (!native) return reference();

  // The self-test runs every vector through both implementations anyway, so
  // time them: native_ms vs cashu_ts_ms in the `enabled` log is a free
  // on-device benchmark of the exact restore-shaped workload.
  let nativeMs = 0;
  let cashuTsMs = 0;
  for (const testCase of SELF_TEST_CASES) {
    let matched = false;
    try {
      const nativeStart = performance.now();
      const nativeOutputs = testCase.run(native);
      nativeMs += performance.now() - nativeStart;
      const referenceStart = performance.now();
      const referenceOutputs = testCase.run(referenceCreator);
      cashuTsMs += performance.now() - referenceStart;
      matched = sameOutputs(nativeOutputs, referenceOutputs);
    } catch (error) {
      cashuLog.error('cashu.native_crypto.self_test_threw', {
        case: testCase.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return reference();
    }
    if (!matched) {
      cashuLog.error('cashu.native_crypto.self_test_mismatch', { case: testCase.name });
      return reference();
    }
  }

  // Proven interchangeable — only now may the toggle select it.
  nativeCreator = native;
  cashuLog.info('cashu.native_crypto.enabled', {
    cases: SELF_TEST_CASES.length,
    native_ms: roundMs(nativeMs),
    cashu_ts_ms: roundMs(cashuTsMs),
    // The self-test is itself a like-for-like micro-benchmark of the exact
    // restore-shaped workload, so this ratio is the blinding speedup.
    speedup: cashuTsMs > 0 && nativeMs > 0 ? roundMs(cashuTsMs / nativeMs) : null,
  });
  return createSwitchingCreator();
}
