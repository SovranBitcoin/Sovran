import { describe, expect, it } from 'vitest';

import { parseHistoryEntryOnce } from '../../src/operations/historyEntry';

describe('parseHistoryEntryOnce', () => {
  it('keeps every field of a valid entry', () => {
    const entry = {
      id: 'h1',
      type: 'send',
      amount: 21,
      metadata: { memo: 'hi' },
      mintUrl: 'https://mint.example.com',
      token: { proofs: [] },
    };
    expect(parseHistoryEntryOnce(JSON.stringify(entry))).toEqual(entry);
  });

  it('accepts a serialized coco Amount string', () => {
    expect(
      parseHistoryEntryOnce(JSON.stringify({ id: 'h1', amount: '21' }))?.amount,
    ).toBe('21');
  });

  it.each([null, undefined, '', 'not json', '[]', '"x"', '{"id":5}'])(
    'returns null for %j',
    (raw) => {
      expect(parseHistoryEntryOnce(raw)).toBeNull();
    },
  );
});
