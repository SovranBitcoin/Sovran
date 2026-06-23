/**
 * Pure layout-geometry helpers for content-shift instrumentation.
 *
 * Rectangle math only — overlap, edges, viewport classification. No registry,
 * no logger, no React. Kept separate so the measurement/snapshot logic in
 * `contentShiftLog` reads as orchestration over these primitives.
 */

export type LayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function validRect(rect: LayoutRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

export function rectBottom(rect: LayoutRect): number {
  return rect.y + rect.height;
}

export function rectRight(rect: LayoutRect): number {
  return rect.x + rect.width;
}

export function verticalOverlap(a: LayoutRect, b: LayoutRect): number {
  return Math.min(rectBottom(a), rectBottom(b)) - Math.max(a.y, b.y);
}

export function horizontalOverlap(a: LayoutRect, b: LayoutRect): number {
  return Math.min(rectRight(a), rectRight(b)) - Math.max(a.x, b.x);
}

export function rectOverlap(a: LayoutRect, b: LayoutRect): { x: number; y: number; area: number } {
  const x = horizontalOverlap(a, b);
  const y = verticalOverlap(a, b);
  return { x, y, area: x > 0 && y > 0 ? x * y : 0 };
}

export function viewportFlags(rect: LayoutRect, viewport: { width: number; height: number }) {
  const bottom = rectBottom(rect);
  const right = rectRight(rect);
  const visible =
    rect.width > 0 &&
    rect.height > 0 &&
    bottom >= 0 &&
    rect.y <= viewport.height &&
    right >= 0 &&
    rect.x <= viewport.width;
  const farOutsideY = rect.y < -viewport.height * 2 || rect.y > viewport.height * 3;
  const farOutsideX = rect.x < -viewport.width * 2 || rect.x > viewport.width * 3;
  const absurdHeight = rect.height > viewport.height * 3;
  const absurdWidth = rect.width > viewport.width * 3;
  const zeroArea = rect.width <= 0 || rect.height <= 0;
  return {
    visible,
    offscreenTop: bottom < 0,
    offscreenBottom: rect.y > viewport.height,
    offscreenLeft: right < 0,
    offscreenRight: rect.x > viewport.width,
    farOutsideY,
    farOutsideX,
    absurdHeight,
    absurdWidth,
    zeroArea,
  };
}
