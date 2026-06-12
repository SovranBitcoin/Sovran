/**
 * Pins Android formSheet content to an exact full height and publishes the
 * sheet's known JS-header height.
 *
 * Why the fixed height: react-native-screens' single-detent sheets set
 * Material BottomSheetBehavior.isFitToContents = true (verified in RNS 4.25.2
 * BottomSheetBehaviorExt.kt), so the sheet's expanded offset tracks the
 * measured content height — short content produced a shorter sheet and a
 * content-dependent top gap. An exact-height frame (container minus the top
 * inset minus a small deliberate gap) makes every sheet open at the same
 * position regardless of content. The gap mirrors iOS pageSheet's visible
 * margin below the status bar (~10pt), so the screen behind — and RNS's
 * native dim scrim — peeks through at the top like it does on iOS.
 *
 * Why the context: native-stack initializes HeaderHeightContext to a default
 * (~56dp + top inset) and only corrects it after the custom header's first
 * onLayout, shifting sheet content by 16-31dp a frame or two after open.
 * Sheets with a known fixed-height header (FlowSheetHeader) publish that
 * constant here; Screen/ModalLayoutWrapper prefer it so the first frame and
 * the steady state agree.
 *
 * iOS (and any non-Android platform) renders children untouched.
 */
import React, { createContext } from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

export const SheetHeaderHeightContext = createContext<number | null>(null);

/** Visible gap between the status bar and the sheet's top edge — the iOS
 *  pageSheet margin equivalent. Content height controls the sheet position
 *  (isFitToContents), so the gap lives in the height math. */
const ANDROID_SHEET_TOP_GAP = 12;

interface AndroidSheetRootProps {
  children: React.ReactNode;
  /** Fixed JS-header height inside this sheet (e.g. FLOW_SHEET_HEADER_HEIGHT). */
  headerHeight?: number;
}

function AndroidSheetFrame({ children, headerHeight }: AndroidSheetRootProps) {
  const frame = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  const sheetHeight = Math.round(frame.height - insets.top - ANDROID_SHEET_TOP_GAP);
  return (
    <SheetHeaderHeightContext.Provider value={headerHeight ?? null}>
      <View style={{ height: sheetHeight, width: '100%' }}>{children}</View>
    </SheetHeaderHeightContext.Provider>
  );
}

export function AndroidSheetRoot({ children, headerHeight }: AndroidSheetRootProps) {
  if (Platform.OS !== 'android') return <>{children}</>;
  return <AndroidSheetFrame headerHeight={headerHeight}>{children}</AndroidSheetFrame>;
}
