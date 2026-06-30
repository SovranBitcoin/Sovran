/**
 * Pins the NIP-46 wire/grant contracts. The load-bearing case: a wildcard
 * `sign_event` grant (no kind qualifier) must be unrepresentable — every
 * other module trusts GrantKeySchema/isGrantKey to enforce that.
 */

import {
  GrantKeySchema,
  isGrantKey,
  PermTokenSchema,
  RpcRequestSchema,
  RpcResponseSchema,
  UnsignedEventSchema,
} from '@/features/nostrSigner/lib/nip46Types';

describe('GrantKeySchema', () => {
  it.each([
    'sign_event:0',
    'sign_event:1',
    'sign_event:65535',
    'nip04_encrypt',
    'nip04_decrypt',
    'nip44_encrypt',
    'nip44_decrypt',
  ])('accepts %s', (key) => {
    expect(GrantKeySchema.safeParse(key).success).toBe(true);
    expect(isGrantKey(key)).toBe(true);
  });

  it('rejects the wildcard sign_event grant', () => {
    expect(GrantKeySchema.safeParse('sign_event').success).toBe(false);
    expect(isGrantKey('sign_event')).toBe(false);
  });

  it.each([
    'sign_event:',
    'sign_event:-1',
    'sign_event:1.5',
    'sign_event:65536',
    'sign_event:99999',
    'sign_event:007',
    'sign_event:1e2',
    'sign_event:1 ',
    'ping',
    'get_public_key',
    'connect',
    'nip04',
    '',
  ])('rejects %j', (key) => {
    expect(GrantKeySchema.safeParse(key).success).toBe(false);
    expect(isGrantKey(key)).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(GrantKeySchema.safeParse(42).success).toBe(false);
    expect(GrantKeySchema.safeParse(null).success).toBe(false);
  });
});

describe('RpcRequestSchema', () => {
  const valid = { id: 'req-1', method: 'sign_event', params: ['{}'] };

  it('parses a well-formed request and strips unknown keys', () => {
    const result = RpcRequestSchema.safeParse({ ...valid, extra: 'ignored' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(valid);
      expect('extra' in result.data).toBe(false);
    }
  });

  it('rejects ids outside 1..64 chars', () => {
    expect(RpcRequestSchema.safeParse({ ...valid, id: '' }).success).toBe(false);
    expect(RpcRequestSchema.safeParse({ ...valid, id: 'x'.repeat(65) }).success).toBe(false);
  });

  it('rejects unknown methods and non-string params', () => {
    expect(RpcRequestSchema.safeParse({ ...valid, method: 'sign_anything' }).success).toBe(false);
    expect(RpcRequestSchema.safeParse({ ...valid, params: [1] }).success).toBe(false);
    expect(RpcRequestSchema.safeParse({ id: 'a', method: 'ping' }).success).toBe(false);
  });
});

describe('RpcResponseSchema', () => {
  it('allows result-only, error-only, and bare-ack shapes', () => {
    expect(RpcResponseSchema.safeParse({ id: 'a', result: 'ack' }).success).toBe(true);
    expect(RpcResponseSchema.safeParse({ id: 'a', error: 'Not authorized' }).success).toBe(true);
    expect(RpcResponseSchema.safeParse({ id: 'a' }).success).toBe(true);
  });

  it('rejects a missing id', () => {
    expect(RpcResponseSchema.safeParse({ result: 'ack' }).success).toBe(false);
  });
});

describe('UnsignedEventSchema', () => {
  const valid = {
    kind: 1,
    content: 'hello',
    tags: [['p', 'a'.repeat(64)]],
    created_at: 1_700_000_000,
  };

  it('parses a valid unsigned event and passes through extra keys', () => {
    const result = UnsignedEventSchema.safeParse({ ...valid, pubkey: 'b'.repeat(64) });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pubkey).toBe('b'.repeat(64));
  });

  it.each([
    ['kind above 65535', { ...valid, kind: 65536 }],
    ['negative kind', { ...valid, kind: -1 }],
    ['fractional kind', { ...valid, kind: 1.5 }],
    ['millisecond created_at', { ...valid, created_at: Date.now() }],
    ['negative created_at', { ...valid, created_at: -1 }],
    ['non-string tag element', { ...valid, tags: [['p', 7]] }],
    ['flat tags array', { ...valid, tags: ['p'] }],
    ['missing content', { kind: 1, tags: [], created_at: 1_700_000_000 }],
  ])('rejects %s', (_label, event) => {
    expect(UnsignedEventSchema.safeParse(event).success).toBe(false);
  });
});

describe('PermTokenSchema', () => {
  it('parses method-only and method:kind tokens', () => {
    expect(PermTokenSchema.safeParse({ method: 'nip44_encrypt' }).success).toBe(true);
    expect(PermTokenSchema.safeParse({ method: 'sign_event', kind: 1 }).success).toBe(true);
  });

  it('rejects unknown methods, out-of-range kinds, and stray keys', () => {
    expect(PermTokenSchema.safeParse({ method: 'sign' }).success).toBe(false);
    expect(PermTokenSchema.safeParse({ method: 'sign_event', kind: 65536 }).success).toBe(false);
    expect(PermTokenSchema.safeParse({ method: 'ping', extra: true }).success).toBe(false);
  });
});
