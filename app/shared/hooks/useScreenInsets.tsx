import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { spacing } from '@/shared/styles/tokens';

// Scoped to the tab navigator. Root modal stacks are siblings and do not inherit it.
const TabBarInsetsContext = createContext<{
  mode: 'native' | 'docked';
  height: number;
  setHeight: (height: number) => void;
} | null>(null);

export function TabBarInsetsProvider({
  mode,
  children,
}: {
  mode: 'native' | 'docked';
  children: ReactNode;
}) {
  const [height, setHeight] = useState(0);
  const value = useMemo(() => ({ mode, height, setHeight }), [mode, height]);
  return <TabBarInsetsContext.Provider value={value}>{children}</TabBarInsetsContext.Provider>;
}

/** The custom bar reports its complete rendered height, including system navigation space. */
export function useReportTabBarHeight() {
  return useContext(TabBarInsetsContext)?.setHeight;
}

/** A parent frame can consume its bottom inset once for all descendant scrollers. */
export const ConsumedBottomInsetContext = createContext(false);
/** Screen publishes measured footer clearance to custom scrollers as well as its own. */
export const ScreenBottomPaddingContext = createContext(0);
/** Custom page scrollers consume this inside their content, never their viewport. */
export const ScreenTopPaddingContext = createContext(0);

/** Remaining inset inside this viewport, not the distance from the window bottom. */
export function useScreenInsets() {
  const insets = useSafeAreaInsets();
  const tabs = useContext(TabBarInsetsContext);
  const consumed = useContext(ConsumedBottomInsetContext);
  return {
    ...insets,
    // Native iOS supplies tab + home-indicator geometry in the local safe area.
    // Docked JS tabs already shorten the viewport on both iOS and Android.
    bottom: consumed || tabs?.mode === 'docked' ? 0 : insets.bottom,
    dockedTabBarHeight: tabs?.mode === 'docked' ? tabs.height : 0,
  };
}

/** For a manually inset page scroller. Use contentInsetAdjustmentBehavior="never". */
export function useScreenBottomPadding(extra: number = spacing.lg) {
  const { bottom } = useScreenInsets();
  const footerClearance = useContext(ScreenBottomPaddingContext);
  return Math.max(bottom + extra, footerClearance > 0 ? footerClearance - spacing.lg + extra : 0);
}

/** Page scroll content owns header clearance, local spacing and bottom safe area. */
export function useScreenContentPadding(style?: StyleProp<ViewStyle>, bottomSpacing?: number) {
  const headerPadding = useContext(ScreenTopPaddingContext);
  const bottomPadding = useScreenBottomPadding(bottomSpacing);
  const contentStyle = StyleSheet.flatten(style);
  const existingTop =
    contentStyle?.paddingTop ?? contentStyle?.paddingVertical ?? contentStyle?.padding ?? 0;
  return {
    headerPadding,
    contentPadding: {
      paddingBottom: bottomPadding,
      ...(headerPadding > 0
        ? { paddingTop: headerPadding + (typeof existingTop === 'number' ? existingTop : 0) }
        : {}),
    },
  };
}
