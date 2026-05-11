/**
 * Shared shape constants for animated `loading → success | error` status
 * indicators. Used by `PaymentStatusIcon` and `SettingsRecoveryScreen`'s
 * shield icon — both draw the same circle, then either a checkmark or a
 * cross, on top of stroke-dasharray timing.
 *
 * The choreography (spinner during loading; circle drawn over 1s; symbol
 * drawn 200ms after the circle finishes) lives in the consumer alongside
 * its own colors and shared values — these constants are the path data
 * and stroke-length numbers, nothing more. That's enough to keep the
 * geometry consistent without forcing every consumer through one rigid
 * component shell.
 *
 * Use these whenever you'd otherwise paste in a 24x24 spinner→check/cross
 * SVG. If you need a *non-animated* check, use
 * `<Icon name="fluent:checkmark-16-filled" />` or `SelectableCheck`.
 */

export const STATUS_PATH = {
  /** Full 24x24 viewBox. Stroke-dasharray of `STATUS_LENGTH.circle` lets
   *  the circle draw from `STATUS_OFFSET.pendingCircle` (visible quarter)
   *  to 0 (fully drawn). */
  circle:
    'M3 12c0 -4.97 4.03 -9 9 -9c4.97 0 9 4.03 9 9c0 4.97 -4.03 9 -9 9c-4.97 0 -9 -4.03 -9 -9Z',
  checkmark: 'M8 12l3 3l5 -5',
  cross: 'M12 12l4 4M12 12l-4 -4M12 12l-4 4M12 12l4 -4',
} as const;

export const STATUS_LENGTH: { circle: number; checkmark: number; cross: number } = {
  circle: 60,
  checkmark: 14,
  cross: 23,
};

export const STATUS_OFFSET: { pendingCircle: number } = {
  /** Initial dash offset for the circle while the indicator is in
   *  `loading`. Combined with the rotation animation it produces the
   *  visible spinning quarter-arc. */
  pendingCircle: 45,
};
