/**
 * NIP-37 draft event (kind:31234) builder + target serialization.
 */
import {
  DRAFT_KIND,
  buildDraftEvent,
  buildDraftDeletion,
  serializeDraftTarget,
  parseDraftTarget,
} from '@/features/composer/publish/buildDraftEvent';

const target = { kind: 1, content: 'hello', created_at: 100, tags: [['t', 'x']] };

describe('buildDraftEvent', () => {
  it('wraps with d + k tags', () => {
    const event = buildDraftEvent({
      draftId: 'abc',
      draftedKind: 1,
      encryptedContent: 'cipher',
      createdAt: 5,
    });
    expect(event.kind).toBe(DRAFT_KIND);
    expect(event.content).toBe('cipher');
    expect(event.tags).toEqual([
      ['d', 'abc'],
      ['k', '1'],
    ]);
  });

  it('includes anchors when given', () => {
    const event = buildDraftEvent({
      draftId: 'abc',
      draftedKind: 1068,
      encryptedContent: 'c',
      anchors: [['e', 'parent']],
      createdAt: 5,
    });
    expect(event.tags).toContainEqual(['e', 'parent']);
    expect(event.tags).toContainEqual(['k', '1068']);
  });

  it('deletion form has empty content + same d', () => {
    const del = buildDraftDeletion('abc', 1, 5);
    expect(del.content).toBe('');
    expect(del.tags).toContainEqual(['d', 'abc']);
  });
});

describe('draft target serialization', () => {
  it('round-trips the target event', () => {
    const json = serializeDraftTarget(target);
    expect(parseDraftTarget(json)).toEqual(target);
  });

  it('returns null for malformed payloads', () => {
    expect(parseDraftTarget('not json')).toBeNull();
    expect(parseDraftTarget('{"content":"x"}')).toBeNull(); // missing kind
  });
});
