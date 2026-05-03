import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { BackgroundProvider } from '@/shared/providers/BackgroundProvider';
import { DynamicColorIOS, Platform, StyleSheet, View } from 'react-native';
import type { SFSymbol } from 'expo-symbols';
import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import {
  GlobalLiquidGlassTabsOverlay,
  isLiquidGlassTabBarAvailable,
} from '@/shared/blocks/LiquidGlassTabBar';
import { Expo55NativeTabs, isExpo55NativeTabsSupported } from '@/navigation/nativeTabs';
import { WhitenoiseSetupBanner } from '@/features/whitenoise/components/WhitenoiseSetupBanner';

export const unstable_settings = {
  initialRouteName: 'index',
};

type TabName = 'feed' | 'index' | 'contacts' | 'ai';

type TabDef = {
  name: TabName;
  title: string;
  /** SF Symbol pair for iOS native tabs. `default` doubles as the icon name on the fallback Tabs path. */
  sf: { default: SFSymbol; selected: SFSymbol };
};

const TAB_DEFS: readonly TabDef[] = [
  { name: 'feed', title: 'Feed', sf: { default: 'house', selected: 'house.fill' } },
  { name: 'index', title: 'Wallet', sf: { default: 'wallet.bifold', selected: 'wallet.bifold' } },
  { name: 'contacts', title: 'Contacts', sf: { default: 'person.2', selected: 'person.2.fill' } },
  { name: 'ai', title: 'AI', sf: { default: 'brain', selected: 'brain' } },
];

// Fallback tab bar background for pre-liquid glass devices
const TabBarBackground = () => (
  <BlurView tint="dark" intensity={75} style={[StyleSheet.absoluteFill, { borderRadius: 8 }]} />
);

export default function TabLayout() {
  const hasAndroidLiquidGlass = Platform.OS === 'android' && isLiquidGlassTabBarAvailable();

  // Use wrapped NativeTabs for iOS liquid-glass devices.
  if (isExpo55NativeTabsSupported()) {
    return (
      <BackgroundProvider>
        <View style={{ flex: 1 }}>
          <Expo55NativeTabs
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
                <Expo55NativeTabs.Trigger.Icon sf={tab.sf} />
                <Expo55NativeTabs.Trigger.Label>{tab.title}</Expo55NativeTabs.Trigger.Label>
              </Expo55NativeTabs.Trigger>
            ))}
          </Expo55NativeTabs>
          <WhitenoiseSetupBanner />
        </View>
      </BackgroundProvider>
    );
  }

  // Fallback for pre-iOS 26 and Android
  return (
    <BackgroundProvider>
      <View style={{ flex: 1 }}>
        <Tabs
          screenOptions={{
            headerShown: false,
            ...(!hasAndroidLiquidGlass && { tabBarBackground: () => <TabBarBackground /> }),
            tabBarStyle: hasAndroidLiquidGlass
              ? { display: 'none' }
              : {
                  position: 'absolute',
                  backgroundColor: 'transparent',
                  borderTopColor: 'transparent',
                  elevation: 0,
                },
            tabBarActiveTintColor: '#fff',
            tabBarInactiveTintColor: '#ECEDEE',
          }}>
          {TAB_DEFS.map((tab) => (
            <Tabs.Screen
              key={tab.name}
              name={tab.name}
              options={{
                title: tab.title,
                tabBarIcon: ({ color }) => (
                  <IconSymbol name={tab.sf.default} color={color} size={24} />
                ),
              }}
            />
          ))}
        </Tabs>
        {hasAndroidLiquidGlass ? <GlobalLiquidGlassTabsOverlay /> : null}
        <WhitenoiseSetupBanner />
      </View>
    </BackgroundProvider>
  );
}
