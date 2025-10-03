import React from 'react';
import { View } from 'react-native';
import { BlurView } from 'expo-blur';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { greys, Theme } from 'helper/colors';

// Screen imports
import HomeView from 'app/(drawer)/(tabs)/index';
import LifestyleView from 'app/(drawer)/(tabs)/lifestyle';
import PaymentsView from 'app/(drawer)/(tabs)/payments';
import { LinearGradient } from 'expo-linear-gradient';

// Tab configuration
interface TabConfig {
  name: string;
  component: React.ComponentType<any>;
  title: string;
  icon: React.ComponentType<{ focused: boolean; theme: Theme }>;
  condition?: boolean;
}

// Constants
const LIGHT_THEMES = ['light', 'beige'];

// Helper functions
const isLightTheme = (theme: Theme) => LIGHT_THEMES.includes(theme.id);
const getBlurTint = (theme: Theme) => (isLightTheme(theme) ? 'light' : 'dark');
const getBlurIntensity = (theme: Theme) => (isLightTheme(theme) ? 7.5 : 75);

// Tab screens configuration
export const TAB_SCREENS: TabConfig[] = [
  {
    name: 'payments',
    component: PaymentsView,
    title: 'Payments',
    icon: ({ focused, theme }) => (
      <Icon
        name="fluent:arrow-swap-16-filled"
        color={focused ? theme.shades[300] : opacity(greys(theme)[50], 0.25)}
        size={32}
      />
    ),
  },
  {
    name: 'index',
    component: HomeView,
    title: 'Wallet',
    icon: ({ focused, theme }) => (
      <View style={{ position: 'relative', width: 64, height: 64 }}>
        <View className="absolute h-4 overflow-hidden" style={{ width: 100, bottom: 51 }}>
          <BlurView
            tint={getBlurTint(theme)}
            intensity={getBlurIntensity(theme)}
            experimentalBlurMethod="dimezisBlurView"
            className="absolute overflow-hidden rounded-full"
            style={{
              top: 5,
              left: 0,
              backgroundColor: opacity(greys(theme)[900], 0.5),
              zIndex: -2,
              width: 64,
              height: 64,
            }}
          />
        </View>

        <LinearGradient
          colors={[greys(theme)[focused ? 0 : 600], greys(theme)[focused ? 100 : 700]]}
          style={{
            position: 'absolute',
            width: 52,
            height: 52,
            borderRadius: 100,
            justifyContent: 'center',
            alignItems: 'center',
            top: 6,
            left: 6,
          }}>
          <Icon name="mingcute:lightning-fill" color={focused ? 'black' : 'white'} size={20} />
        </LinearGradient>
      </View>
    ),
  },
  {
    name: 'lifestyle',
    component: LifestyleView,
    title: '',
    icon: ({ focused, theme }) => (
      <Icon
        name="clarity:internet-of-things-solid"
        color={focused ? theme.shades[300] : opacity(greys(theme)[50], 0.25)}
        size={32}
        spin={{
          duration: 2000,
          delay: 4000,
          outputRange: ['0deg', '120deg'],
        }}
      />
    ),
  },
];
