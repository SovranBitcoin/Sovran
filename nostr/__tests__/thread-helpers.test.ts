import { describe, test, expect } from 'vitest';
import { partitionOpFirst, nip10ParentId, isDirectReplyTo } from '../src/facade/thread';

const ROOT = 'a'.repeat(64);
const B = 'b'.repeat(64);
const OP = '1'.repeat(64);

describe('partitionOpFirst', () => {
  const items = [
    { id: 'x', author: 'other1' },
    { id: 'y', author: OP },
    { id: 'z', author: 'other2' },
    { id: 'w', author: OP },
  ];
  const authorOf = (i: { author: string }) => i.author;

  test('stable partition: OP items lead, both groups keep their relative order', () => {
    expect(partitionOpFirst(items, OP, authorOf).map((i) => i.id)).toEqual(['y', 'w', 'x', 'z']);
  });

  test('idempotent: re-applying over an already-partitioned list is a no-op', () => {
    const once = partitionOpFirst(items, OP, authorOf);
    expect(partitionOpFirst(once, OP, authorOf)).toEqual(once);
  });

  test('no OP items → identity', () => {
    expect(partitionOpFirst(items, 'nobody', authorOf).map((i) => i.id)).toEqual(['x', 'y', 'z', 'w']);
  });
});

describe('nip10ParentId', () => {
  test('explicit reply marker wins', () => {
    expect(
      nip10ParentId({ tags: [['e', ROOT, '', 'root'], ['e', B, '', 'reply']] }),
    ).toBe(B);
  });

  test('deprecated positional: the LAST unmarked e-tag is the parent (A→B→A stays A→B→A)', () => {
    expect(nip10ParentId({ tags: [['e', ROOT], ['e', B]] })).toBe(B);
  });

  test('root marker only → direct reply to the root', () => {
    expect(nip10ParentId({ tags: [['e', ROOT, '', 'root']] })).toBe(ROOT);
  });

  test('no e-tags → no parent', () => {
    expect(nip10ParentId({ tags: [['p', OP]] })).toBeUndefined();
  });
});

describe('isDirectReplyTo', () => {
  test('marked reply to the target', () => {
    expect(isDirectReplyTo({ kind: 1, tags: [['e', ROOT, '', 'reply']] }, ROOT)).toBe(true);
    expect(isDirectReplyTo({ kind: 1, tags: [['e', B, '', 'reply']] }, ROOT)).toBe(false);
  });

  test('root marker counts as direct only when there is no reply marker', () => {
    expect(isDirectReplyTo({ kind: 1, tags: [['e', ROOT, '', 'root']] }, ROOT)).toBe(true);
    expect(
      isDirectReplyTo({ kind: 1, tags: [['e', ROOT, '', 'root'], ['e', B, '', 'reply']] }, ROOT),
    ).toBe(false);
  });

  test('unmarked positional: last e-tag pointing at the target', () => {
    expect(isDirectReplyTo({ kind: 1, tags: [['e', ROOT]] }, ROOT)).toBe(true);
    expect(isDirectReplyTo({ kind: 1, tags: [['e', ROOT], ['e', B]] }, ROOT)).toBe(false);
  });

  test('non-thread kinds are never direct replies', () => {
    expect(isDirectReplyTo({ kind: 7, tags: [['e', ROOT, '', 'reply']] }, ROOT)).toBe(false);
    expect(isDirectReplyTo({ kind: 1111, tags: [['e', ROOT, '', 'reply']] }, ROOT)).toBe(true);
  });
});
