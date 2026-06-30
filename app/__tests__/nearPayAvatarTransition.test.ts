import {
  getCelebrationCenterRect,
  getCenteredAvatarRectInSlot,
  getSharedAvatarTransform,
} from '@/features/nearPay/lib/avatarTransition';

describe('Near Pay avatar transition geometry', () => {
  it('targets the rendered avatar inside a larger header slot', () => {
    const rect = getCenteredAvatarRectInSlot({
      containerWidth: 390,
      slotTop: 32,
      slotSize: 56,
      avatarSize: 48,
    });

    expect(rect).toEqual({
      x: 171,
      y: 36,
      size: 48,
    });
  });

  it('does not expose a target before the container is measured', () => {
    expect(
      getCenteredAvatarRectInSlot({
        containerWidth: 0,
        slotTop: 32,
        slotSize: 56,
        avatarSize: 48,
      })
    ).toBeNull();
  });
});

describe('getSharedAvatarTransform', () => {
  it('centers a base-sized element over the rect at the rect/base scale', () => {
    // 72px-rendered element flying to a 36px rect: translate to the rect
    // center minus half the base, scale to half.
    expect(getSharedAvatarTransform({ x: 100, y: 200, size: 36 }, 72)).toEqual({
      x: 100 + 18 - 36,
      y: 200 + 18 - 36,
      scale: 0.5,
    });
  });

  it('is identity-scaled when the rect already matches the base size', () => {
    expect(getSharedAvatarTransform({ x: 10, y: 20, size: 48 }, 48)).toEqual({
      x: 10,
      y: 20,
      scale: 1,
    });
  });
});

describe('getCelebrationCenterRect', () => {
  it('parks the avatar at the optical center of the usable band', () => {
    const rect = getCelebrationCenterRect({
      containerSize: { width: 390, height: 700 },
      avatarSize: 96,
      topInset: 80,
      bottomAvoidance: 140,
    });
    // Band spans y 80..560 → center 320.
    expect(rect).toEqual({ x: 147, y: 272, size: 96 });
  });

  it('returns null before the container is measured', () => {
    expect(
      getCelebrationCenterRect({
        containerSize: { width: 0, height: 0 },
        avatarSize: 96,
        topInset: 80,
        bottomAvoidance: 140,
      })
    ).toBeNull();
  });
});
