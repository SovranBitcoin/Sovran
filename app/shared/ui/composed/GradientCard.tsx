import React from 'react';
import { StyleSheet, View as RNView, type StyleProp, type ViewStyle } from 'react-native';
import { withAlpha } from '@/shared/lib/color';

import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { SquircleView } from '@/shared/ui/primitives/SquircleView';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';
import { zIndex } from '@/shared/styles/tokens';

type GlowVariant = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'diagonal' | 'right';

interface GradientCardProps {
  children?: React.ReactNode;
  /** Style applied to the outer rounded/bordered frame. */
  style?: StyleProp<ViewStyle>;
  /** Style applied to the content layer above the gradient. */
  contentStyle?: StyleProp<ViewStyle>;
  variant?: GlowVariant;
  /** Keep the frame and content geometry while hiding unresolved contents. */
  loading?: boolean;
  testID?: string;
}

/**
 * The same blur + corner-gradient frame the Transactions list wraps each
 * grouped section in. Use it for any detail card (timeline, mint info,
 * details list, etc.) so quote/token screens share the wallet's signature
 * look instead of rendering a flat `surface-secondary` block.
 */
export function GradientCard({
  children,
  style,
  contentStyle,
  variant,
  loading = false,
  testID,
}: GradientCardProps) {
  const muted = useThemeColor('muted');
  const borderColor = withAlpha(muted, 0.3);

  return (
    <Log name="GradientCard">
      <SquircleView testID={testID} style={[styles.card, { borderColor }, style]}>
        <BlurCardFrame accentColor={muted} variant={variant}>
          <RNView
            style={[styles.content, contentStyle]}
            className={loading ? 'opacity-0' : undefined}
            pointerEvents={loading ? 'none' : undefined}
            accessibilityElementsHidden={loading}
            importantForAccessibility={loading ? 'no-hide-descendants' : 'auto'}>
            {children}
          </RNView>
        </BlurCardFrame>
      </SquircleView>
    </Log>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  content: {
    zIndex: zIndex.raised,
  },
});
