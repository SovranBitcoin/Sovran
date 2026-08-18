import React, { useCallback, useEffect, useRef } from 'react';
import { Drawer, DrawerContentComponentProps, useDrawerStatus } from 'expo-router/drawer';
import {
  GestureHandlerRootView,
  Pressable as GesturePressable,
} from 'react-native-gesture-handler';
import { StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { router, useSegments } from 'expo-router';
import { getScreenCornerRadius } from '@/shared/lib/screenCornerRadius';

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
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Badge } from '@/shared/ui/primitives/Badge';
import { useNip46RequestsStore } from '@/features/nostrSigner';

type MenuRoute =
  | '/(drawer)/(tabs)/feed'
  // Wallet is the `(tabs)/index` folder, which expo-router collapses to an
  // empty path segment — so its canonical route is the app root `/`, not
  // `/(drawer)/(tabs)/index` (that path resolves to +not-found at runtime).
  | '/'
  | '/(drawer)/(tabs)/contacts'
  | '/(drawer)/(tabs)/notifications'
  | '/(drawer)/(tabs)/ai'
  | '/(signer-flow)'
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
  /**
   * Optional live badge-count selector hook. Must be a stable module-level
   * hook (rules-of-hooks: every MenuButton calls exactly one count hook).
   * The badge renders only while the count is > 0.
   */
  useBadgeCount?: () => number;
};

const useNoBadgeCount = () => 0;
const useSignerPendingCount = () => useNip46RequestsStore((s) => s.pending.length);

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
    route: '/',
    activeSegments: ['(drawer)', '(tabs)', 'index'],
  },
  {
    icon: { default: 'mdi:account-group-outline', selected: 'mdi:account-group' },
    label: 'Contacts',
    route: '/(drawer)/(tabs)/contacts',
    activeSegments: ['(drawer)', '(tabs)', 'contacts'],
  },
  {
    icon: { default: 'mdi:bell-outline', selected: 'mdi:bell' },
    label: 'Notifications',
    route: '/(drawer)/(tabs)/notifications',
    activeSegments: ['(drawer)', '(tabs)', 'notifications'],
  },
  {
    icon: { default: 'mdi:robot-outline', selected: 'mdi:robot' },
    label: 'AI',
    route: '/(drawer)/(tabs)/ai',
    activeSegments: ['(drawer)', '(tabs)', 'ai'],
  },
  {
    icon: { default: 'mdi:key-variant', selected: 'mdi:key-variant' },
    label: 'Remote Login',
    route: '/(signer-flow)',
    activeSegments: ['(signer-flow)'],
    useBadgeCount: useSignerPendingCount,
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

// Memoized with a STABLE navigate callback: the drawer re-renders inside the
// same commit native-stack gates the push animation on (useSegments flips when
// a route is pushed), so each row must bail out unless ITS active state
// changed — otherwise 6 rows + chrome re-render while the card slide waits.
const MenuButton = React.memo(function MenuButton({
  icon,
  label,
  route,
  onNavigate,
  isActive,
  useBadgeCount = useNoBadgeCount,
}: {
  icon: MenuIconPair;
  label: string;
  route: MenuRoute;
  onNavigate: (route: MenuRoute) => void;
  isActive: boolean;
  useBadgeCount?: () => number;
}) {
  const foreground = useThemeColor('foreground');
  const badgeCount = useBadgeCount();

  return (
    <GesturePressable
      disabled={isActive}
      onPress={() => onNavigate(route)}
      testID={`drawer-menu-${label.toLowerCase().replace(/\s+/g, '-')}`}
      accessible
      accessibilityLabel={label}
      style={({ pressed }) => [styles.menuButton, pressed && { opacity: alpha.strong }]}>
      <HStack align="center" gap={spacing.md}>
        <Icon
          name={isActive ? icon.selected : icon.default}
          color={foreground}
          size={iconSize.xl}
        />
        <Text size={18} bold style={{ color: foreground }}>
          {label}
        </Text>
        {badgeCount > 0 ? <Badge variant="primary">{badgeCount}</Badge> : null}
      </HStack>
    </GesturePressable>
  );
});

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const segments = useSegments();
  // Read segments through a ref inside the navigation callback so its
  // identity survives segment changes — keeps the memoized MenuButtons from
  // re-rendering during the push-gated commit.
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const navInProgressRef = useRef(false);

  // Fire a single Light-impact haptic the moment the drawer commits to a
  // state change — covers gesture release that crosses the open/close
  // threshold, the hamburger button, and overlay taps, since all three
  // converge on the same navigation state.
  const drawerStatus = useDrawerStatus();
  const prevStatusRef = useRef(drawerStatus);
  useEffect(() => {
    if (prevStatusRef.current !== drawerStatus) {
      void EnhancedHaptics.buttonHaptic();
    }
    prevStatusRef.current = drawerStatus;
  }, [drawerStatus]);

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
      const item = MENU_ITEMS.find((m) => m.route === route);
      const active = item
        ? segmentsMatch(segmentsRef.current as string[], item.activeSegments)
        : false;
      if (active) {
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
    [props.navigation]
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
        <VStack gap={0}>
          {MENU_ITEMS.map((item, index) => (
            <MenuButton
              key={index}
              icon={item.icon}
              label={item.label}
              route={item.route}
              onNavigate={handleNavigation}
              isActive={isRouteActive(item.route)}
              useBadgeCount={item.useBadgeCount}
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
  // Match the device's hardware screen corner radius so the scene's rounded
  // TL/BL hug the physical display curve. Falls back to a token-driven radius
  // when null (Android <12, or devices without rounded displays).
  const deviceRadius = getScreenCornerRadius(radius['2xl']);
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
            borderTopLeftRadius: deviceRadius,
            borderBottomLeftRadius: deviceRadius,
            borderCurve: 'continuous',
            overflow: 'hidden',
          },
          overlayColor: `rgba(${overlayRgb},${alpha.strong})`,
          overlayStyle: {
            borderTopLeftRadius: deviceRadius,
            borderBottomLeftRadius: deviceRadius,
            borderCurve: 'continuous',
            boxShadow: `inset ${StyleSheet.hairlineWidth}px 0 0 0 ${border}`,
          },
          swipeEdgeWidth: 128,
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
