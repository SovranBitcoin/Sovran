/**
 * Post-card typography, geometry and ink — the single source every feed
 * surface (feed row, repost header, thread reply/target, quoted card, action
 * bar, skeletons) reads its sizes from.
 *
 * Calibrated against the open-source clients the feed is benchmarked on
 * (Bluesky ALF, Primal, Threads): name and body share one size and differ by
 * weight, body leading is ~1.3, the avatar is 40 with a 10 gap, and the card
 * uses exactly three ink alphas. Literal sizes in the card components are a
 * regression — add a role here instead.
 */
import { alpha, fontSize } from '@/shared/styles/tokens';

/** Feed text renders in Mona Sans (already bundled for amounts) so the name
 *  can be SemiBold; Oxygen ships Regular/Bold only. */
export const POST_FONT_FAMILY = 'mona' as const;

export const POST_AVATAR_SIZE = 40;
export const POST_AVATAR_GAP = 10;
/** Body, media, quoted cards and the action bar all start at this x. */
export const POST_CONTENT_INDENT = POST_AVATAR_SIZE + POST_AVATAR_GAP;
export const POST_PADDING_H = 16;
export const POST_PADDING_TOP = 12;
export const POST_PADDING_BOTTOM = 8;

export const postType = {
  name: { size: 15, lineHeight: 20 },
  body: { size: 15, lineHeight: 20 },
  meta: { size: fontSize.sm, lineHeight: 18 },
  count: { size: fontSize.sm, lineHeight: 18 },
} as const;

/** Three-step ink ladder — nothing on the card uses any other alpha. */
export const postInk = {
  primary: 0.9,
  secondary: alpha.disabled,
  tertiary: alpha.soft,
} as const;

/** Height (px) of one rendered content line in a note/reply body. The reply
 *  skeleton sizes its bars to the same value, so a rendered note and the
 *  skeleton it replaces never drift in height. */
export const NOTE_CONTENT_LINE_HEIGHT = postType.body.lineHeight;
