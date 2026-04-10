import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, UIManager, View } from 'react-native';
import { Log } from '@/shared/lib/logger';
import { usePathname, useRouter, useRootNavigationState } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabsContentView } from 'expo-liquid-glass-native';
import { LIQUID_GLASS_ENABLED } from '@/shared/lib/version';

const BottomTabsView = BottomTabsContentView;
export const isLiquidGlassTabBarAvailable = () => {
  if (!LIQUID_GLASS_ENABLED) return false;
  const config = UIManager?.getViewManagerConfig?.('BottomTabsContentView');
  const hasConfig = (UIManager as any)?.hasViewManagerConfig?.('BottomTabsContentView');
  return Boolean(config || hasConfig);
};

const TAB_PATHS = ['/', '/explore'];

function getTabIndexFromPathname(pathname: string): number | null {
  if (pathname === '/' || pathname === '/index' || pathname.startsWith('/index/')) return 0;
  if (pathname === '/explore' || pathname.startsWith('/explore/')) return 1;
  return null;
}

type BottomTabsProps = {
  selectedTabIndex?: number;
  tabsCount?: number;
  tabLabels?: string[];
  tabIcons?: (number | string)[];
  iconTintEnabled?: boolean;
  onTabSelected?: (index: number) => void;
  style?: object;
};

function BottomTabs({
  selectedTabIndex: controlledSelectedTabIndex,
  tabsCount = 3,
  tabLabels,
  tabIcons,
  iconTintEnabled = true,
  onTabSelected,
  style,
  ...props
}: BottomTabsProps) {
  const [internalSelectedTabIndex, setInternalSelectedTabIndex] = useState(0);

  const selectedTabIndex =
    controlledSelectedTabIndex !== undefined
      ? controlledSelectedTabIndex
      : internalSelectedTabIndex;

  const handleTabSelected = (event: { nativeEvent: { index: number } }) => {
    const index = event.nativeEvent.index;
    if (controlledSelectedTabIndex === undefined) {
      setInternalSelectedTabIndex(index);
    }
    onTabSelected?.(index);
  };

  const tabIconUris = useMemo(() => {
    if (!tabIcons) return null;
    return tabIcons.map((icon) => {
      if (typeof icon === 'number') {
        try {
          const source = Image.resolveAssetSource(icon);
          return source?.uri ?? null;
        } catch {
          return null;
        }
      }
      if (typeof icon === 'string') {
        return icon;
      }
      return null;
    });
  }, [tabIcons]);

  return (
    <BottomTabsView
      style={[{ flex: 1 }, style]}
      selectedTabIndex={selectedTabIndex}
      tabsCount={tabsCount}
      tabLabels={tabLabels}
      tabIcons={tabIconUris ? (tabIconUris.filter(Boolean) as string[]) : undefined}
      iconTintEnabled={iconTintEnabled}
      onTabSelected={handleTabSelected}
      {...props}
    />
  );
}

/**
 * Check whether the root navigation stack is showing the drawer (index 0)
 * without any modals presented on top. When a modal is pushed, the root
 * stack index is > 0 and we should hide the tab bar.
 */
function useIsOnTabScreen(): boolean {
  const rootState = useRootNavigationState();
  const pathname = usePathname();

  return useMemo(() => {
    // Root stack must be on its first route (the drawer), not a modal
    if (rootState?.index !== undefined && rootState.index > 0) return false;

    // Pathname must match a known tab route
    return getTabIndexFromPathname(pathname) !== null;
  }, [rootState?.index, pathname]);
}

export function GlobalLiquidGlassTabsOverlay() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);
  const isOnTabScreen = useIsOnTabScreen();

  const resolvedTabIndex = useMemo(() => {
    const fromPath = getTabIndexFromPathname(pathname);
    return fromPath ?? selectedTabIndex;
  }, [pathname, selectedTabIndex]);

  if (!isLiquidGlassTabBarAvailable() || !isOnTabScreen) return null;

  return (
    <Log name="GlobalLiquidGlassTabsOverlay">
      <View pointerEvents="box-none" style={styles.overlay}>
        <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <BottomTabs
            style={styles.nativeTabs}
            selectedTabIndex={resolvedTabIndex}
            tabsCount={2}
            tabLabels={['Wallet', 'Explore']}
            iconTintEnabled
            onTabSelected={(index) => {
              setSelectedTabIndex(index);
              router.navigate(TAB_PATHS[index] as any);
            }}
          />
        </View>
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: 'transparent',
  },
  nativeTabs: {
    height: 128,
  },
});
