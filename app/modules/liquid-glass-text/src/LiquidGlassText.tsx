import * as React from 'react';
import { Platform, Text } from 'react-native';
import { requireNativeModule, requireNativeView } from 'expo';
import type { LiquidGlassTextNativeModule, LiquidGlassTextProps } from './LiquidGlassText.types';

const NativeModule: LiquidGlassTextNativeModule | null =
  Platform.OS === 'ios' ? requireNativeModule<LiquidGlassTextNativeModule>('LiquidGlassText') : null;

const NativeView =
  Platform.OS === 'ios' ? requireNativeView<LiquidGlassTextProps>('LiquidGlassText') : null;

const iosMajor = Platform.OS === 'ios' ? parseInt(String(Platform.Version), 10) : 0;

export const isSupported: boolean =
  Platform.OS === 'ios' && iosMajor >= 26 && Boolean(NativeModule?.isSupported);

export function LiquidGlassText(props: LiquidGlassTextProps): React.ReactElement {
  const {
    text,
    fontName = '',
    fontSize = 48,
    fontWeight = 'heavy',
    tint = null,
    glassVariant = 'regular',
    interactive = false,
    colorScheme,
    debugShape = 'none',
    style,
    ...rest
  } = props;

  if (isSupported && NativeView) {
    return (
      <NativeView
        {...rest}
        style={style}
        text={text}
        fontName={fontName}
        fontSize={fontSize}
        fontWeight={fontWeight}
        tint={tint}
        glassVariant={glassVariant}
        interactive={interactive}
        colorScheme={colorScheme}
        debugShape={debugShape}
      />
    );
  }

  // iOS <26 / Android / web: plain text. Consumers typically switch to their
  // own rich fallback (e.g., AmountFormatter's non-liquid path) before
  // reaching this code, but keep a safe default so the view never renders
  // blank.
  return (
    <Text
      style={[
        { fontSize, fontWeight: fontWeight as any, color: tint ?? undefined },
        style as any,
      ]}
      accessibilityLabel={text}>
      {text}
    </Text>
  );
}

LiquidGlassText.isSupported = isSupported;
