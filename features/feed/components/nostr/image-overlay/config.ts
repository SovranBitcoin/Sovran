/**
 * Image overlay touch UX and animation configuration.
 * Tune gesture sensitivity, spring feel, and layout here instead of digging through components.
 */

// -----------------------------------------------------------------------------
// Dismiss gesture (vertical drag to close overlay)
// -----------------------------------------------------------------------------

/** Min movement (px) before the pan is recognized. */
export const DISMISS_MIN_DISTANCE = 6;

/**
 * Vertical movement (px) required to activate dismiss. Horizontal within this
 * range keeps the gesture ambiguous so pager can win.
 */
export const DISMISS_ACTIVE_OFFSET_Y = 14;

/** How much the image follows the finger (0–1). Higher = more direct. */
export const DISMISS_DRAG_FOLLOW = 0.85;

/** Drag distance (fraction of screen width) over which scale goes 1 → 0.9 and blur 100 → 0. */
export const DISMISS_DRAG_RANGE_FRACTION = 0.35;

/** Scale at full drag (start = 1). */
export const DISMISS_SCALE_AT_DRAG = 0.9;

/** Blur intensity at rest (open); at full drag it goes to 0. */
export const DISMISS_BLUR_AT_REST = 100;

/** Dismiss is confirmed when drag distance exceeds this fraction of max(expandedWidth, expandedHeight). */
export const DISMISS_THRESHOLD_FRACTION = 1 / 4;

/** Duration (ms) to fade out the close button when dismiss pan starts. */
export const DISMISS_CLOSE_BTN_FADE_DURATION_MS = 200;

// -----------------------------------------------------------------------------
// Pager gesture (horizontal swipe between images)
// -----------------------------------------------------------------------------

/** Min movement (px) before pager pan is recognized. */
export const PAGER_MIN_DISTANCE = 6;

/**
 * Horizontal movement (px) required to activate pager. Vertical within this
 * range keeps the gesture ambiguous so dismiss can win.
 */
export const PAGER_ACTIVE_OFFSET_X = 20;

/**
 * Vertical movement (px) that fails the pager gesture (so dismiss takes over).
 * Smaller = easier to trigger dismiss with a vertical swipe.
 */
export const PAGER_FAIL_OFFSET_Y = 8;

/**
 * Weight for velocity when deciding snap target: effective = position + velocity * weight.
 * Higher = quick swipes (momentum) flip the page more easily.
 */
export const PAGER_VELOCITY_WEIGHT = 0.32;

/**
 * If release velocity (in page units) exceeds this, always snap in that direction.
 * Makes quick flicks reliably change page even with small drag.
 */
export const PAGER_FLICK_VELOCITY_THRESHOLD = 0.55;

/** Clamp for velocity (page units) passed to spring when snapping back to same page. */
export const PAGER_VELOCITY_CLAMP = 12;

// -----------------------------------------------------------------------------
// Swipe up on video (go to next post)
// -----------------------------------------------------------------------------

/** Vertical movement (px) upward required to activate swipe-up-to-next-post (on overlay bar). Negative = upward. */
export const SWIPE_UP_ACTIVE_OFFSET_Y = -28;

/** Horizontal movement (px) that fails swipe-up (so pager/dismiss can win). */
export const SWIPE_UP_FAIL_OFFSET_X = 40;

/** Min upward distance (px) to confirm next-post. */
export const SWIPE_UP_CONFIRM_DISTANCE = 10;

/** Duration (ms) for slide-off (current) and slide-in (next) when going to next post. */
export const SWIPE_UP_TRANSITION_DURATION_MS = 280;

// -----------------------------------------------------------------------------
// Springs and timing (overlay)
// -----------------------------------------------------------------------------

/** Spring when snapping back to the same page (no page change). */
export const SNAP_SPRING_SAME_PAGE = {
  duration: 580,
  dampingRatio: 1,
} as const;

/**
 * Spring when moving to next/prev page. Softer/longer so it eases into place
 * instead of feeling like a snap.
 */
export const SNAP_SPRING_PAGE_CHANGE = {
  duration: 420,
  dampingRatio: 0.92,
} as const;

// -----------------------------------------------------------------------------
// Pagination dots
// -----------------------------------------------------------------------------

export const DOTS_SIZE = 6;
export const DOTS_GAP = 4;

/** Scale curve: [position -2, -1, 0, 1, 2] → scale values (current = 0). */
export const DOTS_SCALE_INPUT = [-2, -1, 0, 1, 2] as const;
export const DOTS_SCALE_OUTPUT = [0.3, 0.7, 1, 0.7, 0.3] as const;

/** Opacity: [abs(position) 0, 0.5, 1] → opacity (current = 0 is brightest). */
export const DOTS_OPACITY_INPUT = [0, 0.5, 1] as const;
export const DOTS_OPACITY_OUTPUT = [1, 0.85, 0.4] as const;

export const DOTS_ACTIVE_COLOR = 'rgba(255,255,255,0.95)';

// -----------------------------------------------------------------------------
// UI layout (overlay)
// -----------------------------------------------------------------------------

export const CLOSE_BUTTON_LEFT = 16;
export const CLOSE_BUTTON_TOP_OFFSET = 16;
export const CLOSE_BUTTON_PADDING = 4;
export const CLOSE_BUTTON_BG = 'rgba(0,0,0,0.5)';

export const IMAGE_WRAP_BORDER_RADIUS = 12;

export const DOT_PAGER_BOTTOM = 16;

/** Min height (px) of bottom panel area; taps in this region do not close the overlay. */
export const BOTTOM_PANEL_SAFE_HEIGHT = 220;

/** Height (px) of the absolute overlay bar when sheet is closed (pfp, truncated content, metric buttons). */
export const BOTTOM_PANEL_ABSOLUTE_OVERLAY_HEIGHT = 200;

/** When sheet is open, snap point as fraction of screen height (e.g. 0.6 = 60%). */
export const BOTTOM_PANEL_SHEET_SNAP_60_FRACTION = 0.6;

/** When panel is visible (same-layer layout), max fraction of screen height the panel can occupy (image gets the rest). */
export const BOTTOM_PANEL_MAX_HEIGHT_FRACTION = 1;

/** Inset (px) subtracted from max sheet height so a strip of the image stays visible when sheet is fully expanded. */
export const BOTTOM_PANEL_MAX_HEIGHT_INSET_PX = 32;

/** Duration (ms) for panel height changes (set/snap). Slightly longer for smooth open/close. */
export const BOTTOM_PANEL_STIFF_DURATION_MS = 280;

/** Border radius (px) for the top corners of the bottom sheet. */
export const BOTTOM_PANEL_SHEET_TOP_BORDER_RADIUS = 24;

/** Bottom panel (post info) padding and layout. */
export const BOTTOM_PANEL_PADDING_TOP = 12;
export const BOTTOM_PANEL_PADDING_HORIZONTAL = 16;
export const BOTTOM_PANEL_PADDING_BOTTOM_EXTRA = 12;

// -----------------------------------------------------------------------------
// Provider: open / expand and close / dismiss (shared config)
// -----------------------------------------------------------------------------

/** Delay (ms) before starting the expand so the overlay can mount and paint the thumbnail. */
export const OPEN_START_DELAY_MS = 0;

/** Spring for image position/size (open and close). Damping high enough to avoid overshoot past thumbnail. */
export const CLOSE_SPRING = {
  damping: 32,
  stiffness: 320,
  mass: 0.8,
} as const;

/** Duration (ms) for blur and close-button fade (open and close). */
export const CLOSE_BLUR_AND_BTN_DURATION_MS = 320;

/** Delay (ms) after close animation before clearing overlay URLs (avoids flash). */
export const CLEAR_URL_DELAY_MS = 50;

// -----------------------------------------------------------------------------
// Provider: thumbnail blur (feed thumbnails blur while overlay is displaced)
// -----------------------------------------------------------------------------

/** Displacement (position + size) is normalized by thumbDiag * this factor. */
export const THUMB_BLUR_DISTANCE_FACTOR = 1.5;

/** Thumbnail blur intensity = displacement * this (0–80). */
export const THUMB_BLUR_MAX_INTENSITY = 80;
