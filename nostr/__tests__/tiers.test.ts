import { describe, test, expect, vi } from 'vitest';
import {
  resolveAcrossTiers,
  applyOrderingManifest,
  synthesizeRecencyManifest,
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

describe('applyOrderingManifest — anti-reshuffle', () => {
  const bundle = { a: 'A', b: 'B', c: 'C' };

  test('renders strictly by the manifest order, not the bundle order', () => {
    const out = applyOrderingManifest({ orderBy: 'rank', elements: ['c', 'a', 'b'] }, bundle);
    expect(out).toEqual(['C', 'A', 'B']);
  });

  test('skips a manifest id absent from the bundle and reports it', () => {
    const missing: string[] = [];
    const out = applyOrderingManifest(
      { orderBy: 'rank', elements: ['a', 'missing', 'b'] },
      bundle,
      { onMissing: (id) => missing.push(id) },
    );
    expect(out).toEqual(['A', 'B']);
    expect(missing).toEqual(['missing']);
  });

  test('does NOT render bundle entries absent from the manifest', () => {
    const out = applyOrderingManifest({ orderBy: 'rank', elements: ['a'] }, bundle);
    expect(out).toEqual(['A']);
  });

  test('renders each id at most once even if the manifest repeats it', () => {
    const out = applyOrderingManifest({ orderBy: 'rank', elements: ['a', 'a', 'b'] }, bundle);
    expect(out).toEqual(['A', 'B']);
  });

  test('accepts a Map bundle as well as a record', () => {
    const map = new Map(Object.entries(bundle));
    const out = applyOrderingManifest({ orderBy: 'rank', elements: ['b', 'c'] }, map);
    expect(out).toEqual(['B', 'C']);
  });
});

describe('synthesizeRecencyManifest — relay floor', () => {
  test('orders newest-first with a stable id tiebreak on equal created_at', () => {
    const manifest = synthesizeRecencyManifest([
      { id: 'x', created_at: 100 },
      { id: 'y', created_at: 200 },
      { id: 'a', created_at: 100 },
    ]);
    expect(manifest.orderBy).toBe('created_at');
    // 200 first; then the two 100s tiebreak by id descending (x before a).
    expect(manifest.elements).toEqual(['y', 'x', 'a']);
  });

  test('round-trips through applyOrderingManifest to a coherent ordered set', () => {
    const events = [
      { id: 'old', created_at: 1 },
      { id: 'new', created_at: 9 },
    ];
    const bundle = { old: events[0], new: events[1] };
    const manifest = synthesizeRecencyManifest(events);
    const out = applyOrderingManifest(manifest, bundle);
    expect(out.map((e) => e.id)).toEqual(['new', 'old']);
  });
});
