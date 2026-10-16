import React, { createContext, useContext } from 'react';
import { StyleSheet, View as RNView, type StyleProp, type ViewStyle } from 'react-native';

import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { SquircleView } from '@/shared/ui/primitives/SquircleView';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { withAlpha } from '@/shared/lib/color';
import { Log } from '@/shared/lib/logger';
import { zIndex } from '@/shared/styles/tokens';

type GlowVariant = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'diagonal' | 'right';

interface SurfaceProps {
  children?: React.ReactNode;
  /** Style applied to the outer frame. */
  style?: StyleProp<ViewStyle>;
  /** Style applied to the content layer. */
  contentStyle?: StyleProp<ViewStyle>;
  /** Corner-glow placement. Only the glass style draws one. */
  variant?: GlowVariant;
  /** Keep the frame and content geometry while hiding unresolved contents. */
  loading?: boolean;
  /**
   * The content is media that fills the frame edge to edge — a map, an image,
   * a QR code. Media needs a clipped, rounded frame in every style, including
   * `flat`, where a text group needs none.
   */
  media?: boolean;
  testID?: string;
}

/**
 * Horizontal inset a row inside the nearest `Surface` should use. A framed
 * surface insets its rows by the style's padding; a bare one (the `flat`
 * style) insets them by nothing, so they line up with the screen gutter and
 * with every heading above them.
 */
const SurfaceInsetContext = createContext<number | null>(null);

/** The inset for a row in the nearest `Surface`, or `fallback` outside one. */
export function useSurfaceInset(fallback = 16): number {
  return useContext(SurfaceInsetContext) ?? fallback;
}

/**
 * The one container for grouped content: a transaction section, a details
 * list, a settings group. How it separates from the canvas — a fill, a
 * stroke, glass, or nothing at all — is the active style's decision, made once
 * in `useStylePaint`. Do not hand-roll a background + radius + border `View`
 * for this job.
 */
export function Surface({
  children,
  style,
  contentStyle,
  variant,
  loading = false,
  media = false,
  testID,
}: SurfaceProps) {
  const paint = useStylePaint();
  // The glass card's glow and edge are tinted with the theme's muted tone, as
  // they were before `Surface` replaced `GradientCard`. Tinting them with the
  // text colour instead made every card's glass read noticeably stronger.
  const muted = useThemeColor('muted');
  const content = (
    <RNView
      style={[styles.content, contentStyle]}
      className={loading ? 'opacity-0' : undefined}
      pointerEvents={loading ? 'none' : undefined}
      accessibilityElementsHidden={loading}
      importantForAccessibility={loading ? 'no-hide-descendants' : 'auto'}>
      {children}
    </RNView>
  );

  // Glass keeps the frosted frame with its hairline edge: over a blur, the
  // edge is the material's own highlight rather than a second separator.
  if (paint.style.surface === 'glass') {
    return (
      <Log name="Surface">
        <SurfaceInsetContext.Provider value={paint.style.space.pad}>
          <SquircleView
            testID={testID}
            style={[styles.glass, { borderColor: withAlpha(muted, 0.3) }, style]}>
            <BlurCardFrame accentColor={muted} variant={variant}>
              {content}
            </BlurCardFrame>
          </SquircleView>
        </SurfaceInsetContext.Provider>
      </Log>
    );
  }

  return (
    <Log name="Surface">
      <SurfaceInsetContext.Provider value={paint.cardIsBare && !media ? 0 : paint.style.space.pad}>
        <RNView
          testID={testID}
          style={[
            paint.card,
            media && paint.cardIsBare
              ? { backgroundColor: paint.chipFill, borderRadius: paint.style.radius.card }
              : null,
            style,
          ]}>
          {content}
        </RNView>
      </SurfaceInsetContext.Provider>
    </Log>
  );
}

const styles = StyleSheet.create({
  glass: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  content: {
    zIndex: zIndex.raised,
  },
});
