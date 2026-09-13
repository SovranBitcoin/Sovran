type DismissDecisionInput = {
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  threshold: number;
  minFlickDistance: number;
  velocityWeightS: number;
  flickVelocityPxS: number;
};

export function computeDismissDecision({
  dx,
  dy,
  vx,
  vy,
  threshold,
  minFlickDistance,
  velocityWeightS,
  flickVelocityPxS,
}: DismissDecisionInput): 'dismiss' | 'restore' {
  'worklet';
  const distance = Math.hypot(dx, dy);
  const outwardSpeed = distance > 0 ? Math.max(0, (vx * dx + vy * dy) / distance) : 0;
  const projected = distance + outwardSpeed * velocityWeightS;
  return projected > threshold || (outwardSpeed > flickVelocityPxS && distance > minFlickDistance)
    ? 'dismiss'
    : 'restore';
}
