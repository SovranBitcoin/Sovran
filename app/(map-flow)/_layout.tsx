/**
 * @fileoverview Map Flow Modal Layout
 *
 * This layout creates a fullscreen map experience for discovering
 * Bitcoin-accepting merchants from BTCMap.
 */

import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Text } from 'components/ui/Text';
import { Stack, router } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { Pressable } from 'react-native';

export default function MapFlowLayout() {
  const iconColor = useThemeColor({}, 'text');
  const { getPrimaryColor } = useTheme();

  return (
    <Stack
      screenOptions={{
        contentStyle: {
          backgroundColor: 'transparent',
        },
      }}>
      <Stack.Screen
        name="index"
        options={{
          headerTransparent: true,
          headerBlurEffect: 'systemMaterial',
          headerTitle: () => (
            <Text size={17} heavy style={{ color: getPrimaryColor('0') }}>
              Bitcoin Map
            </Text>
          ),
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ padding: 8 }}>
              <IconSymbol name="xmark" size={24} color={iconColor} />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
