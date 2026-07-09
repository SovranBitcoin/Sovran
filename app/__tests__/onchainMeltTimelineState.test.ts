/**
 * @jest-environment node
 */
import {
  isOnchainMeltSettled,
  resolveOnchainMeltTimelineState,
} from '@/shared/lib/cashu/onchainMelt';

describe('resolveOnchainMeltTimelineState', () => {
  it('does NOT let a stale UNPAID quote row mask a finalized entry (internal-send bug)', () => {
    // The synchronous-PAID internal-transfer path: the operation finalized but
    // the local melt-quote row was never bumped past its initial UNPAID. A blind
    // `quote ?? entry` returned UNPAID → timeline pinned at "Sent to mint".
    expect(resolveOnchainMeltTimelineState('UNPAID', 'finalized')).toBe('finalized');
    expect(isOnchainMeltSettled(resolveOnchainMeltTimelineState('UNPAID', 'finalized'))).toBe(true);
  });

  it('advances off the operation entry when the quote row is not yet known', () => {
    // Broadcasting case before the first quote refresh resolves.
    expect(resolveOnchainMeltTimelineState(null, 'pending')).toBe('pending');
    expect(resolveOnchainMeltTimelineState(undefined, 'executing')).toBe('executing');
  });

  it('advances off the quote row when the mint confirms before the op finalizes', () => {
    expect(resolveOnchainMeltTimelineState('PAID', 'pending')).toBe('PAID');
    expect(resolveOnchainMeltTimelineState('PENDING', 'prepared')).toBe('PENDING');
  });

  it('keeps the quote row when both sides sit at the same rank', () => {
    expect(resolveOnchainMeltTimelineState('PENDING', 'pending')).toBe('PENDING');
    expect(resolveOnchainMeltTimelineState('UNPAID', 'prepared')).toBe('UNPAID');
  });

  it('lets a rollback/failure on either side win over a stale quote', () => {
    expect(resolveOnchainMeltTimelineState('UNPAID', 'rolledBack')).toBe('rolledBack');
    expect(resolveOnchainMeltTimelineState('PENDING', 'rolled_back')).toBe('rolled_back');
    expect(resolveOnchainMeltTimelineState('failed', 'finalized')).toBe('failed');
  });

  it('falls back gracefully when neither state is recognized', () => {
    expect(resolveOnchainMeltTimelineState(null, null)).toBeNull();
    expect(resolveOnchainMeltTimelineState('weird', undefined)).toBe('weird');
    expect(resolveOnchainMeltTimelineState(undefined, 'mystery')).toBe('mystery');
  });
});

describe('isOnchainMeltSettled', () => {
  it('treats PAID and finalized as settled, everything else as not', () => {
    expect(isOnchainMeltSettled('PAID')).toBe(true);
    expect(isOnchainMeltSettled('finalized')).toBe(true);
    expect(isOnchainMeltSettled('PENDING')).toBe(false);
    expect(isOnchainMeltSettled('pending')).toBe(false);
    expect(isOnchainMeltSettled('UNPAID')).toBe(false);
    expect(isOnchainMeltSettled(null)).toBe(false);
    expect(isOnchainMeltSettled('rolledBack')).toBe(false);
  });
});
