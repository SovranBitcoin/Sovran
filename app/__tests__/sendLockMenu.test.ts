/**
 * @jest-environment node
 *
 * The lock menu's copy. This is the only place the sender is told what a lock
 * does, so the three NUT-11 outcomes must not blur into one reassuring
 * sentence.
 */

import {
  buildSendLockMenuItems,
  describeDuration,
  lockUntilSec,
  SEND_LOCK_DURATIONS,
} from '@/features/send/lib/sendLockMenu';

const NOW = Date.UTC(2026, 2, 16, 15, 42);
const NAME = 'Alice';

const option = (id: string) => SEND_LOCK_DURATIONS.find((o) => o.id === id)!;

describe('lock durations', () => {
  it('turns a choice into a unix-seconds unlock time', () => {
    expect(lockUntilSec(option('24h'), NOW)).toBe(Math.floor(NOW / 1000) + 86400);
  });

  it('has no unlock time for the two choices that never open', () => {
    expect(lockUntilSec(option('off'), NOW)).toBeNull();
    expect(lockUntilSec(option('forever'), NOW)).toBeNull();
  });
});

describe('lock copy', () => {
  it('promises a way back only when there is one', () => {
    expect(describeDuration(option('7d'), NAME, NOW)).toMatch(/take it back after/);
    expect(describeDuration(option('forever'), NAME, NOW)).toMatch(
      /will not be able to take this back/
    );
  });

  it('never says a lock "expires"', () => {
    // Under NUT-11 an expiring lock with no refund tag hands the money to
    // whoever holds the token. We never create that, and must never imply it.
    for (const o of SEND_LOCK_DURATIONS) {
      expect(describeDuration(o, NAME, NOW)).not.toMatch(/expire/i);
    }
  });

  it('says plainly that not locking leaves the token to anyone', () => {
    expect(describeDuration(option('off'), NAME, NOW)).toMatch(/Anyone with the token/);
  });
});

describe('lock menu items', () => {
  const build = (over: Partial<Parameters<typeof buildSendLockMenuItems>[0]> = {}) =>
    buildSendLockMenuItems({
      recipientName: NAME,
      current: 'off',
      hasRefundKey: true,
      nowMs: NOW,
      onPick: () => {},
      ...over,
    });

  it('marks the current choice', () => {
    const items = build({ current: '7d' });
    expect(items.find((i) => i.testID === 'send-lock-7d')?.selected).toBe(true);
  });

  it('offers only the permanent lock without a key to reclaim with', () => {
    // A timed lock we cannot sign the refund for is worse than no lock: once
    // it opened, anyone holding the token could spend it.
    const items = build({ hasRefundKey: false });
    expect(items.find((i) => i.testID === 'send-lock-24h')?.disabled).toBe(true);
    expect(items.find((i) => i.testID === 'send-lock-forever')?.disabled).toBeUndefined();
    expect(items.find((i) => i.testID === 'send-lock-off')?.disabled).toBeUndefined();
  });

  it('flags the irreversible choice as dangerous', () => {
    expect(build().find((i) => i.testID === 'send-lock-forever')?.variant).toBe('dangerous');
  });
});
