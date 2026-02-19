import { Tabs } from 'expo-router';
import { BackgroundProvider } from 'providers/BackgroundProvider';
import { DynamicColorIOS, Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { OfflineProvider } from '@/providers/OfflineProvider';
import {
  GlobalLiquidGlassTabsOverlay,
  isLiquidGlassTabBarAvailable,
} from '@/components/LiquidGlassTabBar';
import {
  Expo55NativeTabs,
  isExpo55NativeTabsSupported,
} from '@/components/navigation/expoRouter55';

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
        <OfflineProvider>
          <Expo55NativeTabs
            labelStyle={{
              color: Platform.select({
                ios: DynamicColorIOS({
                  dark: Colors.dark.text,
                  light: Colors.light.text,
                }),
              }),
            }}
            tintColor={Platform.select({
              ios: DynamicColorIOS({
                dark: Colors.dark.tint,
                light: Colors.light.tint,
              }),
            })}
            disableTransparentOnScrollEdge>
            <Expo55NativeTabs.Trigger name="feed">
              <Expo55NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
              <Expo55NativeTabs.Trigger.Label>Feed</Expo55NativeTabs.Trigger.Label>
            </Expo55NativeTabs.Trigger>

            <Expo55NativeTabs.Trigger name="payments">
              <Expo55NativeTabs.Trigger.Icon
                sf={{
                  default: 'arrow.up.arrow.down',
                  selected: 'arrow.up.arrow.down',
                }}
              />
              <Expo55NativeTabs.Trigger.Label>Payments</Expo55NativeTabs.Trigger.Label>
            </Expo55NativeTabs.Trigger>

            <Expo55NativeTabs.Trigger name="index">
              <Expo55NativeTabs.Trigger.Icon
                sf={{
                  default: 'wallet.bifold',
                  selected: 'wallet.bifold',
                }}
              />
              <Expo55NativeTabs.Trigger.Label>Wallet</Expo55NativeTabs.Trigger.Label>
            </Expo55NativeTabs.Trigger>

            <Expo55NativeTabs.Trigger name="explore">
              <Expo55NativeTabs.Trigger.Icon
                sf={{ default: 'paperplane', selected: 'paperplane.fill' }}
              />
              <Expo55NativeTabs.Trigger.Label>Explore</Expo55NativeTabs.Trigger.Label>
            </Expo55NativeTabs.Trigger>

            {/* <Expo55NativeTabs.Trigger name="example">
          <Expo55NativeTabs.Trigger.Icon sf={{ default: 'paperplane', selected: 'paperplane.fill' }} />
          <Expo55NativeTabs.Trigger.Label>Example</Expo55NativeTabs.Trigger.Label>
        </Expo55NativeTabs.Trigger> */}
          </Expo55NativeTabs>
        </OfflineProvider>
      </BackgroundProvider>
    );
  }

  // Fallback for pre-iOS 26 and Android
  return (
    <BackgroundProvider>
      <OfflineProvider>
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
              tabBarActiveTintColor: Colors.dark.tint,
              tabBarInactiveTintColor: Colors.dark.text,
            }}>
            <Tabs.Screen
              name="feed"
              options={{
                title: 'Feed',
                tabBarIcon: ({ color }) => <IconSymbol name="house" color={color} size={24} />,
              }}
            />
            <Tabs.Screen
              name="payments"
              options={{
                title: 'Payments',
                tabBarIcon: ({ color }) => (
                  <IconSymbol name="arrow.up.arrow.down" color={color} size={24} />
                ),
              }}
            />
            <Tabs.Screen
              name="index"
              options={{
                title: 'Wallet',
                tabBarIcon: ({ color }) => (
                  <IconSymbol name="wallet.bifold" color={color} size={24} />
                ),
              }}
            />
            <Tabs.Screen
              name="explore"
              options={{
                ...(hasAndroidLiquidGlass ? {} : { href: null }),
              }}
            />
            <Tabs.Screen
              name="example"
              options={{
                href: null,
              }}
            />
          </Tabs>
          {hasAndroidLiquidGlass ? <GlobalLiquidGlassTabsOverlay /> : null}
        </View>
      </OfflineProvider>
    </BackgroundProvider>
  );
}
