import { Tabs } from 'expo-router';
import { BackgroundProvider } from '@/shared/providers/BackgroundProvider';
import { DynamicColorIOS, Platform, View } from 'react-native';
import type { SFSymbol } from 'expo-symbols';
import Icon from 'assets/icons';
import { SovranTabBar } from '@/shared/blocks/SovranTabBar';
import { Expo55NativeTabs, isExpo55NativeTabsSupported } from '@/navigation/nativeTabs';
import { TabBarInsetsProvider } from '@/shared/hooks/useScreenInsets';

export const unstable_settings = {
  initialRouteName: 'index',
};

type TabName = 'feed' | 'index' | 'contacts' | 'notifications' | 'ai';

type TabDef = {
  name: TabName;
  title: string;
  testID?: string;
  /** SF Symbol pair for iOS 26+ liquid-glass NativeTabs. */
  sf: { default: SFSymbol; selected: SFSymbol };
  /** Monicon (Iconify) pair for the cross-platform JS tab bar. */
  monicon: { default: string; selected: string };
};

const TAB_DEFS: readonly TabDef[] = [
  {
    name: 'feed',
    testID: 'tab-feed',
    title: 'Feed',
    sf: { default: 'house', selected: 'house.fill' },
    monicon: { default: 'mingcute:home-4-line', selected: 'mingcute:home-4-fill' },
  },
  {
    name: 'contacts',
    testID: 'tab-contacts',
    title: 'Contacts',
    sf: { default: 'person.2', selected: 'person.2.fill' },
    monicon: { default: 'mdi:account-group-outline', selected: 'mdi:account-group' },
  },
  {
    name: 'index',
    title: 'Wallet',
    testID: 'tab-wallet',
    sf: { default: 'wallet.bifold', selected: 'wallet.bifold' },
    monicon: { default: 'fluent:wallet-20-regular', selected: 'fluent:wallet-20-filled' },
  },
  {
    name: 'notifications',
    testID: 'tab-notifications',
    title: 'Notifications',
    sf: { default: 'bell', selected: 'bell.fill' },
    monicon: { default: 'mdi:bell-outline', selected: 'mdi:bell' },
  },
  {
    name: 'ai',
    title: 'AI',
    testID: 'tab-ai',
    sf: { default: 'brain', selected: 'brain' },
    monicon: { default: 'mdi:robot-outline', selected: 'mdi:robot' },
  },
];

const NATIVE_TAB_PROPS = Object.fromEntries(
  TAB_DEFS.map((tab) => [
    tab.name,
    {
      tabBarItemTestID: tab.testID,
      tabBarItemAccessibilityLabel: tab.title,
    },
  ])
) as Record<
  TabName,
  { tabBarItemTestID: string | undefined; tabBarItemAccessibilityLabel: string }
>;

export default function TabLayout() {
  // iOS 26+ uses native liquid-glass tabs.
  if (isExpo55NativeTabsSupported()) {
    return (
      <TabBarInsetsProvider mode="native">
        <BackgroundProvider>
          <View style={{ flex: 1 }}>
            <Expo55NativeTabs
              labelVisibilityMode="unlabeled"
              labelStyle={{
                color: Platform.select({
                  ios: DynamicColorIOS({
                    dark: '#ECEDEE',
                    light: '#11181C',
                  }),
                }),
              }}
              tintColor={Platform.select({
                ios: DynamicColorIOS({
                  dark: '#fff',
                  light: '#0a7ea4',
                }),
              })}
              disableTransparentOnScrollEdge>
              {TAB_DEFS.map((tab) => (
                <Expo55NativeTabs.Trigger
                  disableAutomaticContentInsets
                  key={tab.name}
                  name={tab.name}
                  unstable_nativeProps={NATIVE_TAB_PROPS[tab.name]}>
                  <Expo55NativeTabs.Trigger.Label hidden />
                  <Expo55NativeTabs.Trigger.Icon sf={tab.sf} />
                </Expo55NativeTabs.Trigger>
              ))}
            </Expo55NativeTabs>
          </View>
        </BackgroundProvider>
      </TabBarInsetsProvider>
    );
  }

  // Everything else (pre-iOS-26 + Android) uses the X-style custom JS tab bar.
  return (
    <TabBarInsetsProvider mode="docked">
      <BackgroundProvider>
        <View style={{ flex: 1 }}>
          <Tabs
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
                  tabBarShowLabel: false,
                  tabBarIcon: ({ focused, color }) => (
                    <Icon
                      name={focused ? tab.monicon.selected : tab.monicon.default}
                      color={color as string}
                      size={26}
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
