/**
 * Tuning constants for the in-thread link embed (X-style collapsible thread
 * sheet over an in-app web view). Snap geometry is a fraction of the window
 * height so it scales across devices; everything else routes through the locked
 * design-token scales.
 *
 * Three snap points (as sheet slide-down distance from its resting top):
 * - expanded: 0 — the full thread.
 * - middle:   `MIDDLE_REVEAL_FRACTION` of the screen revealed for the web view.
 * - inline:   slid down until only the floating action bar remains.
 */
import { radius } from '@/shared/styles/tokens';

/**
 * Fraction of the window height revealed for the web embed at the MIDDLE snap.
 * Slightly larger than the previous single snap so the sheet is a touch
 * smaller / shows more of the page.
 */
export const MIDDLE_REVEAL_FRACTION = 0.7;

/** Fallback action-bar height (px) used for the inline snap until it's measured. */
export const INLINE_ACTION_BAR_FALLBACK = 96;

/** Extra px kept visible above the action bar at the inline snap so the drag
 *  handle (grabber) stays on screen. */
export const INLINE_HANDLE_PEEK = 18;

/** Web-view scroll-down distance (px) that locks the sheet to the inline snap. */
export const WEBVIEW_SCROLL_TO_INLINE = 8;

/** Velocity (px/s) past which a flick commits to the next snap in that direction. */
export const SNAP_VELOCITY_THRESHOLD = 800;

/** Downward drag distance (px) before the sheet pan claims the gesture. */
export const SHEET_PAN_ACTIVATION = 12;

/** Spring used for every snap (open / close / release). */
export const SHEET_SPRING = { damping: 22, stiffness: 220, mass: 0.6 } as const;

/** Top corner radius the sheet reaches once collapsed (0 when fully expanded). */
export const SHEET_COLLAPSED_RADIUS = radius.xl;
