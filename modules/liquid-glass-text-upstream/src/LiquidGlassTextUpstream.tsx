import * as React from 'react';
import { Platform, Text } from 'react-native';
import { requireNativeModule, requireNativeView } from 'expo';
import type {
  LiquidGlassTextUpstreamNativeModule,
  LiquidGlassTextUpstreamProps,
} from './LiquidGlassTextUpstream.types';

const NativeModule: LiquidGlassTextUpstreamNativeModule | null =
  Platform.OS === 'ios'
    ? requireNativeModule<LiquidGlassTextUpstreamNativeModule>('LiquidGlassTextUpstream')
    : null;

const NativeView =
  Platform.OS === 'ios'
    ? requireNativeView<LiquidGlassTextUpstreamProps>('LiquidGlassTextUpstream')
    : null;

const iosMajor = Platform.OS === 'ios' ? parseInt(String(Platform.Version), 10) : 0;

export const isSupported: boolean =
  Platform.OS === 'ios' && iosMajor >= 26 && Boolean(NativeModule?.isSupported);

export function LiquidGlassTextUpstream(
  props: LiquidGlassTextUpstreamProps
): React.ReactElement {
  const {
    text,
    fontName = '',
    fontSize = 48,
    fontWeight = 'heavy',
    tint = null,
    glassVariant = 'regular',
    interactive = false,
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
      />
    );
  }

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

LiquidGlassTextUpstream.isSupported = isSupported;
