/**
 * How the viewer's optimistic like / repost / zap is laid over a note's
 * counts, and when that overlay may be dropped.
 *
 * The overlay lives in one global store (keyed by event id) but is read by
 * every surface that shows the note — the feed row, the thread, the image
 * overlay — each of which may hold counts fetched at a different moment. So
 * the overlay never adds a delta to "whatever base this surface has": a feed
 * like (5 → expect 6) re-read by a thread whose fresh count already includes
 * that like would show 7. Instead it pins the shown count toward the count
 * the viewer expects: at least `expectedCount` after a like, at most after an
 * unlike. A base that already reflects the action is shown as-is.
 */

export type ToggleOverlay = {
  value: boolean;
  pending: boolean;
  delta: number;
  expectedCount?: number;
  updatedAt?: number;
};

type ZapOverlay = {
  deltaSats: number;
  pending: boolean;
  expectedSats?: number;
};

/** A settled overlay whose count never caught up is dropped after this long. */
export const OPTIMISTIC_MAX_AGE_MS = 10 * 60_000;

/** Like/repost count a surface shows with the viewer's optimistic intent applied. */
export function overlayToggleCount(base: number, overlay: ToggleOverlay | undefined): number {
  if (!overlay) return base;
  // Entries written before `expectedCount` existed carry only a delta.
  if (overlay.expectedCount === undefined) return Math.max(0, base + overlay.delta);
  return overlay.value
    ? Math.max(base, overlay.expectedCount)
    : Math.max(0, Math.min(base, overlay.expectedCount));
}

/** Sats a surface shows with the viewer's confirmed-but-unaggregated zaps applied. */
export function overlayZapSats(base: number, overlay: ZapOverlay | undefined): number {
  if (!overlay) return base;
  if (overlay.expectedSats === undefined) return Math.max(0, base + overlay.deltaSats);
  return Math.max(base, overlay.expectedSats);
}

/**
 * Whether a like/repost overlay can be cleared. It stays while publishing,
 * and while the viewer's own-event sync still disagrees with it (clearing
 * then would flip the heart back). Once the sync agrees, it clears as soon as
 * the shared count has moved past the expectation in the action's direction,
 * or after {@link OPTIMISTIC_MAX_AGE_MS} so a count that never lands exactly
 * cannot pin the number forever.
 */
export function shouldSettleToggle(
  overlay: ToggleOverlay | undefined,
  confirmedValue: boolean,
  base: number,
  nowMs: number
): boolean {
  if (!overlay || overlay.pending) return false;
  if (confirmedValue !== overlay.value) return false;
  if (overlay.expectedCount === undefined) return true;
  const caughtUp = overlay.value ? base >= overlay.expectedCount : base <= overlay.expectedCount;
  return caughtUp || nowMs - (overlay.updatedAt ?? 0) >= OPTIMISTIC_MAX_AGE_MS;
}

/** A zap overlay clears once the aggregated sats reach what the viewer expects. */
export function shouldSettleZap(overlay: ZapOverlay | undefined, base: number): boolean {
  return (
    !!overlay && !overlay.pending && overlay.expectedSats != null && base >= overlay.expectedSats
  );
}
