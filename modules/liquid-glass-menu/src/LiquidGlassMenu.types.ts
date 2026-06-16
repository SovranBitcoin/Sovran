import type { ViewProps } from 'react-native';

export type GlassMenuAction = {
  /** Opaque id echoed back in onSelectAction. */
  id: string;
  title: string;
  /** SF Symbol name (e.g. "dollarsign"). Omit/empty for no glyph. */
  image?: string;
  /** Renders the iOS checkmark for the active row. */
  selected?: boolean;
};

export type LiquidGlassMenuProps = {
  /** Pill label, e.g. "≈ $12.34". */
  label: string;
  /** "#RRGGBB" / "#RRGGBBAA". Defaults to the system label color. */
  labelColor?: string;
  labelSize?: number;
  /** Glass tint, "#RRGGBB" / "#RRGGBBAA". */
  tint?: string | null;
  /** Force the menu/glass to render in a specific scheme. */
  colorScheme?: 'light' | 'dark';
  /** Header shown above the menu items. */
  menuTitle?: string;
  /**
   * When true, a tap fires `onPrimaryPress` and the menu opens on long-press
   * (no glass morph on that path). When false (default), a tap opens the menu
   * via the glass button — this is the path that morphs on iOS 26.
   */
  hasPrimaryAction?: boolean;
  actions: GlassMenuAction[];
  onSelectAction?: (e: { nativeEvent: { id: string } }) => void;
  onPrimaryPress?: (e: { nativeEvent: Record<string, never> }) => void;
} & ViewProps;

export type LiquidGlassMenuNativeModule = {
  isSupported: boolean;
};
