export interface AvatarRect {
  x: number;
  y: number;
  size: number;
}

export function getCenteredAvatarRectInSlot({
  containerWidth,
  slotTop,
  slotSize,
  avatarSize,
}: {
  containerWidth: number;
  slotTop: number;
  slotSize: number;
  avatarSize: number;
}): AvatarRect | null {
  if (containerWidth <= 0) return null;

  return {
    x: containerWidth / 2 - avatarSize / 2,
    y: slotTop + (slotSize - avatarSize) / 2,
    size: avatarSize,
  };
}

/**
 * Translate/scale that puts a `baseSize`-rendered shared avatar element over
 * `rect`. The element scales about its own center, so the translate targets
 * the rect's center minus half the base size.
 */
export function getSharedAvatarTransform(
  rect: AvatarRect,
  baseSize: number
): { x: number; y: number; scale: number } {
  return {
    x: rect.x + rect.size / 2 - baseSize / 2,
    y: rect.y + rect.size / 2 - baseSize / 2,
    scale: rect.size / baseSize,
  };
}

/**
 * Center-stage rect for the receive celebration: the avatar parks at the
 * optical center of the band between the header-avoidance zone and the
 * action row, mirroring where the honeycomb itself prefers to place peers.
 */
export function getCelebrationCenterRect({
  containerSize,
  avatarSize,
  topInset,
  bottomAvoidance,
}: {
  containerSize: { width: number; height: number };
  avatarSize: number;
  topInset: number;
  bottomAvoidance: number;
}): AvatarRect | null {
  if (containerSize.width <= 0 || containerSize.height <= 0) return null;

  const bandTop = Math.min(topInset, containerSize.height);
  const bandBottom = Math.max(bandTop, containerSize.height - bottomAvoidance);
  const centerY = bandTop + (bandBottom - bandTop) / 2;

  return {
    x: containerSize.width / 2 - avatarSize / 2,
    y: centerY - avatarSize / 2,
    size: avatarSize,
  };
}
