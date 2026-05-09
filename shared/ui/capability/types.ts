/**
 * @fileoverview Capability axes for platform-and-version-aware components.
 *
 * Capabilities are *intent* axes, not raw OS feature detection. `frostedSurface`
 * encodes the design choice "render composed components with BlurCardFrame";
 * today that's iOS-only even though Android supports `BlurView`. Encoding it
 * as a named axis means there's one place to flip it later.
 *
 * Read via `useCapabilities()` from `./index`. The detection logic lives in
 * `./detect`. The variant-dispatch helper is `./defineVariants`.
 */

export type IconSource = 'sf-symbol' | 'monicon';

export interface Capabilities {
  /**
   * SwiftUI `buttonStyle('glass')` + `glassEffect` available. iOS / iPadOS /
   * macOS 26+. Gated by `LIQUID_GLASS_ENABLED` build flag and `mockNoGlass`
   * runtime toggle.
   */
  readonly liquidGlass: boolean;
  /**
   * Native `BlurView` renders correctly. iOS 13+ / Android 31+ / macOS 14+.
   * Raw OS support — see `frostedSurface` for the design-intent axis.
   */
  readonly blur: boolean;
  /**
   * Render composed components (CapsuleButton, BalancePill, FiatCurrencyPill)
   * with a `BlurCardFrame` chrome instead of a flat `surface-secondary` bg.
   * Currently true on iOS only — Android stays flat by design even though
   * it supports `BlurView`. Flip this to broaden the frosted look later
   * without grepping for `Platform.OS`.
   */
  readonly frostedSurface: boolean;
  readonly linearGradient: boolean;
  readonly meshGradient: boolean;
  readonly icon: IconSource;
}
