import { pressScaleTiming } from '@/shared/ui/primitives/PressableFeedback';

describe('PressableFeedback press timing', () => {
  it('reaches the pressed state within ~6 frames so the tap reads on contact', () => {
    expect(pressScaleTiming(true).duration).toBeLessThanOrEqual(100);
  });

  it('releases no faster than it pressed, so a quick tap stays visible', () => {
    expect(pressScaleTiming(false).duration).toBeGreaterThanOrEqual(
      pressScaleTiming(true).duration
    );
    expect(pressScaleTiming(false).duration).toBeLessThanOrEqual(200);
  });
});
