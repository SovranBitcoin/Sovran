import { test, expect, describe } from 'bun:test';

import { parsePorcelain, isDirty, classifyForkSync } from '../git.mjs';
import { isValidAdpId, classifyAdp } from '../adp.mjs';

describe('git predicates', () => {
  test('parsePorcelain splits status + file', () => {
    const out = ' M shared/config/backend.ts\n?? new.txt';
    expect(parsePorcelain(out)).toEqual([
      { status: 'M', file: 'shared/config/backend.ts' },
      { status: '??', file: 'new.txt' },
    ]);
  });

  test('isDirty true/false', () => {
    expect(isDirty('')).toBe(false);
    expect(isDirty(' M a.ts')).toBe(true);
  });

  test('classifyForkSync covers all relations', () => {
    expect(classifyForkSync({ localSha: 'x', upstreamSha: 'x', mergeBaseSha: 'x' }).action).toBe(
      'up-to-date'
    );
    expect(classifyForkSync({ localSha: 'a', upstreamSha: 'b', mergeBaseSha: 'a' }).action).toBe(
      'fast-forward'
    );
    expect(classifyForkSync({ localSha: 'a', upstreamSha: 'b', mergeBaseSha: 'c' }).action).toBe(
      'diverged'
    );
  });
});

describe('adp gates', () => {
  test('isValidAdpId', () => {
    expect(isValidAdpId('3b88fe9e-16df-4cf0-baee-48e223beebd7')).toBe(true);
    expect(isValidAdpId('nope')).toBe(false);
    expect(isValidAdpId(undefined)).toBe(false);
  });

  test('classifyAdp accepts a ready ADP', () => {
    expect(classifyAdp({ status: 'success', downloadURL: 'https://x' })).toEqual({ ok: true });
  });

  test('classifyAdp rejects non-success / expired / missing url', () => {
    expect(classifyAdp({ status: 'processing' }).ok).toBe(false);
    expect(classifyAdp({ status: 'success', downloadURL: 'x', downloadExpired: true }).ok).toBe(
      false
    );
    expect(classifyAdp({ status: 'success' }).ok).toBe(false);
    expect(classifyAdp(null).ok).toBe(false);
  });
});
