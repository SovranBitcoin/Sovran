/**
 * Pending-zap registry: TTL expiry, target normalization, receipt stamping,
 * consume-on-completion. The registry decides which melts get a 9734 attached,
 * so a stale or mis-keyed entry would decorate the wrong payment.
 */
import {
  clearPendingZaps,
  consumePendingZap,
  markPendingZapReceipt,
  peekPendingZap,
  registerPendingZap,
  type PendingZap,
} from '@/shared/stores/runtime/pendingZapStore';

function makeZap(overrides: Partial<PendingZap> = {}): PendingZap {
  return {
    meltTarget: 'alice@example.com',
    eventId: 'e'.repeat(64),
    eventKind: 1,
    authorPubkey: 'f'.repeat(64),
    contentPreview: 'gm',
    emoji: '👍',
    comment: 'Great post 👍',
    presetSats: 21,
    createdAt: Date.now(),
    ...overrides,
  };
}

afterEach(() => {
  clearPendingZaps();
  jest.useRealTimers();
});

describe('pendingZapStore', () => {
  it('peek is case/whitespace-insensitive on the melt target', () => {
    registerPendingZap(makeZap({ meltTarget: 'Alice@Example.com' }));
    expect(peekPendingZap(' alice@example.com ')).toMatchObject({ presetSats: 21 });
  });

  it('expires entries after the TTL so a stale zap cannot decorate a later payment', () => {
    jest.useFakeTimers({ now: 1_700_000_000_000 });
    registerPendingZap(makeZap({ createdAt: Date.now() }));
    expect(peekPendingZap('alice@example.com')).toBeDefined();
    jest.setSystemTime(1_700_000_000_000 + 16 * 60_000);
    expect(peekPendingZap('alice@example.com')).toBeUndefined();
  });

  it('stamps the receipt kind and survives until consumed', () => {
    registerPendingZap(makeZap());
    markPendingZapReceipt('alice@example.com', 'nip57');
    expect(peekPendingZap('alice@example.com')?.receiptKind).toBe('nip57');
    consumePendingZap('alice@example.com');
    expect(peekPendingZap('alice@example.com')).toBeUndefined();
  });

  it('re-registering the same target overwrites the previous zap context', () => {
    registerPendingZap(makeZap({ eventId: 'a'.repeat(64) }));
    registerPendingZap(makeZap({ eventId: 'b'.repeat(64) }));
    expect(peekPendingZap('alice@example.com')?.eventId).toBe('b'.repeat(64));
  });
});
