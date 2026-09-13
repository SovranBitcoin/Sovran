interface MarqueeAnimationInput {
  textWidth: number;
  containerWidth: number;
  speedPxPerSecond?: number;
  gapPx?: number;
}

export function computeMarqueeAnimation({
  textWidth,
  containerWidth,
  speedPxPerSecond = 30,
  gapPx = 48,
}: MarqueeAnimationInput) {
  const overflowing = containerWidth > 0 && textWidth > containerWidth;
  const distancePx = overflowing ? textWidth + Math.max(0, gapPx) : 0;
  const speed = speedPxPerSecond > 0 ? speedPxPerSecond : 30;
  return { overflowing, distancePx, durationMs: (distancePx / speed) * 1000 };
}
