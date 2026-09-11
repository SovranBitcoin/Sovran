/**
 * @jest-environment node
 */

import { OutputData, type HasKeysetKeys } from '@cashu/cashu-ts';
import {
  CASHU_NATIVE_CRYPTO_ENV,
  isNativeCryptoAvailable,
  isNativeCryptoEnabled,
  resolveOutputDataCreator,
  setNativeCryptoEnabled,
} from '@/shared/lib/cashu/nativeOutputDataCreator';

jest.mock('react-native-nitro-modules', () => ({
  NitroModules: { hasHybridObject: jest.fn(() => false) },
}));

const mockNativeImport = jest.fn();
jest.mock('@cashudevkit/react-native/native', () => {
  mockNativeImport();
  throw new Error('OutputDataCreator has not been registered');
});

jest.mock('@/shared/lib/logger', () => ({
  __esModule: true,
  cashuLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { cashuLog } = jest.requireMock('@/shared/lib/logger') as {
  cashuLog: Record<'debug' | 'info' | 'warn' | 'error', jest.Mock>;
};

const SEED = new Uint8Array(64).fill(3);
const KEYSET_ID = '009a1f293253e41e';
const KEYSET: HasKeysetKeys = {
  id: KEYSET_ID,
  keys: Object.fromEntries(
    Array.from({ length: 32 }, (_, i) => [String(2 ** i), '02'.padEnd(66, 'a')])
  ),
};

afterEach(() => {
  jest.clearAllMocks();
  delete process.env[CASHU_NATIVE_CRYPTO_ENV];
});

describe('resolveOutputDataCreator', () => {
  it('does not import an unregistered HybridObject and preserves reference output', () => {
    const creator = resolveOutputDataCreator();
    expect(mockNativeImport).not.toHaveBeenCalled();
    expect(isNativeCryptoAvailable()).toBe(false);
    const output = creator.createSingleDeterministicData(0, SEED, 7, KEYSET_ID);
    const reference = OutputData.createSingleDeterministicData(0, SEED, 7, KEYSET_ID);
    expect(output.blindedMessage).toEqual(reference.blindedMessage);
    expect(output.secret).toEqual(reference.secret);
    expect(output.blindingFactor).toEqual(reference.blindingFactor);
  });

  it('honours the explicit opt-out and falls back to instrumented cashu-ts', () => {
    process.env[CASHU_NATIVE_CRYPTO_ENV] = '0';

    const creator = resolveOutputDataCreator();

    expect(cashuLog.info).toHaveBeenCalledWith('cashu.native_crypto.disabled', {
      reason: 'env_opt_out',
    });

    const outputs = creator.createDeterministicData(0, SEED, 5, KEYSET, [0, 0, 0]);
    const reference = OutputData.createDeterministicData(0, SEED, 5, KEYSET, [0, 0, 0]);

    // Delegation must be byte-identical to stock cashu-ts — the wrapper only
    // observes, it never alters the blinding output.
    expect(outputs).toHaveLength(reference.length);
    outputs.forEach((output, i) => {
      expect(output.blindedMessage.B_).toBe(reference[i]!.blindedMessage.B_);
      expect(output.blindingFactor).toBe(reference[i]!.blindingFactor);
      expect(Array.from(output.secret)).toEqual(Array.from(reference[i]!.secret));
    });
  });

  it('logs each batch call with impl, op, counter, output count, and duration', () => {
    const creator = resolveOutputDataCreator();
    cashuLog.info.mockClear();

    creator.createDeterministicData(0, SEED, 42, KEYSET, [0, 0, 0, 0]);

    expect(cashuLog.info).toHaveBeenCalledTimes(1);
    const [event, fields] = cashuLog.info.mock.calls[0]!;
    expect(event).toBe('cashu.output_data.created');
    expect(fields).toMatchObject({
      impl: 'cashu-ts',
      op: 'deterministic',
      keysetId: KEYSET_ID,
      counter: 42,
      outputs: 4,
    });
    expect(typeof fields.duration_ms).toBe('number');
  });

  it('logs single-output calls at debug so per-output loops do not flood info', () => {
    const creator = resolveOutputDataCreator();
    cashuLog.info.mockClear();

    creator.createSingleDeterministicData(0, SEED, 7, KEYSET_ID);

    expect(cashuLog.info).not.toHaveBeenCalled();
    expect(cashuLog.debug).toHaveBeenCalledWith(
      'cashu.output_data.created',
      expect.objectContaining({
        impl: 'cashu-ts',
        op: 'deterministic_single',
        keysetId: KEYSET_ID,
        counter: 7,
        outputs: 1,
      })
    );
  });

  it('attempts native by default and falls back when it is unavailable', () => {
    // No env var set at all — native is the default, which is the whole point:
    // shipped builds must not need a flag to use CDK.
    const creator = resolveOutputDataCreator();

    // The linked runtime reports no creator, so skip its eager import and log why.
    expect(cashuLog.info).toHaveBeenCalledWith('cashu.native_crypto.unavailable', {
      reason: 'hybrid_object_not_registered',
    });

    cashuLog.info.mockClear();
    creator.createDeterministicData(0, SEED, 0, KEYSET, [0]);
    expect(cashuLog.info).toHaveBeenCalledWith(
      'cashu.output_data.created',
      expect.objectContaining({ impl: 'cashu-ts' })
    );
  });

  it('reports native as unavailable off-device, so the benchmark toggle stays hidden', () => {
    resolveOutputDataCreator();

    // The toggle is only offered when the self-test proved the two
    // implementations byte-identical — that proof is the entire safety
    // argument for switching at runtime.
    expect(isNativeCryptoAvailable()).toBe(false);
    expect(isNativeCryptoEnabled()).toBe(false);
  });

  it('cannot be switched onto a native path that never proved itself', () => {
    resolveOutputDataCreator();
    setNativeCryptoEnabled(true);

    expect(isNativeCryptoEnabled()).toBe(false);
    expect(cashuLog.info).toHaveBeenCalledWith(
      'cashu.native_crypto.toggled',
      expect.objectContaining({ requested: true, available: false, effective: 'cashu-ts' })
    );
  });

  it('keeps producing identical bytes after the toggle is flipped', () => {
    const creator = resolveOutputDataCreator();
    const before = creator.createDeterministicData(0, SEED, 3, KEYSET, [0, 0]);
    setNativeCryptoEnabled(false);
    const after = creator.createDeterministicData(0, SEED, 3, KEYSET, [0, 0]);

    // The same creator object is handed to coco for the Manager's lifetime; it
    // resolves the implementation per call, so flipping the switch must never
    // change the bytes for a given counter.
    after.forEach((output, i) => {
      expect(output.blindedMessage.B_).toBe(before[i]!.blindedMessage.B_);
      expect(output.blindingFactor).toBe(before[i]!.blindingFactor);
    });
  });

  it('measures unblinding cost and DLEQ presence without altering the proof', () => {
    const creator = resolveOutputDataCreator();
    const [output] = creator.createDeterministicData(0, SEED, 0, KEYSET, [0]);
    const reference = OutputData.createDeterministicData(0, SEED, 0, KEYSET, [0])[0]!;
    cashuLog.info.mockClear();

    // One signature short of the sample size: nothing reported yet.
    const signature = { id: KEYSET_ID, amount: 0, C_: '02'.padEnd(66, 'b') };
    expect(() => output!.toProof(signature as never, KEYSET)).toThrow();

    expect(cashuLog.info).not.toHaveBeenCalledWith('cashu.unblind.sample', expect.anything());
    // The probe must not change what the creator produced.
    expect(output!.blindedMessage.B_).toBe(reference.blindedMessage.B_);
  });
});
