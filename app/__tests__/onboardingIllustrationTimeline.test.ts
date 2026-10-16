import {
  DETAIL_OPACITY,
  ILLUSTRATION_CYCLE_MS,
  TRAVEL,
  TRAVEL_OPACITY,
} from '@/features/onboarding/components/onboardingIllustration.timeline';
import { valueAt, type EasingMap } from '@/shared/lib/motion/keyframes';

const linear = (x: number) => x;
const easings: EasingMap = {
  linear,
  outCubic: linear,
  inQuad: linear,
  outQuad: linear,
  overshoot: linear,
  inOutSin: linear,
};

it('never shows the moving object jumping back to the start', () => {
  expect(valueAt(3400, TRAVEL, easings)).toBe(76);
  expect(valueAt(3800, TRAVEL_OPACITY, easings)).toBe(0);
  expect(valueAt(4000, TRAVEL_OPACITY, easings)).toBe(0);
  expect(valueAt(4200, TRAVEL, easings)).toBe(-76);
  expect(valueAt(4200, TRAVEL_OPACITY, easings)).toBe(0);
});

it.each([TRAVEL, TRAVEL_OPACITY, DETAIL_OPACITY].map((track) => ({ track })))(
  'joins the last frame to the first without a visible seam',
  ({ track }) => {
    expect(valueAt(ILLUSTRATION_CYCLE_MS, track, easings)).toBe(valueAt(0, track, easings));
  }
);
