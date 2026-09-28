import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  describeMintSelectorFrame,
  useMintSelectorFrameLog,
} from '@/features/mint/hooks/useMintSelectorFrameLog';
import type { MintRow } from '@/features/mint/hooks/useMintRowsWithCache';

const mockInfo = jest.fn();
let mockLoggingEnabled = false;
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: {
    info: (...args: unknown[]) => mockInfo(...args),
    isLevelEnabled: () => mockLoggingEnabled,
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

it('does not enumerate mint rows when diagnostic logging is disabled', () => {
  const rows = [row('https://a.example')];
  const enumerate = jest.spyOn(rows, 'map');
  function Probe({ step }: { step: string }) {
    useMintSelectorFrameLog({
      flow: 'send',
      scope: null,
      destination: null,
      step,
      source: 'live',
      itemsStatus: 'ready',
      rows,
    });
    return null;
  }

  let tree: TestRenderer.ReactTestRenderer | undefined;
  try {
    act(() => {
      tree = TestRenderer.create(React.createElement(Probe, { step: 'disabled' }));
    });
    expect(enumerate).not.toHaveBeenCalled();
    expect(mockInfo).not.toHaveBeenCalled();

    mockLoggingEnabled = true;
    act(() => {
      tree?.update(React.createElement(Probe, { step: 'enabled' }));
    });
    expect(enumerate).toHaveBeenCalledTimes(1);
    expect(mockInfo).toHaveBeenCalledWith('mint.selector.frame', expect.any(Object));
  } finally {
    act(() => tree?.unmount());
    mockLoggingEnabled = false;
    enumerate.mockRestore();
  }
});
