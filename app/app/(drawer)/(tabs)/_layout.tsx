import { useRef, useState } from 'react';
import { Tabs } from 'expo-router';
import { View } from 'react-native';
import type { SFSymbol } from 'expo-symbols';
import Icon from 'assets/icons';
import { SearchTabIcon, SovranTabBar } from '@/shared/blocks/SovranTabBar';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { Expo55NativeTabs, isExpo55NativeTabsSupported } from '@/navigation/nativeTabs';
import { DrawerSceneOverlay } from '@/navigation/DrawerSceneOverlay';
import { TabBarInsetsProvider } from '@/shared/hooks/useScreenInsets';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { SearchCloseProvider } from '@/shared/ui/composed/SearchLayout';

export const unstable_settings = {
  anchor: 'index',
};

type TabName = 'index' | 'settings' | 'search';
/** The tabs Search can close back to. */
type ReturnTab = Exclude<TabName, 'search'>;

const SEARCH_CLOSE_LABEL = 'Close search';
const RETURN_TABS: Record<
  ReturnTab,
  { hint: string; href: '/(drawer)/(tabs)/index' | '/(drawer)/(tabs)/settings' }
> = {
  index: { hint: 'Returns to Wallet', href: '/(drawer)/(tabs)/index' },
  settings: { hint: 'Returns to Settings', href: '/(drawer)/(tabs)/settings' },
};

const isTabName = (name: string): name is TabName =>
  name === 'index' || name === 'settings' || name === 'search';

type TabDef = {
  name: TabName;
  title: string;
  testID: string;
  /** SF Symbol pair for iOS 26+ liquid-glass NativeTabs. */
  sf: { default: SFSymbol; selected: SFSymbol };
  /** Monicon (Iconify) pair for the cross-platform JS tab bar. */
  monicon: { default: string; selected: string };
  /**
   * iOS 26 system role. `search` makes the system draw the item as the
   * separated search control that joins the tab's header search bar.
   */
  role?: 'search';
};

/** Every build ships all three tabs (ADR 0035), Search last. */
const TAB_DEFS: readonly TabDef[] = [
  {
    name: 'index',
    title: 'Wallet',
    testID: 'tab-wallet',
    sf: { default: 'wallet.bifold', selected: 'wallet.bifold' },
    monicon: { default: 'fluent:wallet-20-regular', selected: 'fluent:wallet-20-filled' },
  },
  {
    name: 'settings',
    title: 'Settings',
    testID: 'tab-settings',
    sf: { default: 'gearshape', selected: 'gearshape.fill' },
    monicon: {
      default: 'material-symbols:settings-outline-rounded',
      selected: 'material-symbols:settings-rounded',
    },
  },
  {
    name: 'search',
    title: 'Search',
    testID: 'tab-search',
    role: 'search',
    // Open, the Search tab is the way out of Search.
    sf: { default: 'magnifyingglass', selected: 'xmark' },
    monicon: { default: 'mingcute:search-3-line', selected: 'mingcute:search-3-fill' },
  },
];

export default function TabLayout() {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const [focusedTab, setFocusedTab] = useState<TabName>('index');
  const focusedTabRef = useRef<TabName>('index');
  // The last tab other than Search: pressing the open Search tab goes back there.
  const [returnTab, setReturnTab] = useState<ReturnTab>('index');
  const searchOpen = focusedTab === 'search';
  // The deferred close of an open Search tab (native tabs only).
  const closeFrame = useRef<number | null>(null);
  // The Search header's close button leaves the same way the open Search tab does.
  // Skip if another tab gained focus while iOS dismissed the search controller.
  const searchClose = {
    close: () => {
      if (focusedTabRef.current !== 'search') return;
      guardedRouter.raw.navigate(RETURN_TABS[returnTab].href);
    },
    accessibilityLabel: `${SEARCH_CLOSE_LABEL}. ${RETURN_TABS[returnTab].hint}`,
  };

  const onTabFocus = (name: string) => {
    if (!isTabName(name)) return;
    focusedTabRef.current = name;
    setFocusedTab(name);
    if (name === 'search') return;
    setReturnTab(name);
    // A tab picked before the deferred close ran is where the person is going.
    if (closeFrame.current !== null) {
      cancelAnimationFrame(closeFrame.current);
      closeFrame.current = null;
    }
  };

  // iOS 26+ uses native liquid-glass tabs.
  if (isExpo55NativeTabsSupported()) {
    return (
      <TabBarInsetsProvider mode="native">
        <SearchCloseProvider value={searchClose}>
          <View className="flex-1">
            <Expo55NativeTabs
              labelStyle={{ default: { color: muted }, selected: { color: foreground } }}
              iconColor={{ default: muted, selected: foreground }}
              tintColor={foreground}
              disableTransparentOnScrollEdge
              screenListeners={({ route }) => ({
                focus: () => onTabFocus(route.name),
                tabPress: () => {
                  if (route.name !== 'search' || !searchOpen) return;
                  // The navigator re-selects Search right after this event, so
                  // leave on the next frame or the re-select would win. Unguarded:
                  // the double-tap cooldown would swallow a quick open-then-close
                  // (the tab bar itself is the only caller, once per press).
                  if (closeFrame.current !== null) cancelAnimationFrame(closeFrame.current);
                  closeFrame.current = requestAnimationFrame(() => {
                    closeFrame.current = null;
                    guardedRouter.raw.navigate(RETURN_TABS[returnTab].href);
                  });
                },
              })}>
              {TAB_DEFS.map((tab) => {
                const closes = tab.name === 'search' && searchOpen;
                return (
                  <Expo55NativeTabs.Trigger
                    disableAutomaticContentInsets
                    key={tab.name}
                    name={tab.name}
                    role={tab.role}
                    // Pressing the open Search tab closes it; it never pops or scrolls.
                    disablePopToTop={tab.name === 'search'}
                    disableScrollToTop={tab.name === 'search'}
                    unstable_nativeProps={{
                      tabBarItemTestID: tab.testID,
                      tabBarItemAccessibilityLabel: closes
                        ? `${SEARCH_CLOSE_LABEL}. ${RETURN_TABS[returnTab].hint}`
                        : tab.title,
                    }}>
                    {/* A `role` item takes the system's own title. */}
                    {tab.role ? null : (
                      <Expo55NativeTabs.Trigger.Label>{tab.title}</Expo55NativeTabs.Trigger.Label>
                    )}
                    <Expo55NativeTabs.Trigger.Icon sf={tab.sf} />
                  </Expo55NativeTabs.Trigger>
                );
              })}
            </Expo55NativeTabs>
            <DrawerSceneOverlay />
          </View>
        </SearchCloseProvider>
      </TabBarInsetsProvider>
    );
  }

  // Everything else (pre-iOS-26 + Android) uses the custom JS tab bar.
  return (
    <TabBarInsetsProvider mode="docked">
      <SearchCloseProvider value={searchClose}>
        <View className="flex-1">
          <Tabs
            initialRouteName="index"
            screenOptions={{ headerShown: false }}
            screenListeners={({ route }) => ({ focus: () => onTabFocus(route.name) })}
            tabBar={(props) => (
              <SovranTabBar
                {...props}
                closeableRoute="search"
                onCloseRoute={() => props.navigation.navigate(returnTab)}
                closeLabel={SEARCH_CLOSE_LABEL}
                closeHint={RETURN_TABS[returnTab].hint}
              />
            )}>
            {TAB_DEFS.map((tab) => (
              <Tabs.Screen
                key={tab.name}
                name={tab.name}
                options={{
                  title: tab.title,
                  tabBarAccessibilityLabel: tab.title,
                  tabBarButtonTestID: tab.testID,
                  tabBarIcon: ({ focused, color }) =>
                    tab.name === 'search' ? (
                      <SearchTabIcon focused={focused} color={color as string} />
                    ) : (
                      <Icon
                        name={focused ? tab.monicon.selected : tab.monicon.default}
                        color={color as string}
                        size={24}
                      />
                    ),
                }}
              />
            ))}
          </Tabs>
          <DrawerSceneOverlay />
        </View>
      </SearchCloseProvider>
    </TabBarInsetsProvider>
  );
}
