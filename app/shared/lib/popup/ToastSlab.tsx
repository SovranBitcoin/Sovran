import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Toast } from 'heroui-native';

import { BlurView } from '@/shared/ui/primitives/BlurView';
import { useCapabilities } from '@/shared/ui/capability';
import {
  TOAST_DANGER_DARK_BG,
  TOAST_SUCCESS_DARK_BG,
  TOAST_WARNING_DARK_BG,
} from '@/shared/lib/brandColors';

/**
 * Frosted-glass toast frame shared by every custom toast (CompactToast,
 * PaymentStatusToast, SwapStatusToast). The slab owns the heroui Toast root
 * props, the optional BlurView at the back, and the standard content row
 * container — callers only render the tint layer (animated or static) and
 * the row content.
 */

const BLUR_INTENSITY = 60;
// Semi-transparent tint over the BlurView gives the toast its theme-tinted
// hue without flattening the frosted-glass look. The frosted branch is
// gated on Capabilities.frostedSurface (iOS-only): expo-blur on Android
// renders a weak translucent tint, NOT real blur (no experimentalBlurMethod
// set), so a 0.3-alpha tint over it read as a ghosted ~30%-opaque toast.
// Non-frosted platforms take the opaque surface branch instead.
export const TINT_ALPHA = 0.3;

/** Whether toasts render the iOS frosted-glass treatment (blur + 0.3 tint).
 *  Everywhere else (Android, by design) the tint is fully opaque. One hook
 *  so ToastSlab/CompactToast/StatusToast can't drift apart. */
export function useToastFrosted(): boolean {
  return useCapabilities().frostedSurface;
}
// "dark" variant is the surface, the bright theme `success`/`danger` token
// is the foreground (icon/text). Hardcoded since the toast is theme-
// invariant — these values match `--success-foreground` /
// `--danger-foreground` in the light-theme palette.
//
// On non-frosted platforms these hexes must never be used raw: with no
// blur softening them, a fully opaque #089A2C slab reads garishly strong.
// Blend them into the toast's surface color instead (same alpha-composite
// math the frosted tint performs optically over the blur). 0.45 rather
// than TINT_ALPHA because the opaque slab is dark — the frosted branch
// tints over mostly-light page content, so the same ratio over a dark
// base would under-read; 0.45 lands at the same perceived strength.
export const OPAQUE_TINT_MIX = 0.45;
export const SUCCESS_DARK_BG = TOAST_SUCCESS_DARK_BG;
export const DANGER_DARK_BG = TOAST_DANGER_DARK_BG;
export const WARNING_DARK_BG = TOAST_WARNING_DARK_BG;

type ToastVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger';

type ToastSlabProps = {
  /** Forwarded from the heroui toast manager (carries `hide`, ids, etc.). */
  toastProps: Record<string, unknown>;
  /** heroui Toast `variant` for callers that semantically tint via heroui. */
  variant?: ToastVariant;
  /**
   * The absolute-fill tint layer rendered above the BlurView. Static toasts
   * pass a plain `<View backgroundColor={...} />`; animated toasts pass an
   * `<Animated.View style={animatedStyle} />` so only the tint, not the
   * surrounding frame, recomposes per frame.
   */
  tint: ReactNode;
  children: ReactNode;
};

export function ToastSlab({ toastProps, variant, tint, children }: ToastSlabProps) {
  const frosted = useToastFrosted();
  return (
    <Toast
      placement="top"
      variant={variant}
      className="overflow-hidden bg-transparent p-0"
      isAnimatedStyleActive={false}
      // toastProps carries manager-injected props (index, total, heights,
      // show, hide) that aren't part of the public Toast type.
      {...(toastProps as any)}>
      {frosted && (
        <BlurView intensity={BLUR_INTENSITY} tint="dark" style={StyleSheet.absoluteFill} />
      )}
      {tint}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 14,
          gap: 12,
        }}>
        {children}
      </View>
    </Toast>
  );
}
