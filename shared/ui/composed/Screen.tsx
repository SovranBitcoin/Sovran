/**
 * Unified screen wrapper. One boilerplate covers every route in the app:
 *   <Screen name="XyzScreen" footer={<BottomButtons>...}>...content...</Screen>
 *
 * What it handles internally:
 *   - log-doctor screen boundary (`Log` path context + testID tree)
 *   - safe-area top + native header height (inherits from ModalLayoutWrapper)
 *   - scroll mode: auto (ScrollView) | animated (Animated.ScrollView) | none | custom
 *   - footer rendering + auto-measured bottom padding so content never hides
 *     behind a BottomButtons bar. Callers no longer pass bottomPadding.
 *   - optional sticky sub-header, header gradient, debug overlays.
 *
 * For navigation header options (title / left / right), use `useScreenOptions`
 * — not an inline <Stack.Screen>.
 */

import React, {
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
} from 'react';
import { Platform, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { SheetHeaderHeightContext } from '@/shared/ui/composed/AndroidSheetRoot';
import type { NativeStackNavigationOptions } from 'expo-router';

import { Log } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useDeferredMount } from '@/shared/hooks/useDeferredMount';
import { ModalLayoutWrapper } from './ModalLayoutWrapper';
import { ScreenBackgroundContext, ScreenFooterContext } from './ScreenFooterContext';

type ScreenScrollMode = 'auto' | 'animated' | 'none' | 'custom';

interface ScreenProps {
  /** Required. Names the screen boundary for log-doctor + phone-tree testID paths. */
  name: string;
  children: ReactNode;
  /**
   * `auto` (default) wraps children in a plain ScrollView.
   * `animated` uses Animated.ScrollView and exposes scroll offset via `scrollY`.
   * `none` renders children directly with no scroll container.
   * `custom` also renders children directly — use when you supply your own
   *   scroller (FlatList / FlashList) and want the wrapper to hands-off.
   */
  scroll?: ScreenScrollMode;
  scrollY?: SharedValue<number>;
  /** Fixed footer (typically <BottomButtons>). Measured automatically. */
  footer?: ReactNode;
  /** Sticky content rendered below the native header. */
  stickyContent?: ReactNode;
  stickyContentHeight?: number;
  contentPadding?: number;
  headerGradient?: boolean;
  headerGradientHeight?: number;
  /** Override the theme background. Defaults to `useThemeColor('background')`. */
  bgColor?: string;
  /**
   * Force a specific bottom padding. Leave undefined to auto-compute from the
   * measured footer height (or 16 when no footer).
   */
  bottomPadding?: number;
  debug?: boolean;
  disableHeaderSpacer?: boolean;
  onHeaderHeightChange?: (height: number) => void;
  scrollIndicatorInsets?: { top?: number; right?: number; bottom?: number; left?: number };
  /**
   * Defer mounting the content subtree until just after the first commit so the
   * native-stack present/slide can start on a cheap frame (themed background
   * only), then fill in the content. Default `true`. Set `false` for screens
   * that must render synchronously on mount — e.g. ones that auto-focus a text
   * input or measure a child immediately (the input/child would otherwise not
   * exist when the focus/measure fires). See `useDeferredMount`.
   */
  deferContent?: boolean;
  /**
   * Apply safe-area top/bottom padding to the content frame. Only meaningful
   * with `scroll="custom"` or `scroll="none"` — when a ScrollView is used it
   * handles the insets itself via `contentInsetAdjustmentBehavior="automatic"`.
   *
   * Top padding is `insets.top + headerHeight` so transparent stack headers
   * never clip content. Outside a navigator, `headerHeight` is 0 and this
   * collapses to the status-bar inset (e.g. pre-navigation onboarding).
   */
  safeArea?: boolean;
}

const FOOTER_CLEARANCE = 16;
// The pre-refactor `ModalLayoutWrapper` default was 120 — every screen that
// relied on the default was built with this much bottom clearance above the
// BottomButtons bar. Keep it as a floor so auto-measured padding never sits
// closer to the buttons than legacy screens expected. Callers can still
// override with an explicit `bottomPadding` prop.
const FOOTER_MIN_PADDING = 120;

export function Screen({
  name,
  children,
  scroll = 'auto',
  scrollY,
  footer,
  stickyContent,
  stickyContentHeight,
  contentPadding,
  headerGradient,
  headerGradientHeight,
  bgColor,
  bottomPadding,
  debug,
  disableHeaderSpacer,
  onHeaderHeightChange,
  scrollIndicatorInsets,
  safeArea = false,
  deferContent = true,
}: ScreenProps) {
  const [measuredFooterHeight, setMeasuredFooterHeight] = useState(0);
  // Track what we last committed to state so we can ignore onLayout callbacks
  // that don't meaningfully change the footer height. Subpixel fluctuations
  // (and button text changes like "Paste" → "Pasting...") otherwise fire a
  // full Screen re-render on every layout event, which can steal taps from
  // PressableFeedback components higher in the tree (e.g. MintSelector).
  const committedHeightRef = useRef(0);

  const updateFooterHeight = useCallback((height: number) => {
    const rounded = Math.round(height);
    if (Math.abs(rounded - committedHeightRef.current) < 2) return;
    committedHeightRef.current = rounded;
    setMeasuredFooterHeight(rounded);
  }, []);

  const footerContextValue = useMemo(
    () => ({ setFooterHeight: updateFooterHeight }),
    [updateFooterHeight]
  );

  // Defer the content subtree so the modal present starts on a cheap frame.
  // The Log boundary + ModalLayoutWrapper background stay mounted immediately,
  // so the modal shows its themed background (no white flash) and log-doctor's
  // screen testID appears right away; only `children`/`footer` wait one tick.
  const contentReady = useDeferredMount(deferContent);

  const insets = useSafeAreaInsets();
  // Match ModalLayoutWrapper: read header height directly so this is safe to
  // render outside a Stack navigator (returns 0 in that case). Inside an
  // Android formSheet, prefer the sheet's KNOWN fixed header height — the
  // navigator context starts at a default (~80dp) and only settles to the
  // measured value a frame later, shifting content (see AndroidSheetRoot).
  const sheetHeaderHeight = useContext(SheetHeaderHeightContext);
  const navigatorHeaderHeight = useContext(HeaderHeightContext) ?? 0;
  const headerHeight = sheetHeaderHeight ?? navigatorHeaderHeight;
  const themeBackground = useThemeColor('background');
  const resolvedBgColor = bgColor ?? themeBackground;

  // Inside an Android formSheet, declare the page's actual background to the
  // sheet header: FlowSheetHeader reads headerStyle.backgroundColor for its
  // scrim color. Without this, screens that override bgColor (mint list/add,
  // notifications) get a scrim fading from the darker theme background — a
  // visibly wrong-colored slab across the top of the page.
  const navigation = useNavigation();
  useLayoutEffect(() => {
    if (Platform.OS !== 'android' || sheetHeaderHeight == null || bgColor == null) return;
    navigation.setOptions({ headerStyle: { backgroundColor: bgColor } });
  }, [navigation, sheetHeaderHeight, bgColor]);

  const resolvedBottomPadding =
    bottomPadding ??
    (footer
      ? Math.max(measuredFooterHeight + FOOTER_CLEARANCE, FOOTER_MIN_PADDING)
      : FOOTER_CLEARANCE);

  const useCustomScrollView = scroll === 'custom' || scroll === 'none';

  // When a Stack header is present we already get insets.top baked into
  // headerHeight, so adding insets.top would double-count. Outside a Stack
  // headerHeight is 0 and we fall back to insets.top.
  const safeAreaTopPadding = headerHeight > 0 ? headerHeight : insets.top;

  const framedChildren =
    safeArea && useCustomScrollView ? (
      <View style={{ flex: 1, paddingTop: safeAreaTopPadding, paddingBottom: insets.bottom }}>
        {children}
      </View>
    ) : (
      children
    );

  return (
    <Log name={name} style={{ flex: 1 }}>
      <ScreenBackgroundContext.Provider value={resolvedBgColor}>
        <ScreenFooterContext.Provider value={footerContextValue}>
          <ModalLayoutWrapper
            debug={debug}
            contentPadding={contentPadding}
            headerGradient={headerGradient}
            headerGradientHeight={headerGradientHeight}
            stickyContent={stickyContent}
            stickyContentHeight={stickyContentHeight}
            useAnimatedScroll={scroll === 'animated'}
            scrollY={scrollY}
            useCustomScrollView={useCustomScrollView}
            bottomPadding={resolvedBottomPadding}
            disableHeaderSpacer={disableHeaderSpacer}
            onHeaderHeightChange={onHeaderHeightChange}
            scrollIndicatorInsets={scrollIndicatorInsets}
            bgColor={bgColor}
            bottomContent={contentReady ? footer : undefined}>
            {contentReady ? framedChildren : null}
          </ModalLayoutWrapper>
        </ScreenFooterContext.Provider>
      </ScreenBackgroundContext.Provider>
    </Log>
  );
}

/**
 * Imperatively set the screen's navigation header options. Use this in place
 * of inline `<Stack.Screen options={...} />` JSX inside route files.
 *
 * Call it with a factory + deps — `useLayoutEffect` runs it synchronously so
 * the header updates in the same commit as the rest of the screen.
 */
export function useScreenOptions(
  factory: () => Partial<NativeStackNavigationOptions>,
  deps: React.DependencyList
) {
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions(factory());
    // factory is intentionally left out of deps — callers declare what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, ...deps]);
}
