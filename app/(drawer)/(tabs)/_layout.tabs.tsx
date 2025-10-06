import React from 'react';
import { View } from 'react-native';
import { BlurView } from 'expo-blur';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';

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
  icon: React.ComponentType<{ focused: boolean }>;
  condition?: boolean;
}

// Constants
const LIGHT_THEMES = ['light', 'beige'];

// Helper functions
const isLightTheme = (themeName: string) => LIGHT_THEMES.includes(themeName);
const getBlurTint = (themeName: string) => (isLightTheme(themeName) ? 'light' : 'dark');
const getBlurIntensity = (themeName: string) => (isLightTheme(themeName) ? 7.5 : 75);

// Icon components that use useTheme hook
const PaymentsIcon = ({ focused }: { focused: boolean }) => {
  const { getPrimaryColor, currentTheme, getShadeColor } = useTheme();
  return (
    <Icon
      name="fluent:arrow-swap-16-filled"
      color={focused ? getShadeColor('300') : opacity(getPrimaryColor('50'), 0.25)}
      size={32}
    />
  );
};

const WalletIcon = ({ focused }: { focused: boolean }) => {
  const { getPrimaryColor, currentTheme, getShadeColor } = useTheme();
  return (
    <View style={{ position: 'relative', width: 64, height: 64 }}>
      <View className="absolute h-4 overflow-hidden" style={{ width: 100, bottom: 51 }}>
        <BlurView
          tint={getBlurTint(currentTheme)}
          intensity={getBlurIntensity(currentTheme)}
          experimentalBlurMethod="dimezisBlurView"
          className="absolute overflow-hidden rounded-full"
          style={{
            top: 5,
            left: 0,
            backgroundColor: opacity(getPrimaryColor('900'), 0.5),
            zIndex: -2,
            width: 64,
            height: 64,
          }}
        />
      </View>

      <LinearGradient
        colors={[getPrimaryColor(focused ? '0' : '600'), getPrimaryColor(focused ? '100' : '700')]}
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
  );
};

const LifestyleIcon = ({ focused }: { focused: boolean }) => {
  const { getPrimaryColor, currentTheme, getShadeColor } = useTheme();
  return (
    <Icon
      name="clarity:internet-of-things-solid"
      color={focused ? getShadeColor('300') : opacity(getPrimaryColor('50'), 0.25)}
      size={32}
      spin={{
        duration: 2000,
        delay: 4000,
        outputRange: ['0deg', '120deg'],
      }}
    />
  );
};

// Tab screens configuration
export const TAB_SCREENS: TabConfig[] = [
  {
    name: 'payments',
    component: PaymentsView,
    title: 'Payments',
    icon: PaymentsIcon,
  },
  {
    name: 'index',
    component: HomeView,
    title: 'Wallet',
    icon: WalletIcon,
  },
  {
    name: 'lifestyle',
    component: LifestyleView,
    title: '',
    icon: LifestyleIcon,
  },
];
