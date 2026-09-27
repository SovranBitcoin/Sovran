/**
 * What ships: the permanent lock is the only lock on offer.
 *
 * The wallet cannot take a locked send back (`wallet/src/p2pk/reclaimGate.ts`),
 * so "Reclaim after…" is neither listed nor honoured. The other lock tests
 * switch the gate on to keep the timed feature specified; this file leaves it
 * alone, so what it asserts is what a user gets.
 */

import { P2PK_RECLAIM_ENABLED } from 'wallet';

import { lockSpecForChoice } from '@/features/send/lib/sendLockControl';
import { buildSendLockMenuItems } from '@/features/send/lib/sendLockMenu';

jest.mock('@/shared/lib/date', () => ({ formatDate: () => 'a date' }));

const LOCK_KEY = `02${'11'.repeat(32)}`;
const REFUND_KEY = `02${'22'.repeat(32)}`;
const NOW = 1_800_000_000_000;

const menu = (allowOff: boolean) =>
  buildSendLockMenuItems({
    recipientName: 'Alice',
    current: null,
    allowOff,
    hasRefundKey: true,
    nowMs: NOW,
    onPick: () => {},
  });

describe('the lock menu, as shipped', () => {
  it('ships with reclaim switched off', () => {
    expect(P2PK_RECLAIM_ENABLED).toBe(false);
  });

  it('offers the permanent lock as the only lock', () => {
    expect(menu(true).map((item) => item.testID)).toEqual(['send-lock-off', 'send-lock-forever']);
  });

  it('offers nothing but the permanent lock to a flow that arrived locked', () => {
    const items = menu(false);
    expect(items.map((item) => item.testID)).toEqual(['send-lock-forever']);
    expect(items[0]).toMatchObject({ text: 'Lock forever' });
    expect(items[0]?.disabled).toBeUndefined();
  });

  it('promises no way back anywhere in the menu', () => {
    const copy = menu(true)
      .map((item) => `${item.text} ${item.description ?? ''}`)
      .join(' ');
    expect(copy).not.toMatch(/reclaim|take it back after/i);
  });
});

describe('the lock a choice becomes, as shipped', () => {
  it('honours the permanent lock', () => {
    expect(lockSpecForChoice({ lockKey: LOCK_KEY, durationId: 'forever' }, NOW)).toEqual({
      pubkey: LOCK_KEY,
    });
  });

  it.each(['1h', '24h', '7d', '30d'])(
    'refuses a %s choice kept from before the gate closed',
    (durationId) => {
      expect(
        lockSpecForChoice({ lockKey: LOCK_KEY, durationId, refundKey: REFUND_KEY }, NOW)
      ).toBeNull();
    }
  );
});
