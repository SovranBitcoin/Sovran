import { contentLift } from '@/features/feed/components/thread-embed/snapMath';

const CLEARANCE = 104;
const SNAP_MIDDLE = 596;

describe('contentLift', () => {
  it('lifts nothing while the sheet rests, so the thread clears the navigation header', () => {
    expect(contentLift(0, 0, SNAP_MIDDLE, CLEARANCE)).toBe(0);
  });

  it('lifts the full reserve by the middle snap, so the post sits under the grabber', () => {
    expect(contentLift(SNAP_MIDDLE, 0, SNAP_MIDDLE, CLEARANCE)).toBe(CLEARANCE);
  });

  it('holds the full lift past the middle snap', () => {
    expect(contentLift(SNAP_MIDDLE * 1.4, 0, SNAP_MIDDLE, CLEARANCE)).toBe(CLEARANCE);
  });

  it('interpolates across the collapse so the content follows the sheet', () => {
    expect(contentLift(SNAP_MIDDLE / 2, 0, SNAP_MIDDLE, CLEARANCE)).toBeCloseTo(CLEARANCE / 2);
  });

  it('lifts only the reserve still on screen when the thread is already scrolled', () => {
    expect(contentLift(SNAP_MIDDLE, 40, SNAP_MIDDLE, CLEARANCE)).toBe(CLEARANCE - 40);
  });

  it('never crops real content once the reserve has scrolled away', () => {
    expect(contentLift(SNAP_MIDDLE, CLEARANCE + 500, SNAP_MIDDLE, CLEARANCE)).toBe(0);
  });

  it('survives a zero middle snap (first frame, before geometry settles)', () => {
    expect(contentLift(0, 0, 0, 0)).toBe(0);
  });
});
