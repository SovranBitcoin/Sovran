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
