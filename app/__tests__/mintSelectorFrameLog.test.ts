import { describeMintSelectorFrame } from '@/features/mint/hooks/useMintSelectorFrameLog';
import type { MintRow } from '@/features/mint/hooks/useMintRowsWithCache';

const row = (mintUrl: string, overrides: Partial<MintRow> = {}): MintRow => ({
  mintUrl,
  displayName: mintUrl,
  balance: 0,
  unit: 'sat',
  status: 'available',
  reason: null,
  isPreferred: false,
  metaState: 'cold',
  ...overrides,
});

describe('describeMintSelectorFrame', () => {
  it('reports no changes for the first frame', () => {
    const frame = describeMintSelectorFrame(null, [row('https://a.example')]);

    expect(frame.changes).toEqual({});
    expect(frame.rows['https://a.example']).toBe(
      'available units=unknown meta=cold url-only no-icon balance=0'
    );
  });

  it('names the row a later frame added, removed or filled in, and what it was before', () => {
    const first = describeMintSelectorFrame(null, [
      row('https://a.example'),
      row('https://gone.example'),
    ]);
    const second = describeMintSelectorFrame(first.rows, [
      row('https://a.example', {
        displayName: 'Mint A',
        supportedUnits: ['sat', 'usd'],
        metaState: 'live',
      }),
      row('https://late.example', { supportedUnits: ['tsat'] }),
    ]);

    expect(second.changes).toEqual({
      'https://a.example': 'WAS: available units=unknown meta=cold url-only no-icon balance=0',
      'https://late.example': 'ADDED: available units=tsat meta=cold url-only no-icon balance=0',
      'https://gone.example': 'REMOVED',
    });
  });
});
