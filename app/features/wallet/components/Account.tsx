import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import PagerView, {
  type PageScrollStateChangedNativeEvent,
  type PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view';

import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { PrimaryBalance } from '@/features/wallet/components/PrimaryBalance';
import { useActiveUnit } from '@/features/wallet/hooks/useActiveUnit';
import { useThemeStore } from '@/shared/stores/profile/themeStore';
import { useWallpaperStore } from '@/shared/stores/global/wallpaperStore';
import { resolveUnitWallpaper } from '@/shared/lib/theme/resolveUnitWallpaper';
import {
  cancelThemeDrag,
  releaseThemeDrag,
  surfaceOfTheme,
} from '@/shared/lib/theme/themeTransition';

import { Log, walletLog } from '@/shared/lib/logger';
import { zIndex } from '@/shared/styles/tokens';

const BALANCE_BOTTOM_INSET = 24;

interface AccountProps {
  // Phone-dimension floor for the balance region. The region grows naturally
  // with its contents (e.g. the PENDING/RESERVED/REDEEMING pills) above this
  // minimum, so nothing clips when pills are present and it stays visually
  // balanced when they're absent.
  minHeight: number;
}

/** The unit's wallpaper theme from the CURRENT store snapshots — called from
 *  the scroll handler, so no hook subscription churn. */
function themeForUnit(unit: string): string {
  const { unitWallpapers, activeAlbumSlug } = useThemeStore.getState();
  const catalog = useWallpaperStore.getState().catalog;
  return resolveUnitWallpaper(unit, { unitWallpapers, activeAlbumSlug }, catalog);
}

/**
 * The wallet-account carousel: one page per available unit (Bitcoin / USD /
 * EUR / GBP account), swipeable on iOS and Android (react-native-pager-view).
 *
 * The theme transition is DRAG-DRIVEN: the moment a drag moves toward a
 * neighbour, that account's wallpaper layer mounts (beginThemeDrag) and the
 * crossfade + surface-color interpolation track the drag fraction frame by
 * frame (themeDragProgress). Settling on the new page runs `selectUnit`
 * (which also re-points the preferred mint when needed) and ThemeProvider
 * applies the vars instantly under the already-opaque drag layer; springing
 * back cancels the drag and glides home.
 */
export function Account({ minHeight }: AccountProps): React.ReactElement {
  const { unit, availableUnits, selectUnit } = useActiveUnit();
  const pagerRef = useRef<PagerView>(null);
  const pageIndex = Math.max(0, availableUnits.indexOf(unit));
  // Tracks the page the PAGER currently sits on, so external unit changes
  // move the pager but pager-driven changes don't re-set the same page.
  const pagerPositionRef = useRef(pageIndex);

  useEffect(() => {
    if (pagerPositionRef.current === pageIndex) return;
    pagerRef.current?.setPage(pageIndex);
  }, [pageIndex]);

  // The carousel's height is the MAX content height across all account pages
  // (pager pages are absolutely positioned, so the container can't grow
  // naturally) — sized to the tallest account, swiping never shifts layout.
  const [pageHeights, setPageHeights] = useState<Record<string, number>>({});
  const tallestContentHeight = Math.max(0, ...Object.values(pageHeights));
  const containerHeight = Math.max(minHeight, tallestContentHeight + BALANCE_BOTTOM_INSET);

  const onPageContentLayout = useCallback((pageUnit: string, event: LayoutChangeEvent) => {
    const height = Math.ceil(event.nativeEvent.layout.height);
    setPageHeights((prev) => (prev[pageUnit] === height ? prev : { ...prev, [pageUnit]: height }));
  }, []);

  // Revolut model: the wallpaper crossfade does NOT track the finger. It
  // starts the moment the drag is released toward a new account
  // (onPageSelected fires when the landing page is determined ≈ release)
  // and completes in ~0.5s, while the pager settles underneath. The unit
  // itself commits later, at idle.
  const handlePageSelected = useCallback(
    (event: PagerViewOnPageSelectedEvent) => {
      const position = event.nativeEvent.position;
      pagerPositionRef.current = position;
      const nextUnit = availableUnits[position];
      if (!nextUnit || nextUnit === unit) return;
      const fromTheme = themeForUnit(unit);
      const targetTheme = themeForUnit(nextUnit);
      if (targetTheme === fromTheme) return; // identical wallpaper — no fade
      releaseThemeDrag(targetTheme, surfaceOfTheme(fromTheme));
    },
    [availableUnits, unit]
  );

  const handlePageScrollStateChanged = useCallback(
    (event: PageScrollStateChangedNativeEvent) => {
      if (event.nativeEvent.pageScrollState !== 'idle') return;
      const position = pagerPositionRef.current;
      const nextUnit = availableUnits[position];
      if (!nextUnit || nextUnit === unit) {
        // Sprang back to the same page — glide the drag layer home.
        cancelThemeDrag();
        return;
      }
      walletLog.info('wallet.account.carousel_selected', { from: unit, to: nextUnit, position });
      selectUnit(nextUnit);
    },
    [availableUnits, unit, selectUnit]
  );

  return (
    <Log name="Account">
      <View style={[styles.container, { height: containerHeight }]}>
        <PagerView
          ref={pagerRef}
          style={styles.pager}
          initialPage={pageIndex}
          onPageSelected={handlePageSelected}
          onPageScrollStateChanged={handlePageScrollStateChanged}
          // Rebuild when the available-account set changes so page indices
          // stay aligned with availableUnits.
          key={availableUnits.join('|')}>
          {availableUnits.map((accountUnit) => (
            <View key={accountUnit} collapsable={false}>
              <VStack style={styles.balanceSlot}>
                <VStack
                  align="center"
                  gap={8}
                  onLayout={(event) => onPageContentLayout(accountUnit, event)}>
                  {/* Revolut model: every page renders the CURRENT account's
                      content — pages are identical while swiping (no per-page
                      content differences to stutter or shift) and the content
                      "corrects itself" to the new account when the switch
                      commits at idle. */}
                  <PrimaryBalance account={{ unit }} />
                </VStack>
              </VStack>
            </View>
          ))}
        </PagerView>
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    zIndex: zIndex.sticky,
  },
  pager: {
    flex: 1,
  },
  balanceSlot: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: BALANCE_BOTTOM_INSET,
  },
});
