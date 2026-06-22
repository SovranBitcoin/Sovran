import { REPLY_SKELETON_VARIANTS } from './threadReplySkeletons';

// Height (px) of one rendered content line in a note/reply body. Single source
// of truth: `NoteContent` re-exports this for its own text rendering, and the
// skeleton/fixed-size math below uses it, so the rendered note and its reserved
// skeleton height can never drift.
export const NOTE_CONTENT_LINE_HEIGHT = 24;

// Height hints (px) for the content-free skeleton / sort-tabs rows, fed to
// LegendList's `getFixedItemSize` so it doesn't lay them out at the generic
// `estimatedItemSize` and snap them on first paint. The skeletons size
// themselves naturally — these are deterministic now that each skeleton bar is
// pinned to a single line (`numberOfLines={1}` in `PostCardSkeleton`), so a
// content line is exactly `NOTE_CONTENT_LINE_HEIGHT`. The values are biased a
// hair high so the list never under-reserves (a few px of gap is invisible; an
// under-reservation would overlap rows). Keep in sync with `PostCardSkeleton` /
// `ReplySortPicker`.
//
//   reply skeleton = chrome (gutter padding + author row + spacer + metrics
//   footer) + one NOTE_CONTENT_LINE_HEIGHT per content line of its variant.
// Chrome is 84 to match the MEASURED real reply ladder (height = 84 + 24·lines:
// 1-line = 108px, 2-line = 132px), so a skeleton and the real text it's replaced
// by occupy the same height (no ~7px reflow). Per-line stays NOTE_CONTENT_LINE_HEIGHT.
export const REPLY_SKELETON_CHROME_HEIGHT = 84;
export const TARGET_SKELETON_FIXED_HEIGHT = 176;
export const REPLY_SORT_TABS_FIXED_HEIGHT = 52;

// Minimal structural shape of a thread list row needed to reserve its size.
// Kept local so this pure module doesn't depend on the ThreadView component
// (which pulls native deps and can't load in a node test).
type FixedSizeItem = { type: string; skeletonIndex?: number };

export function replySkeletonHeight(skeletonIndex: number): number {
  const variant = REPLY_SKELETON_VARIANTS[skeletonIndex % REPLY_SKELETON_VARIANTS.length];
  return REPLY_SKELETON_CHROME_HEIGHT + variant.content.length * NOTE_CONTENT_LINE_HEIGHT;
}

// Deterministic heights for the content-free skeleton / sort-tabs rows. Dynamic
// rows (target, replies) return undefined so LegendList measures them.
export function threadFixedItemSize(item: FixedSizeItem): number | undefined {
  switch (item.type) {
    case 'target-skeleton':
      return TARGET_SKELETON_FIXED_HEIGHT;
    case 'reply-skeleton':
      return replySkeletonHeight(item.skeletonIndex ?? 0);
    case 'reply-sort-tabs':
      return REPLY_SORT_TABS_FIXED_HEIGHT;
    default:
      return undefined;
  }
}
