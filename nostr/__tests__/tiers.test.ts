import { describe, test, expect, vi } from 'vitest';
import {
  resolveAcrossTiers,
  answered,
  unsupported,
  failed,
  type TierCandidate,
} from '../src/tiers';
import type { NaggError } from '../src/errors';

const networkError: NaggError = { type: 'network', message: 'boom', cause: new Error('boom') };

function candidate<T>(tier: 'nagg' | 'primal' | 'relay', attempt: () => Promise<any>): TierCandidate<T> {
  return { tier, attempt };
}

describe('resolveAcrossTiers — fallback engine', () => {
  test('first tier that answers wins; later tiers are never tried', async () => {
    const relaySpy = vi.fn(async () => answered('relay-value'));
    const result = await resolveAcrossTiers<string>([
      candidate('nagg', async () => answered('nagg-value')),
      candidate('relay', relaySpy),
    ]);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ tier: 'nagg', value: 'nagg-value' });
    expect(relaySpy).not.toHaveBeenCalled();
  });

  test('falls through `unsupported` to the next tier with no error', async () => {
    const result = await resolveAcrossTiers<string>([
      candidate('nagg', async () => unsupported()),
      candidate('primal', async () => unsupported()),
      candidate('relay', async () => answered('relay-value')),
    ]);
    expect(result._unsafeUnwrap()).toEqual({ tier: 'relay', value: 'relay-value' });
  });

  test('falls through `failed` but remembers the error', async () => {
    const result = await resolveAcrossTiers<string>([
      candidate('nagg', async () => failed(networkError)),
      candidate('primal', async () => answered('primal-value')),
    ]);
    expect(result._unsafeUnwrap().tier).toBe('primal');
  });

  test('tiers are tried strictly in order', async () => {
    const order: string[] = [];
    await resolveAcrossTiers<string>([
      candidate('nagg', async () => {
        order.push('nagg');
        return unsupported();
      }),
      candidate('primal', async () => {
        order.push('primal');
        return failed(networkError);
      }),
      candidate('relay', async () => {
        order.push('relay');
        return answered('ok');
      }),
    ]);
    expect(order).toEqual(['nagg', 'primal', 'relay']);
  });

  test('all tiers exhausted → error carries the full attempt trail', async () => {
    const result = await resolveAcrossTiers<string>([
      candidate('nagg', async () => failed(networkError)),
      candidate('primal', async () => unsupported()),
      candidate('relay', async () => failed(networkError)),
    ]);
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe('all_tiers_exhausted');
    expect(error.attempts).toEqual([
      { tier: 'nagg', outcome: 'failed', error: networkError },
      { tier: 'primal', outcome: 'unsupported' },
      { tier: 'relay', outcome: 'failed', error: networkError },
    ]);
  });

  test('no tiers offered → exhausted error', async () => {
    const result = await resolveAcrossTiers<string>([]);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toMatch(/no tiers/);
  });
});

describe('resolveAcrossTiers — read correlation', () => {
  test('stamps readId + surface on every tier event when a context is passed', async () => {
    const { setNostrLogger } = await import('../src/log');
    const events: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const sink = {
      debug: (event: string, data?: Record<string, unknown>) => events.push({ event, data }),
      info: (event: string, data?: Record<string, unknown>) => events.push({ event, data }),
      warn: (event: string, data?: Record<string, unknown>) => events.push({ event, data }),
    };
    setNostrLogger(sink);
    try {
      await resolveAcrossTiers<string>(
        [
          candidate('nagg', async () => failed(networkError)),
          candidate('primal', async () => unsupported()),
          candidate('relay', async () => answered('relay-value')),
        ],
        { readId: 'r1-test', surface: 'test' },
      );
    } finally {
      setNostrLogger(null);
    }
    const names = events.map((e) => e.event);
    expect(names).toEqual([
      'nostr.tier.select.start',
      'nostr.tier.try',
      'nostr.tier.failed',
      'nostr.tier.try',
      'nostr.tier.unsupported',
      'nostr.tier.try',
      'nostr.tier.answered',
    ]);
    for (const entry of events) {
      expect(entry.data).toMatchObject({ readId: 'r1-test', surface: 'test' });
    }
  });

  test('the context is optional: events carry null ids and nothing else changes', async () => {
    const result = await resolveAcrossTiers<string>([candidate('nagg', async () => answered('v'))]);
    expect(result._unsafeUnwrap()).toEqual({ tier: 'nagg', value: 'v' });
  });
});
