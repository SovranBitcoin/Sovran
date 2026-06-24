import { compactValue, redactKnownSecretSubstrings } from '@/shared/lib/loggerValueCompact';

const OPTS = { maxStringLength: 120, maxArrayItems: 5, maxDepth: 4, maxObjectKeys: 15 };

describe('compactValue — structural compaction', () => {
  it('passes primitives through untouched', () => {
    expect(compactValue(42, OPTS)).toBe(42);
    expect(compactValue(true, OPTS)).toBe(true);
    expect(compactValue(null, OPTS)).toBe(null);
    expect(compactValue(undefined, OPTS)).toBe(undefined);
    expect(compactValue('short', OPTS)).toBe('short');
  });

  it('truncates long arrays and notes the remainder', () => {
    const result = compactValue([1, 2, 3, 4, 5, 6, 7], OPTS) as unknown[];
    expect(result.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(result[5]).toBe('…2 more');
  });

  it('caps object keys at maxObjectKeys with a _more marker', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 20; i++) obj[`k${i}`] = i;
    const result = compactValue(obj, { ...OPTS, maxObjectKeys: 3 }) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['k0', 'k1', 'k2', '…17_more']);
  });

  it('summarizes a Uint8Array as a buffer brand (never the bytes)', () => {
    expect(compactValue(new Uint8Array([1, 2, 3, 4]), OPTS)).toEqual({ _kind: 'buffer', bytes: 4 });
  });

  it('summarizes Error / Date / Map / Set without leaking structure', () => {
    expect(compactValue(new Date('2026-01-01T00:00:00.000Z'), OPTS)).toEqual({
      _kind: 'date',
      iso: '2026-01-01T00:00:00.000Z',
    });
    const err = compactValue(new Error('boom'), OPTS) as { _kind: string; message: string };
    expect(err._kind).toBe('error');
    expect(err.message).toBe('boom');
    expect(compactValue(new Set([1, 2]), OPTS)).toMatchObject({ _kind: 'set', size: 2 });
    expect(compactValue(new Map([['a', 1]]), OPTS)).toMatchObject({ _kind: 'map', size: 1 });
  });

  it('collapses objects past maxDepth instead of recursing forever', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const result = compactValue(deep, { ...OPTS, maxDepth: 2 });
    expect(JSON.stringify(result)).toContain('_kind');
  });
});

describe('compactValue — field-name driven redaction', () => {
  it('brands a value under a sensitive field name even when the value looks innocent', () => {
    expect(compactValue('whatever', OPTS, 0, 'privateKey')).toEqual({
      _kind: 'private_key',
      len: 8,
    });
    expect(compactValue('seedphrase here', OPTS, 0, 'mnemonic')).toEqual({
      _kind: 'secret',
      len: 15,
    });
    expect(compactValue('Bearer abc', OPTS, 0, 'authorization')).toEqual({
      _kind: 'secret',
      len: 10,
    });
  });

  it('prefers a specifically branded secret value over the field-derived kind', () => {
    const nsec = 'nsec1' + 'q'.repeat(58);
    expect(compactValue(nsec, OPTS, 0, 'someKey')).toMatchObject({ _kind: 'nsec' });
  });
});

describe('redactKnownSecretSubstrings', () => {
  it('replaces embedded secrets but leaves plain text intact', () => {
    expect(redactKnownSecretSubstrings('all good here')).toBe('all good here');
    const out = redactKnownSecretSubstrings(`token=${'eyJabc.eyJdef.sig'}`);
    expect(out).toContain('<REDACTED:jwt>');
  });
});
