import { SNAP_VELOCITY_THRESHOLD } from './embedConstants';

/**
 * Worklet: pick the snap target (0 / middle / inline) nearest the current
 * sheet offset, biased to the next point in the flick's direction when the
 * release velocity is fast. Shared by the sheet pan and the action-bar pan.
 */
export function nearestSnap(
  current: number,
  velocityY: number,
  snapMiddle: number,
  snapInline: number
): number {
  'worklet';
  const points = [0, snapMiddle, snapInline];
  let target = points[0];
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Math.abs(current - points[i]);
    if (d < best) {
      best = d;
      target = points[i];
    }
  }
  if (velocityY > SNAP_VELOCITY_THRESHOLD && target < snapInline) {
    target = target === 0 ? snapMiddle : snapInline;
  } else if (velocityY < -SNAP_VELOCITY_THRESHOLD && target > 0) {
    target = target === snapInline ? snapMiddle : 0;
  }
  return target;
}

/**
 * Worklet: how far to lift the thread list's content as the sheet collapses.
 *
 * The list reserves `headerClearance` at the top of its content so the thread
 * can scroll behind the transparent navigation header while the sheet is at
 * rest. Once the sheet slides down, that reserve is no longer under a header —
 * it reads as an empty band between the grabber and the first post — so it is
 * translated away over the rest→middle range.
 *
 * Only the part of the reserve still on screen is lifted: a thread opened on a
 * reply has already scrolled past it, and lifting the full amount there would
 * crop real content under the grabber instead.
 */
export function contentLift(
  sheetTranslateY: number,
  scrollY: number,
  snapMiddle: number,
  headerClearance: number
): number {
  'worklet';
  const progress = Math.min(1, Math.max(0, sheetTranslateY / Math.max(1, snapMiddle)));
  const remainingReserve = Math.min(headerClearance, Math.max(0, headerClearance - scrollY));
  return progress * remainingReserve;
}
