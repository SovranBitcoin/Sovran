import { Tabs } from 'expo-router';
import { BackgroundProvider } from '@/shared/providers/BackgroundProvider';
import { View } from 'react-native';
import type { SFSymbol } from 'expo-symbols';
import Icon from 'assets/icons';
import { SovranTabBar } from '@/shared/blocks/SovranTabBar';
import { Expo55NativeTabs, isExpo55NativeTabsSupported } from '@/navigation/nativeTabs';
import { TabBarInsetsProvider } from '@/shared/hooks/useScreenInsets';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

export const unstable_settings = {
  anchor: 'index',
};

type TabName = 'index' | 'settings' | 'search';

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
      default: 'material-symbols:settings-rounded',
      selected: 'material-symbols:settings-rounded',
    },
  },
  {
    name: 'search',
    title: 'Search',
    testID: 'tab-search',
    role: 'search',
    sf: { default: 'magnifyingglass', selected: 'magnifyingglass' },
    monicon: { default: 'mingcute:search-3-line', selected: 'mingcute:search-3-line' },
  },
];

export default function TabLayout() {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);

  // iOS 26+ uses native liquid-glass tabs.
  if (isExpo55NativeTabsSupported()) {
    return (
      <TabBarInsetsProvider mode="native">
        <BackgroundProvider>
          <View className="flex-1">
            <Expo55NativeTabs
              labelStyle={{ default: { color: muted }, selected: { color: foreground } }}
              iconColor={{ default: muted, selected: foreground }}
              tintColor={foreground}
              disableTransparentOnScrollEdge>
              {TAB_DEFS.map((tab) => (
                <Expo55NativeTabs.Trigger
                  disableAutomaticContentInsets
                  key={tab.name}
                  name={tab.name}
                  role={tab.role}
                  unstable_nativeProps={{
                    tabBarItemTestID: tab.testID,
                    tabBarItemAccessibilityLabel: tab.title,
                  }}>
                  {/* A `role` item takes the system's own title. */}
                  {tab.role ? null : (
                    <Expo55NativeTabs.Trigger.Label>{tab.title}</Expo55NativeTabs.Trigger.Label>
                  )}
                  <Expo55NativeTabs.Trigger.Icon sf={tab.sf} />
                </Expo55NativeTabs.Trigger>
              ))}
            </Expo55NativeTabs>
          </View>
        </BackgroundProvider>
      </TabBarInsetsProvider>
    );
  }

  // Everything else (pre-iOS-26 + Android) uses the custom JS tab bar.
  return (
    <TabBarInsetsProvider mode="docked">
      <BackgroundProvider>
        <View className="flex-1">
          <Tabs
            initialRouteName="index"
            screenOptions={{ headerShown: false }}
            tabBar={(props) => <SovranTabBar {...props} />}>
            {TAB_DEFS.map((tab) => (
              <Tabs.Screen
                key={tab.name}
                name={tab.name}
                options={{
                  title: tab.title,
                  tabBarAccessibilityLabel: tab.title,
                  tabBarButtonTestID: tab.testID,
                  tabBarIcon: ({ focused, color }) => (
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
        </View>
      </BackgroundProvider>
    </TabBarInsetsProvider>
  );
}
