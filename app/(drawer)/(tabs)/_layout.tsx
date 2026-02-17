import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Tabs } from 'expo-router';
import { BackgroundProvider } from 'providers/BackgroundProvider';
import { DynamicColorIOS, Platform, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { supportsLiquidGlass } from '@/helper/version';
import { Colors } from '@/constants/theme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { OfflineProvider } from '@/providers/OfflineProvider';

// Fallback tab bar background for pre-liquid glass devices
const TabBarBackground = () => (
  <BlurView tint="dark" intensity={75} style={[StyleSheet.absoluteFill, { borderRadius: 8 }]} />
);

export default function TabLayout() {
  // Use NativeTabs for iOS 26+ (Liquid Glass)
  if (supportsLiquidGlass()) {
    return (
      <BackgroundProvider>
        <OfflineProvider>
          <NativeTabs
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
            <NativeTabs.Trigger name="payments">
              <NativeTabs.Trigger.Icon
                sf={{
                  default: 'arrow.up.arrow.down',
                  selected: 'arrow.up.arrow.down',
                }}
              />
              <NativeTabs.Trigger.Label>Payments</NativeTabs.Trigger.Label>
            </NativeTabs.Trigger>

            <NativeTabs.Trigger name="index">
              <NativeTabs.Trigger.Icon
                sf={{
                  default: 'wallet.bifold',
                  selected: 'wallet.bifold',
                }}
              />
              <NativeTabs.Trigger.Label>Wallet</NativeTabs.Trigger.Label>
            </NativeTabs.Trigger>

            <NativeTabs.Trigger name="explore">
              <NativeTabs.Trigger.Icon
                sf={{ default: 'paperplane', selected: 'paperplane.fill' }}
              />
              <NativeTabs.Trigger.Label>Explore</NativeTabs.Trigger.Label>
            </NativeTabs.Trigger>

            {/* <NativeTabs.Trigger name="example">
            <NativeTabs.Trigger.Icon sf={{ default: 'paperplane', selected: 'paperplane.fill' }} />
            <NativeTabs.Trigger.Label>Example</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger> */}
          </NativeTabs>
        </OfflineProvider>
      </BackgroundProvider>
    );
  }

  // Fallback for pre-iOS 26 and Android
  return (
    <BackgroundProvider>
      <OfflineProvider>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarBackground: () => <TabBarBackground />,
            tabBarStyle: {
              position: 'absolute',
              backgroundColor: 'transparent',
              borderTopColor: 'transparent',
              elevation: 0,
            },
            tabBarActiveTintColor: Colors.dark.tint,
            tabBarInactiveTintColor: Colors.dark.text,
          }}>
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
              href: null, // Hide from tab bar
            }}
          />
          <Tabs.Screen
            name="example"
            options={{
              href: null, // Hide from tab bar
            }}
          />
        </Tabs>
      </OfflineProvider>
    </BackgroundProvider>
  );
}
