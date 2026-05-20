import React from 'react';
import { StyleSheet, View as RNView, type StyleProp, type ViewStyle } from 'react-native';
import opacity from 'hex-color-opacity';

import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
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
}

/**
 * The same blur + corner-gradient frame the Transactions list wraps each
 * grouped section in. Use it for any detail card (timeline, mint info,
 * details list, etc.) so quote/token screens share the wallet's signature
 * look instead of rendering a flat `surface-secondary` block.
 */
export function GradientCard({ children, style, contentStyle, variant }: GradientCardProps) {
  const muted = useThemeColor('muted');
  const borderColor = opacity(muted, 0.3);

  return (
    <Log name="GradientCard">
      <RNView style={[styles.card, { borderColor }, style]}>
        <BlurCardFrame accentColor={muted} variant={variant}>
          <RNView style={[styles.content, contentStyle]}>{children}</RNView>
        </BlurCardFrame>
      </RNView>
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
