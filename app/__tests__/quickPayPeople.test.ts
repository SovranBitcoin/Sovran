import { mergeQuickPayContributions } from '@/features/send/lib/quickPayMerge';

const pubkey = (char: string) => char.repeat(64);

describe('mergeQuickPayContributions', () => {
  it('collapses to one row per pubkey, keeping the most recent interaction', () => {
    const merged = mergeQuickPayContributions(
      [
        { pubkey: pubkey('a'), source: 'peer', at: 100, displayName: 'old' },
        { pubkey: pubkey('a'), source: 'sent', at: 300, displayName: 'new' }, // newer wins
        { pubkey: pubkey('a'), source: 'received', at: 200 },
      ],
      new Set()
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      pubkey: pubkey('a'),
      source: 'sent',
      at: 300,
      displayName: 'new',
    });
  });

  it('orders newest-first across sources and caps', () => {
    const merged = mergeQuickPayContributions(
      [
        { pubkey: pubkey('a'), source: 'sent', at: 100 },
        { pubkey: pubkey('b'), source: 'peer', at: 300 },
        { pubkey: pubkey('c'), source: 'received', at: 200 },
      ],
      new Set(),
      2
    );
    expect(merged.map((c) => c.pubkey)).toEqual([pubkey('b'), pubkey('c')]);
  });

  it('drops excluded pubkeys (e.g. live nearby peers)', () => {
    const merged = mergeQuickPayContributions(
      [
        { pubkey: pubkey('a'), source: 'peer', at: 100 },
        { pubkey: pubkey('b'), source: 'sent', at: 200 },
      ],
      new Set([pubkey('a')])
    );
    expect(merged.map((c) => c.pubkey)).toEqual([pubkey('b')]);
  });
});
