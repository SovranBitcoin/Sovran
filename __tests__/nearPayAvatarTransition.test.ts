import { getCenteredAvatarRectInSlot } from '@/features/nearPay/lib/avatarTransition';

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
