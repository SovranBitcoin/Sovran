import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Drawer } from 'expo-router/drawer';
import {
  GestureHandlerRootView,
  Pressable as GesturePressable,
} from 'react-native-gesture-handler';
import { StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { router, useSegments } from 'expo-router';
import { DrawerContentComponentProps } from '@react-navigation/drawer';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import {
  AnimatedBackgroundView,
  ScrollableGradientOverlay,
} from '@/shared/ui/composed/BackgroundView';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { BackgroundProvider, useBackgroundContext } from '@/shared/providers/BackgroundProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { DrawerProfileChrome } from '@/shared/blocks/DrawerProfileChrome';

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
      style={({ pressed }) => [styles.menuButton, pressed && { opacity: 0.6 }]}>
      <HStack align="center" spacing={12}>
        <Icon
          name={isActive ? icon.selected : icon.default}
          color={isActive ? foreground : opacity(foreground, 0.5)}
          size={24}
        />
        <Text size={18} bold style={{ color: isActive ? foreground : opacity(foreground, 0.5) }}>
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

  return (
    <BackgroundProvider>
      <DrawerContentInner
        closeDrawer={() => props.navigation.closeDrawer()}
        isRouteActive={isRouteActive}
        handleNavigation={handleNavigation}
      />
    </BackgroundProvider>
  );
}

/** Inner component so useBackgroundContext can read the provider above. */
function DrawerContentInner({
  closeDrawer,
  isRouteActive,
  handleNavigation,
}: {
  closeDrawer: () => void;
  isRouteActive: (route: MenuRoute) => boolean;
  handleNavigation: (route: MenuRoute) => void;
}) {
  const { setConfig } = useBackgroundContext();
  const muted = useThemeColor('muted');
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    setConfig({ blurMode: 'full' });
  }, [setConfig]);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    setContentHeight(height);
  }, []);

  return (
    <AnimatedBackgroundView>
      <ScrollableGradientOverlay contentHeight={contentHeight} />
      <View style={[styles.drawerCardBorder, { borderColor: opacity(muted, 0.3) }]}>
        <View style={styles.drawerCardClip}>
          <BlurCardFrame accentColor={muted} variant="right">
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ flex: 1, zIndex: 1 }}
              contentContainerStyle={styles.scrollContent}
              onContentSizeChange={onContentSizeChange}>
              <DrawerProfileChrome closeDrawer={closeDrawer} />
              <VStack spacing={0} style={{ marginTop: -16 }}>
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
              <Spacer size={48} />
            </ScrollView>
          </BlurCardFrame>
        </View>
      </View>
    </AnimatedBackgroundView>
  );
}

export default function DrawerLayout() {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.82, 320);
  return (
    <GestureHandlerRootView style={styles.container}>
      <Drawer
        screenOptions={{
          headerShown: false,
          drawerType: 'slide',
          drawerStyle: {
            width: drawerWidth,
            backgroundColor: 'transparent',
            borderTopRightRadius: 20,
            borderBottomRightRadius: 20,
            overflow: 'hidden',
          },
          sceneStyle: {
            borderTopLeftRadius: 20,
            borderBottomLeftRadius: 20,
            overflow: 'hidden',
          },
          overlayColor: 'rgba(0,0,0,0.6)',
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
  drawerCardBorder: {
    flex: 1,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  drawerCardClip: {
    flex: 1,
    borderTopRightRadius: 19,
    borderBottomRightRadius: 19,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  menuButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  scrollContent: {
    flexGrow: 1,
  },
});
