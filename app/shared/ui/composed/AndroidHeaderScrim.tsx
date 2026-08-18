/**
 * Android stand-in for the iOS header blur: solid background behind the bar
 * easing to transparent — a pure color gradient (no blur — expo-blur on
 * Android reads as a muddy dark tint).
 *
 * The stops come from react-native-easing-gradient (the same recipe
 * ScrollEdgeFade/BottomButtons use): ~14 dense stops with zero slope at both
 * ends, so there is no visible kink mid-fade and no hard line where the
 * gradient terminates. The fade interpolates bg → withAlpha(bg, 0) — never the
 * literal 'transparent', which would fade through black.
 *
 * Two geometries:
 * - Custom JS sheet headers (FlowSheetHeader / FormSheetChrome) pass a
 *   `height` taller than the bar — native-stack's custom-header wrapper has
 *   no overflow clip, so the fade tail paints below the bar over scrolling
 *   content.
 * - The NATIVE headerBackground path (androidHeaderScrimOptions — settings/
 *   user card stacks) must NOT pass height: native-stack clips that wrapper
 *   to the header bounds (styles.background has overflow:'hidden'), so the
 *   scrim fills it (flex:1) with a lower solid anchor instead.
 *
 * When a surface should NOT have a scrim: solid header fills (chat screens)
 * or layouts where content never underlaps the bar; immersive surfaces
 * (stories, camera). Per-screen `headerBackground: () => null` remains the
 * sanctioned opt-out on flow sheets.
 *
 * Lives in its own module (not config/flowLayoutOptions) so FlowSheetHeader
 * can import it without an import cycle — flowLayoutOptions already imports
 * FlowSheetHeader.
 */
import { memo, useMemo } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { easeGradient } from 'react-native-easing-gradient';
import { withAlpha } from '@/shared/lib/color';

/** Default solid anchor for the clipped native-header path (fade spans the
 *  bottom ~45% of the taller native bar). */
const NATIVE_BAR_ANCHOR = 0.55;

export const AndroidHeaderScrim = memo(function AndroidHeaderScrim({
  backgroundColor,
  height,
  anchor,
}: {
  backgroundColor: string;
  /** Total gradient height. Omit to fill the container (clipped native path). */
  height?: number;
  /** Fraction (0-1) through which the scrim stays fully solid. */
  anchor?: number;
}) {
  const solidUntil = anchor ?? NATIVE_BAR_ANCHOR;
  const { colors, locations } = useMemo(() => {
    const eased = easeGradient({
      colorStops: {
        0: { color: backgroundColor },
        [solidUntil]: { color: backgroundColor },
        1: { color: withAlpha(backgroundColor, 0) },
      },
    });
    return {
      colors: eased.colors as [string, string, ...string[]],
      locations: eased.locations as [number, number, ...number[]],
    };
  }, [backgroundColor, solidUntil]);

  return (
    <LinearGradient
      colors={colors}
      locations={locations}
      style={height != null ? { height } : { flex: 1 }}
    />
  );
});
