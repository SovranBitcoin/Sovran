import type { ViewProps } from 'react-native';

export type FontWeight =
  | 'ultraLight'
  | 'thin'
  | 'light'
  | 'regular'
  | 'medium'
  | 'semibold'
  | 'bold'
  | 'heavy'
  | 'black';

export type GlassVariant = 'clear' | 'regular';

export type LiquidGlassTextUpstreamProps = {
  text: string;
  /** Registered UIFont name (e.g. "Overpass-Heavy"). Falls back to system font at `fontWeight` when empty/missing. */
  fontName?: string;
  fontSize?: number;
  fontWeight?: FontWeight;
  /** "#RRGGBB". When null, system label color is used. */
  tint?: string | null;
  glassVariant?: GlassVariant;
  interactive?: boolean;
  onLayout?: (e: { nativeEvent: { width: number; height: number } }) => void;
} & ViewProps;

export type LiquidGlassTextUpstreamNativeModule = {
  isSupported: boolean;
  isLiquidGlassAvailable(): boolean;
};
