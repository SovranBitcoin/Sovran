/**
 * Android stand-in for the iOS header blur: solid background behind the bar
 * fading to transparent toward its bottom edge — a pure color gradient (no
 * blur — expo-blur on Android reads as a muddy dark tint), rendered fully
 * within the header's own bounds so it can't be clipped by its container.
 *
 * Lives in its own module (not config/flowLayoutOptions) so FlowSheetHeader
 * can import it without an import cycle — flowLayoutOptions already imports
 * FlowSheetHeader.
 */
import { memo } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';

export const AndroidHeaderScrim = memo(function AndroidHeaderScrim({
  backgroundColor,
}: {
  backgroundColor: string;
}) {
  return (
    <LinearGradient
      // Solid through ~78% (title text always sits over full background),
      // easing out over the bottom ~22% of the bar.
      colors={[
        backgroundColor,
        backgroundColor,
        opacity(backgroundColor, 0.85),
        opacity(backgroundColor, 0),
      ]}
      locations={[0, 0.78, 0.9, 1]}
      style={{ flex: 1 }}
    />
  );
});
