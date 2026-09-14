import {
  OPTIMISTIC_MAX_AGE_MS,
  overlayToggleCount,
  overlayZapSats,
  shouldSettleToggle,
  shouldSettleZap,
  type ToggleOverlay,
} from '@/features/feed/lib/engagementOverlay';

const like = (expectedCount: number, over: Partial<ToggleOverlay> = {}): ToggleOverlay => ({
  value: true,
  pending: false,
  delta: 1,
  expectedCount,
  updatedAt: 0,
  ...over,
});
const unlike = (expectedCount: number, over: Partial<ToggleOverlay> = {}): ToggleOverlay => ({
  value: false,
  pending: false,
  delta: -1,
  expectedCount,
  updatedAt: 0,
  ...over,
});

describe('overlayToggleCount', () => {
  it('shows the base untouched without an overlay', () => {
    expect(overlayToggleCount(5, undefined)).toBe(5);
  });

  it('never double-counts a like the base already includes', () => {
    // Liked in the feed at 5 → expect 6; the thread's fresh count already has it.
    expect(overlayToggleCount(5, like(6))).toBe(6);
    expect(overlayToggleCount(6, like(6))).toBe(6);
    expect(overlayToggleCount(9, like(6))).toBe(9);
  });

  it('pins an unlike at or below the expectation', () => {
    expect(overlayToggleCount(6, unlike(5))).toBe(5);
    expect(overlayToggleCount(5, unlike(5))).toBe(5);
    expect(overlayToggleCount(3, unlike(5))).toBe(3);
    expect(overlayToggleCount(0, unlike(0))).toBe(0);
  });

  it('keeps legacy delta-only entries working', () => {
    expect(overlayToggleCount(5, { value: true, pending: false, delta: 1 })).toBe(6);
    expect(overlayToggleCount(0, { value: false, pending: false, delta: -1 })).toBe(0);
  });

  it('agrees across a feed like, a fresher thread read and an unlike there', () => {
    const feedBase = 5;
    const likeOverlay = like(feedBase + 1);
    const threadBase = 6; // fetched after the like was indexed
    expect(overlayToggleCount(feedBase, likeOverlay)).toBe(6);
    expect(overlayToggleCount(threadBase, likeOverlay)).toBe(6);

    // Unlike from the thread: expectation derives from what the thread showed.
    const shown = overlayToggleCount(threadBase, likeOverlay);
    const unlikeOverlay = unlike(shown - 1);
    expect(overlayToggleCount(threadBase, unlikeOverlay)).toBe(5);
    expect(overlayToggleCount(feedBase, unlikeOverlay)).toBe(5);
  });
});

describe('overlayZapSats', () => {
  it('pins to the expected total instead of adding on top of a fresh aggregate', () => {
    const overlay = { deltaSats: 21, pending: false, expectedSats: 521 };
    expect(overlayZapSats(500, overlay)).toBe(521);
    expect(overlayZapSats(521, overlay)).toBe(521);
    expect(overlayZapSats(600, overlay)).toBe(600);
  });

  it('keeps legacy delta-only entries working', () => {
    expect(overlayZapSats(500, { deltaSats: 21, pending: false })).toBe(521);
  });
});

describe('shouldSettleToggle', () => {
  it('holds while publishing', () => {
    expect(shouldSettleToggle(like(6, { pending: true }), true, 6, 0)).toBe(false);
  });

  it('holds while the own-event sync still disagrees, however old', () => {
    expect(shouldSettleToggle(like(6), false, 6, OPTIMISTIC_MAX_AGE_MS * 2)).toBe(false);
  });

  it('clears once the sync agrees and the count moved past the expectation', () => {
    expect(shouldSettleToggle(like(6), true, 5, 1)).toBe(false);
    expect(shouldSettleToggle(like(6), true, 6, 1)).toBe(true);
    expect(shouldSettleToggle(like(6), true, 8, 1)).toBe(true);
    expect(shouldSettleToggle(unlike(5), false, 6, 1)).toBe(false);
    expect(shouldSettleToggle(unlike(5), false, 4, 1)).toBe(true);
  });

  it('gives up pinning a count that never lands', () => {
    expect(shouldSettleToggle(like(6), true, 5, OPTIMISTIC_MAX_AGE_MS)).toBe(true);
  });

  it('clears a legacy entry as soon as the sync agrees', () => {
    expect(shouldSettleToggle({ value: true, pending: false, delta: 1 }, true, 0, 0)).toBe(true);
  });
});

describe('shouldSettleZap', () => {
  it('clears only when the aggregate reaches the expectation', () => {
    const overlay = { deltaSats: 21, pending: false, expectedSats: 521 };
    expect(shouldSettleZap(overlay, 500)).toBe(false);
    expect(shouldSettleZap(overlay, 521)).toBe(true);
    expect(shouldSettleZap({ ...overlay, pending: true }, 900)).toBe(false);
    expect(shouldSettleZap(undefined, 900)).toBe(false);
  });
});
