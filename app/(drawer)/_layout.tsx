import React, { useCallback, useRef } from 'react';
import { Drawer } from 'expo-router/drawer';
import {
  GestureHandlerRootView,
  Pressable as GesturePressable,
} from 'react-native-gesture-handler';
import { StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { router, useSegments } from 'expo-router';
import { DrawerContentComponentProps } from '@react-navigation/drawer';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { DrawerProfileChrome } from '@/shared/blocks/DrawerProfileChrome';
import { alpha, iconSize, radius, spacing } from '@/shared/styles/tokens';

type MenuRoute =
  | '/(drawer)/(tabs)/feed'
  | '/(drawer)/(tabs)/index'
  | '/(drawer)/(tabs)/contacts'
  | '/(drawer)/(tabs)/ai'
  | '/(settings-flow)';

type MenuIconPair = {
  default: string;
  selected: string;
};

type MenuItem = {
  icon: MenuIconPair;
  label: string;
  route: MenuRoute;
  /** Segment-prefix that, when matched against `useSegments()`, marks this menu item active. */
  activeSegments: readonly string[];
};

const MENU_ITEMS: MenuItem[] = [
  {
    icon: { default: 'mingcute:home-4-line', selected: 'mingcute:home-4-fill' },
    label: 'Feed',
    route: '/(drawer)/(tabs)/feed',
    activeSegments: ['(drawer)', '(tabs)', 'feed'],
  },
  {
    icon: { default: 'fluent:wallet-20-regular', selected: 'fluent:wallet-20-filled' },
    label: 'Wallet',
    route: '/(drawer)/(tabs)/index',
    activeSegments: ['(drawer)', '(tabs)', 'index'],
  },
  {
    icon: { default: 'mdi:account-group-outline', selected: 'mdi:account-group' },
    label: 'Contacts',
    route: '/(drawer)/(tabs)/contacts',
    activeSegments: ['(drawer)', '(tabs)', 'contacts'],
  },
  {
    icon: { default: 'mdi:robot-outline', selected: 'mdi:robot' },
    label: 'AI',
    route: '/(drawer)/(tabs)/ai',
    activeSegments: ['(drawer)', '(tabs)', 'ai'],
  },
  {
    icon: {
      default: 'material-symbols:settings-rounded',
      selected: 'material-symbols:settings-rounded',
    },
    label: 'Settings',
    route: '/(settings-flow)',
    activeSegments: ['(settings-flow)'],
  },
];

/**
 * Match the current navigation segments against a menu item's prefix. The
 * Wallet tab is the (tabs) default, so an empty/short tabs prefix also
 * activates it — covers `/(drawer)/(tabs)` before the initial route resolves.
 */
function segmentsMatch(segments: string[], prefix: readonly string[]): boolean {
  if (prefix[0] === '(drawer)' && prefix[1] === '(tabs)' && prefix[2] === 'index') {
    if (
      segments[0] === '(drawer)' &&
      segments[1] === '(tabs)' &&
      (segments[2] === undefined || segments[2] === 'index')
    ) {
      return true;
    }
  }
  return prefix.every((seg, i) => segments[i] === seg);
}

function MenuButton({
  icon,
  label,
  onPress,
  isActive,
}: {
  icon: MenuIconPair;
  label: string;
  onPress: () => void;
  isActive: boolean;
}) {
  const foreground = useThemeColor('foreground');

  return (
    <GesturePressable
      disabled={isActive}
      onPress={onPress}
      style={({ pressed }) => [styles.menuButton, pressed && { opacity: alpha.strong }]}>
      <HStack align="center" spacing={spacing.md}>
        <Icon
          name={isActive ? icon.selected : icon.default}
          color={foreground}
          size={iconSize.xl}
        />
        <Text size={18} bold style={{ color: foreground }}>
          {label}
        </Text>
      </HStack>
    </GesturePressable>
  );
}

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const segments = useSegments();
  const navInProgressRef = useRef(false);

  const isRouteActive = useCallback(
    (route: MenuRoute) => {
      const item = MENU_ITEMS.find((m) => m.route === route);
      if (!item) return false;
      return segmentsMatch(segments as string[], item.activeSegments);
    },
    [segments]
  );

  const handleNavigation = useCallback(
    (route: MenuRoute) => {
      if (navInProgressRef.current) return;
      if (isRouteActive(route)) {
        props.navigation.closeDrawer();
        return;
      }
      navInProgressRef.current = true;
      router.navigate(route);
      props.navigation.closeDrawer();
      setTimeout(() => {
        navInProgressRef.current = false;
      }, 400);
    },
    [isRouteActive, props.navigation]
  );

  const surface = useThemeColor('surface');
  const closeDrawer = useCallback(() => props.navigation.closeDrawer(), [props.navigation]);

  return (
    <View style={{ flex: 1, backgroundColor: surface }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}>
        <DrawerProfileChrome closeDrawer={closeDrawer} />
        <VStack spacing={0}>
          {MENU_ITEMS.map((item, index) => (
            <MenuButton
              key={index}
              icon={item.icon}
              label={item.label}
              onPress={() => handleNavigation(item.route)}
              isActive={isRouteActive(item.route)}
            />
          ))}
        </VStack>
        <Spacer size={spacing['4xl']} />
      </ScrollView>
    </View>
  );
}

export default function DrawerLayout() {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.82, 320);
  const [surface, border] = useThemeColor(['surface', 'separator-secondary'] as const);
  const overlayRgb = useColorScheme() === 'light' ? '255,255,255' : '0,0,0';
  return (
    <GestureHandlerRootView style={[styles.container, { backgroundColor: surface }]}>
      <Drawer
        screenOptions={{
          headerShown: false,
          drawerType: 'slide',
          drawerStyle: {
            width: drawerWidth,
            backgroundColor: 'transparent',
            overflow: 'hidden',
          },
          sceneStyle: {
            borderTopLeftRadius: radius['2xl'],
            borderBottomLeftRadius: radius['2xl'],
            borderCurve: 'continuous',
            overflow: 'hidden',
          },
          overlayColor: `rgba(${overlayRgb},${alpha.strong})`,
          overlayStyle: {
            borderTopLeftRadius: radius['2xl'],
            borderBottomLeftRadius: radius['2xl'],
            borderCurve: 'continuous',
            boxShadow: `inset ${StyleSheet.hairlineWidth}px 0 0 0 ${border}`,
          },
          swipeEdgeWidth: 40,
          swipeMinDistance: 10,
        }}
        drawerContent={(props) => <CustomDrawerContent {...props} />}>
        <Drawer.Screen
          name="(tabs)"
          options={{
            drawerLabel: 'Wallet',
            title: 'Wallet',
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  menuButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing['2xl'],
  },
  scrollContent: {
    flexGrow: 1,
  },
});
