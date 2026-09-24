/**
 * The lock choice, as the app's existing pick-one-of-N menu.
 *
 * Every line of copy here is load-bearing, because this is the only place the
 * sender is told what a lock actually does. NUT-11 gives three outcomes and
 * they are genuinely different:
 *
 *   - no locktime            → nobody but the recipient, ever
 *   - locktime + refund keys → the sender can take it back afterwards
 *   - locktime, no refund    → ANYONE can take it afterwards
 *
 * We only ever create the first two — `normalizeP2pkLock` refuses the third —
 * so the copy has exactly two promises to keep.
 *
 * Pure: the rows are data, and the screen hands them to `actionMenuSheet`.
 * That keeps the copy unit-testable without pulling in the sheet host.
 */

import { formatDate } from '@/shared/lib/date';
import { type ActionMenuItem } from '@/shared/lib/popup/popups/actionMenu';

export type SendLockDurationId = 'off' | '1h' | '24h' | '7d' | '30d' | 'forever';

export interface SendLockDurationOption {
  id: SendLockDurationId;
  label: string;
  /** Seconds from now; `null` emits no locktime tag at all. */
  offsetSec: number | null;
}

const HOUR = 60 * 60;

export const SEND_LOCK_DURATIONS: readonly SendLockDurationOption[] = [
  { id: 'off', label: "Don't lock", offsetSec: null },
  { id: '1h', label: 'Reclaim after 1 hour', offsetSec: HOUR },
  { id: '24h', label: 'Reclaim after 1 day', offsetSec: 24 * HOUR },
  { id: '7d', label: 'Reclaim after 1 week', offsetSec: 7 * 24 * HOUR },
  { id: '30d', label: 'Reclaim after 30 days', offsetSec: 30 * 24 * HOUR },
  { id: 'forever', label: 'Only they can claim', offsetSec: null },
];

/** Unix seconds this choice unlocks at, or null for a permanent lock. */
export function lockUntilSec(option: SendLockDurationOption, nowMs: number): number | null {
  if (option.id === 'off' || option.offsetSec === null) return null;
  return Math.floor(nowMs / 1000) + option.offsetSec;
}

/**
 * What each choice promises. "Reclaim after X" is the only honest phrasing for
 * a timed lock, because we do set refund keys — the locktime is exactly when
 * we can take it back. Never "expires": under NUT-11 an expiring lock with no
 * refund tag hands the money to whoever is holding the token.
 */
export function describeDuration(
  option: SendLockDurationOption,
  recipientName: string,
  nowMs: number
): string {
  if (option.id === 'off') return 'Anyone with the token can claim it';
  if (option.offsetSec === null) {
    return `Only ${recipientName} can claim it. You will not be able to take this back.`;
  }
  const unlockAt = (lockUntilSec(option, nowMs) ?? 0) * 1000;
  return `Only ${recipientName} can claim it. You can take it back after ${formatDate(
    unlockAt,
    'short-date-time'
  )}.`;
}

interface SendLockMenuParams {
  recipientName: string;
  current: SendLockDurationId;
  /** False when this wallet has no keyring key to name as the refund key. */
  hasRefundKey: boolean;
  nowMs: number;
  onPick: (option: SendLockDurationOption) => void;
}

const NO_REFUND_KEY_REASON = 'Add a P2PK key in Settings to reclaim later';

export function buildSendLockMenuItems(params: SendLockMenuParams): ActionMenuItem[] {
  const { recipientName, current, hasRefundKey, nowMs, onPick } = params;
  const items: ActionMenuItem[] = [];
  for (const option of SEND_LOCK_DURATIONS) {
    // A timed lock we cannot sign the refund for would be unreclaimable by us
    // and, once it opened, spendable by anyone. Offer only the permanent lock
    // until this wallet has a key to reclaim with.
    const disabled = option.offsetSec !== null && !hasRefundKey;
    items.push({
      text: option.label,
      testID: `send-lock-${option.id}`,
      selected: option.id === current,
      ...(option.id === 'forever' ? { variant: 'dangerous' as const } : {}),
      ...(disabled
        ? { disabled: true, reason: NO_REFUND_KEY_REASON }
        : { description: describeDuration(option, recipientName, nowMs) }),
      onPress: () => onPick(option),
    });
  }
  return items;
}
