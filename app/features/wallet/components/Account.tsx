import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import PagerView, {
  type PagerViewOnPageScrollEvent,
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
  beginThemeDrag,
  cancelThemeDrag,
  getThemeDragTarget,
  surfaceOfTheme,
  themeDragProgress,
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

  // The carousel's height follows the ACTIVE page's content (pager pages are
  // absolutely positioned, so the container can't grow naturally).
  const [pageHeights, setPageHeights] = useState<Record<string, number>>({});
  const activeContentHeight = pageHeights[unit] ?? 0;
  const containerHeight = Math.max(minHeight, activeContentHeight + BALANCE_BOTTOM_INSET);

  const onPageContentLayout = useCallback((pageUnit: string, event: LayoutChangeEvent) => {
    const height = Math.ceil(event.nativeEvent.layout.height);
    setPageHeights((prev) => (prev[pageUnit] === height ? prev : { ...prev, [pageUnit]: height }));
  }, []);

  const handlePageScroll = useCallback(
    (event: PagerViewOnPageScrollEvent) => {
      const { position, offset } = event.nativeEvent;
      const settled = pagerPositionRef.current;
      const delta = position + offset - settled;
      const targetIndex = delta > 0.001 ? settled + 1 : delta < -0.001 ? settled - 1 : null;
      if (targetIndex === null || targetIndex < 0 || targetIndex >= availableUnits.length) {
        if (getThemeDragTarget() !== null) cancelThemeDrag();
        return;
      }
      const fromTheme = themeForUnit(availableUnits[settled] ?? unit);
      const targetTheme = themeForUnit(availableUnits[targetIndex]);
      if (targetTheme === fromTheme) return; // identical theme — nothing to fade
      if (getThemeDragTarget() !== targetTheme) {
        beginThemeDrag(targetTheme, surfaceOfTheme(fromTheme));
      }
      themeDragProgress.value = Math.min(1, Math.abs(delta));
    },
    [availableUnits, unit]
  );

  const handlePageSelected = useCallback(
    (event: PagerViewOnPageSelectedEvent) => {
      const position = event.nativeEvent.position;
      pagerPositionRef.current = position;
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
          onPageScroll={handlePageScroll}
          onPageSelected={handlePageSelected}
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
                  <PrimaryBalance account={{ unit: accountUnit }} />
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
