import { describe, expect, it } from 'vitest';

import { getHistoryEntryRefreshLabel } from '../../src/history';

describe('history refresh copy', () => {
  it('labels send entries by token state', () => {
    expect(getHistoryEntryRefreshLabel({ type: 'send', state: 'finalized' })).toBe('Sent with');
    expect(getHistoryEntryRefreshLabel({ type: 'send', state: 'pending' })).toBe('Sending with');
  });

  it('labels receive entries by token state', () => {
    expect(getHistoryEntryRefreshLabel({ type: 'receive', state: 'finalized' })).toBe(
      'Received with',
    );
    expect(getHistoryEntryRefreshLabel({ type: 'receive', state: 'pending' })).toBe(
      'Receiving with',
    );
  });

  it('labels other entry types as processing', () => {
    expect(getHistoryEntryRefreshLabel({ type: 'mint', state: 'PAID' })).toBe('Processing with');
  });
});
