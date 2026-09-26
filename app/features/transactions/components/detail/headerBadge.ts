/**
 * What the corner disc over a transaction's avatar says.
 *
 * Pure and dependency-free so the choice can be tested without rendering a
 * header — the placement is layout, but which badge wins is a decision.
 */

export type HeaderBadge = 'direction' | 'lock' | 'none';

/**
 * Which glyph the disc carries.
 *
 * One badge, so a lock REPLACES the direction arrow rather than crowding it:
 * whether money is coming or going is already in the amount's colour and
 * sign, while "only they can spend this" has nowhere else to live.
 */
export function headerBadgeIcon(badge: HeaderBadge, isSend: boolean): string {
  if (badge === 'lock') return 'mdi:lock-outline';
  return isSend ? 'fluent:arrow-upload-16-filled' : 'fluent:arrow-download-16-filled';
}

/** The badge in words — a 16px glyph says nothing to a screen reader. */
export function headerBadgeLabel(badge: HeaderBadge, isSend: boolean): string {
  if (badge === 'lock') return 'Locked to the recipient';
  return isSend ? 'Outgoing' : 'Incoming';
}
