import { Tabs } from 'expo-router';
import { BackgroundProvider } from '@/shared/providers/BackgroundProvider';
import { DynamicColorIOS, Platform, View } from 'react-native';
import type { SFSymbol } from 'expo-symbols';
import Icon from 'assets/icons';
import { SovranTabBar } from '@/shared/blocks/SovranTabBar';
import { Expo55NativeTabs, isExpo55NativeTabsSupported } from '@/navigation/nativeTabs';
import { WhitenoiseSetupBanner } from '@/features/whitenoise/components/WhitenoiseSetupBanner';

export const unstable_settings = {
  initialRouteName: 'index',
};

type TabName = 'feed' | 'index' | 'contacts' | 'notifications' | 'ai';

type TabDef = {
  name: TabName;
  title: string;
  /** SF Symbol pair for iOS 26+ liquid-glass NativeTabs. */
  sf: { default: SFSymbol; selected: SFSymbol };
  /** Monicon (Iconify) pair for the cross-platform JS tab bar. */
  monicon: { default: string; selected: string };
};

const TAB_DEFS: readonly TabDef[] = [
  {
    name: 'feed',
    title: 'Feed',
    sf: { default: 'house', selected: 'house.fill' },
    monicon: { default: 'mingcute:home-4-line', selected: 'mingcute:home-4-fill' },
  },
  {
    name: 'contacts',
    title: 'Contacts',
    sf: { default: 'person.2', selected: 'person.2.fill' },
    monicon: { default: 'mdi:account-group-outline', selected: 'mdi:account-group' },
  },
  {
    name: 'index',
    title: 'Wallet',
    sf: { default: 'wallet.bifold', selected: 'wallet.bifold' },
    monicon: { default: 'fluent:wallet-20-regular', selected: 'fluent:wallet-20-filled' },
  },
  {
    name: 'notifications',
    title: 'Notifications',
    sf: { default: 'bell', selected: 'bell.fill' },
    monicon: { default: 'mdi:bell-outline', selected: 'mdi:bell' },
  },
  {
    name: 'ai',
    title: 'AI',
    sf: { default: 'brain', selected: 'brain' },
    monicon: { default: 'mdi:robot-outline', selected: 'mdi:robot' },
  },
];

export default function TabLayout() {
  // iOS 26+ uses native liquid-glass tabs.
  if (isExpo55NativeTabsSupported()) {
    return (
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
              <Expo55NativeTabs.Trigger key={tab.name} name={tab.name}>
                <Expo55NativeTabs.Trigger.Label hidden />
                <Expo55NativeTabs.Trigger.Icon sf={tab.sf} />
              </Expo55NativeTabs.Trigger>
            ))}
          </Expo55NativeTabs>
          <WhitenoiseSetupBanner />
        </View>
      </BackgroundProvider>
    );
  }

  // Everything else (pre-iOS-26 + Android) uses the X-style custom JS tab bar.
  return (
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
        <WhitenoiseSetupBanner />
      </View>
    </BackgroundProvider>
  );
}
