/**
 * Wallpaper carousel math + page registration for the account pager
 * (shared/lib/theme/themeTransition).
 *
 * `carouselLayerOpacity` is the whole transition model: layers stack in page
 * order and opacity is a pure function of the pager's continuous position,
 * so these tests pin the top-layer-only crossfade invariants (no backdrop
 * bleed, continuity at page boundaries, edge clamping).
 */

import {
  carouselLayerOpacity,
  getCarouselPages,
  isCarouselTheme,
  setCarouselPages,
} from '@/shared/lib/theme/themeTransition';

describe('carouselLayerOpacity', () => {
  const COUNT = 3;

  it('shows exactly the settled page at integer positions', () => {
    expect(carouselLayerOpacity(1, 0, COUNT)).toBe(0);
    expect(carouselLayerOpacity(1, 1, COUNT)).toBe(1);
    expect(carouselLayerOpacity(1, 2, COUNT)).toBe(0);
  });

  it('mid-drag: floor layer holds 1 underneath while the next fades in on top', () => {
    // x = 0.4, dragging from page 0 toward page 1
    expect(carouselLayerOpacity(0.4, 0, COUNT)).toBe(1);
    expect(carouselLayerOpacity(0.4, 1, COUNT)).toBeCloseTo(0.4);
    expect(carouselLayerOpacity(0.4, 2, COUNT)).toBe(0);
  });

  it('is symmetric for leftward drags (same x, regardless of direction)', () => {
    // x = 1.7 — between pages 1 and 2, whether arriving from 2 or leaving 1
    expect(carouselLayerOpacity(1.7, 1, COUNT)).toBe(1);
    expect(carouselLayerOpacity(1.7, 2, COUNT)).toBeCloseTo(0.7);
    expect(carouselLayerOpacity(1.7, 0, COUNT)).toBe(0);
  });

  it('is continuous approaching a page boundary from both sides', () => {
    // Just below x=1 the incoming layer 1 is ~1 over layer 0 at 1 (covered);
    // at x=1 layer 1 is exactly 1 and layer 0 drops out invisibly.
    expect(carouselLayerOpacity(0.999, 1, COUNT)).toBeCloseTo(0.999);
    expect(carouselLayerOpacity(1, 1, COUNT)).toBe(1);
    expect(carouselLayerOpacity(1.001, 1, COUNT)).toBe(1);
  });

  it('never lets the backdrop bleed through mid-drag (composite weight = 1)', () => {
    // Painter's algorithm over the stack: with floor at 1 and the layer
    // above at f, total image weight is f + (1 - f) * 1 = 1 at any x.
    for (const x of [0, 0.25, 0.5, 0.99, 1.5, 2]) {
      const weights: number[] = [];
      let seenAbove = 1;
      for (let page = COUNT - 1; page >= 0; page -= 1) {
        const alpha = carouselLayerOpacity(x, page, COUNT);
        weights.push(alpha * seenAbove);
        seenAbove *= 1 - alpha;
      }
      const total = weights.reduce((sum, w) => sum + w, 0);
      expect(total).toBeCloseTo(1);
    }
  });

  it('clamps edge-bounce overshoot to the first/last page', () => {
    expect(carouselLayerOpacity(-0.3, 0, COUNT)).toBe(1);
    expect(carouselLayerOpacity(2.4, COUNT - 1, COUNT)).toBe(1);
    expect(carouselLayerOpacity(2.4, 1, COUNT)).toBe(0);
  });

  it('handles a single-page carousel', () => {
    expect(carouselLayerOpacity(0, 0, 1)).toBe(1);
    expect(carouselLayerOpacity(-0.2, 0, 1)).toBe(1);
  });
});

describe('setCarouselPages', () => {
  afterEach(() => setCarouselPages([]));

  it('dedupes value-equal registrations so identity churn is a no-op', () => {
    setCarouselPages([{ unit: 'sat', theme: 'artemis-3' }]);
    const first = getCarouselPages();
    setCarouselPages([{ unit: 'sat', theme: 'artemis-3' }]);
    expect(getCarouselPages()).toBe(first);
  });

  it('replaces pages when a unit or wallpaper actually changes', () => {
    setCarouselPages([{ unit: 'sat', theme: 'artemis-3' }]);
    setCarouselPages([
      { unit: 'sat', theme: 'artemis-3' },
      { unit: 'usd', theme: 'meadow-1' },
    ]);
    expect(getCarouselPages()).toHaveLength(2);
    expect(isCarouselTheme('meadow-1')).toBe(true);
    expect(isCarouselTheme('nonexistent')).toBe(false);
  });

  it('reports no carousel themes once the pager unregisters', () => {
    setCarouselPages([{ unit: 'sat', theme: 'artemis-3' }]);
    setCarouselPages([]);
    expect(isCarouselTheme('artemis-3')).toBe(false);
  });
});
