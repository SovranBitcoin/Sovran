/**
 * @jest-environment node
 */

import { OutputData, type HasKeysetKeys } from '@cashu/cashu-ts';

import {
  beginRecoveryBenchmark,
  endRecoveryBenchmark,
  markMintStart,
  recordMintBenchmark,
  recordProbePhase,
} from '@/shared/lib/cashu/recoveryBenchmark';
import { resolveOutputDataCreator } from '@/shared/lib/cashu/nativeOutputDataCreator';

jest.mock('@/shared/lib/logger', () => ({
  __esModule: true,
  cashuLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { cashuLog } = jest.requireMock('@/shared/lib/logger') as {
  cashuLog: Record<'debug' | 'info' | 'warn' | 'error', jest.Mock>;
};

const SEED = new Uint8Array(64).fill(3);
const KEYSET: HasKeysetKeys = {
  id: '009a1f293253e41e',
  keys: Object.fromEntries(
    Array.from({ length: 32 }, (_, i) => [String(2 ** i), '02'.padEnd(66, 'a')])
  ),
};

function summary(): Record<string, unknown> | undefined {
  const call = cashuLog.info.mock.calls.find(([event]) => event === 'recovery.benchmark');
  return call?.[1] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('recovery benchmark', () => {
  it('reports the scope of the run: mints, keysets and counters scanned', () => {
    const creator = resolveOutputDataCreator();
    beginRecoveryBenchmark({ knownMints: 2, probeCandidates: 0 });

    const before = markMintStart();
    // A restore batch blinds one output per counter it probes, so blinded
    // outputs ARE the NUT-13 counter space walked.
    creator.createDeterministicData(0, SEED, 0, KEYSET, new Array(100).fill(0));
    creator.createDeterministicData(0, SEED, 100, KEYSET, new Array(100).fill(0));
    recordMintBenchmark(
      {
        mintUrl: 'https://mint.example',
        isDiscovered: false,
        status: 'done',
        keysetsTotal: 3,
        keysetsAttempted: 3,
        keysetsSkipped: 0,
        keysetsAlreadyRecovered: 0,
        keysetsFailed: 0,
        proofsReady: 0,
        proofsSpent: 0,
        durationMs: 1234,
      },
      before
    );

    endRecoveryBenchmark();

    const fields = summary();
    expect(fields).toMatchObject({
      mints: 1,
      knownMints: 2,
      keysets: 3,
      keysetsAttempted: 3,
      countersScanned: 200,
    });
    expect(typeof fields?.total_ms).toBe('number');
    expect(typeof fields?.blind_ms).toBe('number');
  });

  it('names the implementation the run used, so two runs can be compared', () => {
    resolveOutputDataCreator();
    beginRecoveryBenchmark({ knownMints: 1, probeCandidates: 0 });
    endRecoveryBenchmark();

    // Node has no Nitro runtime, so the native load fails and the switch
    // resolves to the JS path.
    expect(summary()).toMatchObject({ impl: 'cashu-ts' });
  });

  it('separates probe candidates from probe hits', () => {
    resolveOutputDataCreator();
    beginRecoveryBenchmark({ knownMints: 1, probeCandidates: 40 });
    recordProbePhase({ hits: 2, durationMs: 500 });
    endRecoveryBenchmark();

    expect(summary()).toMatchObject({ probeCandidates: 40, probeHits: 2 });
  });

  it('attributes each mint separately', () => {
    const creator = resolveOutputDataCreator();
    beginRecoveryBenchmark({ knownMints: 2, probeCandidates: 0 });

    const first = markMintStart();
    creator.createDeterministicData(0, SEED, 0, KEYSET, new Array(50).fill(0));
    recordMintBenchmark(
      {
        mintUrl: 'https://a.example',
        isDiscovered: false,
        status: 'done',
        keysetsTotal: 1,
        keysetsAttempted: 1,
        keysetsSkipped: 0,
        keysetsAlreadyRecovered: 0,
        keysetsFailed: 0,
        proofsReady: 0,
        proofsSpent: 0,
        durationMs: 10,
      },
      first
    );

    const second = markMintStart();
    creator.createDeterministicData(0, SEED, 0, KEYSET, new Array(10).fill(0));
    recordMintBenchmark(
      {
        mintUrl: 'https://b.example',
        isDiscovered: true,
        status: 'already-recovered',
        keysetsTotal: 2,
        keysetsAttempted: 2,
        keysetsSkipped: 0,
        keysetsAlreadyRecovered: 2,
        keysetsFailed: 0,
        proofsReady: 0,
        proofsSpent: 0,
        durationMs: 20,
      },
      second
    );

    const perMint = cashuLog.info.mock.calls
      .filter(([event]) => event === 'recovery.benchmark.mint')
      .map(([, fields]) => fields as Record<string, unknown>);

    // The second mint's counters must not include the first mint's.
    expect(perMint[0]).toMatchObject({ countersScanned: 50, keysets: 1 });
    expect(perMint[1]).toMatchObject({ countersScanned: 10, keysets: 2 });

    endRecoveryBenchmark();
    expect(summary()).toMatchObject({ mints: 2, keysets: 3, countersScanned: 60 });
  });

  it('never leaks a mint URL into the log', () => {
    resolveOutputDataCreator();
    beginRecoveryBenchmark({ knownMints: 1, probeCandidates: 0 });
    recordMintBenchmark(
      {
        mintUrl: 'https://secret-mint.example',
        isDiscovered: false,
        status: 'done',
        keysetsTotal: 1,
        keysetsAttempted: 1,
        keysetsSkipped: 0,
        keysetsAlreadyRecovered: 0,
        keysetsFailed: 0,
        proofsReady: 0,
        proofsSpent: 0,
        durationMs: 1,
      },
      markMintStart()
    );

    const logged = JSON.stringify(cashuLog.info.mock.calls);
    expect(logged).not.toContain('secret-mint.example');
    endRecoveryBenchmark();
  });

  it('reports how much of the unblinding was thrown away', () => {
    const creator = resolveOutputDataCreator();
    beginRecoveryBenchmark({ knownMints: 1, probeCandidates: 0 });
    const before = markMintStart();

    // Unblind four proofs so the summary has a per-proof rate to attribute the
    // wasted time with.
    const outputs = creator.createDeterministicData(0, SEED, 0, KEYSET, [0, 0, 0, 0]);
    const badSignature = { id: KEYSET.id, amount: 0, C_: 'nope' };
    for (const output of outputs) {
      expect(() => output.toProof(badSignature as never, KEYSET)).toThrow();
    }

    recordMintBenchmark(
      {
        mintUrl: 'https://mint.example',
        isDiscovered: false,
        status: 'done',
        keysetsTotal: 1,
        keysetsAttempted: 1,
        keysetsSkipped: 0,
        keysetsAlreadyRecovered: 0,
        keysetsFailed: 0,
        proofsReady: 1,
        proofsSpent: 3,
        durationMs: 1,
      },
      before
    );
    endRecoveryBenchmark();

    // The whole point of the field: three of four proofs cost full unblinding
    // and were then discarded as already spent.
    const fields = summary()!;
    expect(fields).toMatchObject({ proofsReady: 1, proofsSpent: 3, discard_ratio: 0.75 });

    // Wasted time is the measured per-proof rate applied to the discarded
    // proofs, so it must track `unblind_ms` at the discard ratio. (These four
    // proofs fail fast on a bad signature and cost ~0ms, so assert the
    // relationship rather than a magnitude.)
    expect(fields.wasted_unblind_ms).toBeCloseTo((fields.unblind_ms as number) * 0.75, 5);
  });

  it('ignores records when no run is active', () => {
    expect(() => {
      recordProbePhase({ hits: 1, durationMs: 1 });
      endRecoveryBenchmark();
    }).not.toThrow();
    expect(summary()).toBeUndefined();
  });
});

describe('unblinding measurement', () => {
  it('counts proofs and DLEQ presence through the creator', () => {
    const creator = resolveOutputDataCreator();
    beginRecoveryBenchmark({ knownMints: 1, probeCandidates: 0 });
    const before = markMintStart();

    const outputs = creator.createDeterministicData(0, SEED, 0, KEYSET, [0]);
    // A bad signature still exercises the probe's finally block.
    const badSignature = { id: KEYSET.id, amount: 0, C_: 'nope' };
    expect(() => outputs[0]!.toProof(badSignature as never, KEYSET)).toThrow();

    recordMintBenchmark(
      {
        mintUrl: 'https://mint.example',
        isDiscovered: false,
        status: 'done',
        keysetsTotal: 1,
        keysetsAttempted: 1,
        keysetsSkipped: 0,
        keysetsAlreadyRecovered: 0,
        keysetsFailed: 0,
        proofsReady: 0,
        proofsSpent: 0,
        durationMs: 1,
      },
      before
    );

    const perMint = cashuLog.info.mock.calls.find(
      ([event]) => event === 'recovery.benchmark.mint'
    )?.[1] as Record<string, unknown>;
    expect(perMint.proofsUnblinded).toBe(1);
    endRecoveryBenchmark();
  });

  it('does not alter the blinded output it measures', () => {
    const creator = resolveOutputDataCreator();
    const measured = creator.createDeterministicData(0, SEED, 7, KEYSET, [0, 0]);
    const reference = OutputData.createDeterministicData(0, SEED, 7, KEYSET, [0, 0]);

    measured.forEach((output, i) => {
      expect(output.blindedMessage.B_).toBe(reference[i]!.blindedMessage.B_);
      expect(output.blindingFactor).toBe(reference[i]!.blindingFactor);
    });
  });
});
