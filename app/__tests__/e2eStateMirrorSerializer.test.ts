// The real manifest imports every store module (heavy native transitive deps);
// the serializer/gate under test never touch it.
import { serializeStoreState } from '@/shared/lib/e2e/serializeStoreState';
import { isStateMirrorEnabled } from '@/shared/lib/e2e/stateMirror';

jest.mock('@/shared/lib/e2e/storeManifest', () => ({ E2E_STORE_MANIFEST: {} }));

const roundTrip = (value: unknown) => JSON.parse(serializeStoreState(value));

describe('serializeStoreState', () => {
  it('drops functions and keeps plain data', () => {
    expect(roundTrip({ amount: 21, send: () => {}, label: 'ok' })).toEqual({
      amount: 21,
      label: 'ok',
    });
  });

  it('tags Map and Set with reconstructible payloads', () => {
    expect(roundTrip({ m: new Map([['a', 1]]), s: new Set([1, 2]) })).toEqual({
      m: { __type: 'Map', entries: [['a', 1]] },
      s: { __type: 'Set', values: [1, 2] },
    });
  });

  it('stringifies BigInt and flattens Error', () => {
    expect(roundTrip({ n: 21000000n, e: new Error('boom') })).toEqual({
      n: '21000000',
      e: { __type: 'Error', message: 'boom' },
    });
  });

  it('breaks circular references instead of throwing', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(roundTrip(a)).toEqual({ name: 'a', self: '[Circular]' });
  });
});

describe('isStateMirrorEnabled', () => {
  const original = process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
    else process.env.EXPO_PUBLIC_E2E_STATE_MIRROR = original;
  });

  it('is off without the harness env flag', () => {
    delete process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
    expect(isStateMirrorEnabled()).toBe(false);
  });
});

describe('serializeStoreState size cap', () => {
  it('passes ordinary store state through as plain JSON', () => {
    expect(roundTrip({ a: 1, b: 'x' })).toEqual({ a: 1, b: 'x' });
  });

  it('turns a store that throws while serializing into an Error marker', () => {
    const hostile = {
      get boom(): never {
        throw new Error('getter failed');
      },
    };
    expect(roundTrip(hostile)).toEqual({ __type: 'Error', message: 'getter failed' });
  });

  it('keeps the message of a non-Error throwable', () => {
    const hostile = {
      get boom(): never {
        throw 'plain string failure';
      },
    };
    expect(roundTrip(hostile)).toEqual({ __type: 'Error', message: 'plain string failure' });
  });

  it('caps giant stores with a Truncated marker keeping the key list', () => {
    const giant = { blob: 'y'.repeat(300 * 1024), other: 1 };
    const parsed = roundTrip(giant);
    expect(parsed.__type).toBe('Truncated');
    expect(parsed.bytes).toBeGreaterThan(256 * 1024);
    expect(parsed.keys).toEqual(['blob', 'other']);
  });
});
