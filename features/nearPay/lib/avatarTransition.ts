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
