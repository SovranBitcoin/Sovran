# Expo Router Navigation Guide

A comprehensive guide to implementing native tab navigation with header buttons and a gesture-enabled drawer in Expo Router.

## Table of Contents

- [Overview](#overview)
- [Dependencies](#dependencies)
- [Architecture](#architecture)
- [1. Native Tabs](#1-native-tabs)
- [2. Header Title Buttons](#2-header-title-buttons)
- [3. Gesture-Enabled Drawer](#3-gesture-enabled-drawer)
- [4. Putting It All Together](#4-putting-it-all-together)
- [File Structure](#file-structure)

---

## Overview

This app demonstrates a navigation pattern with:
- **Native bottom tabs** using Expo Router's experimental `NativeTabs` API
- **Custom header buttons** (hamburger menu, settings, share, etc.)
- **Animated slide-out drawer** with gesture support (edge swipe + drag)

The key insight is that each tab has its own **Stack navigator** nested inside, allowing per-tab header customization.

---

## Dependencies

```json
{
  "dependencies": {
    "expo-router": "~6.0.15",
    "@react-navigation/native": "^7.1.8",
    "react-native-gesture-handler": "~2.28.0",
    "react-native-reanimated": "~4.1.1",
    "react-native-safe-area-context": "~5.6.0",
    "expo-symbols": "~1.0.7",
    "@expo/vector-icons": "^15.0.3"
  }
}
```

---

## Architecture

```
app/
├── _layout.tsx              # Root: ThemeProvider + DrawerProvider + Drawer + Stack
├── (tabs)/
│   ├── _layout.tsx          # NativeTabs with triggers for each tab
│   ├── index/
│   │   ├── _layout.tsx      # Stack with header buttons (hamburger + settings)
│   │   └── index.tsx        # Home screen content
│   └── explore/
│       ├── _layout.tsx      # Stack with header buttons (search + share)
│       └── index.tsx        # Explore screen content
└── modal.tsx                # Example modal screen
```

**Key Pattern**: Each tab folder contains its own `_layout.tsx` with a `Stack` navigator. This is where you configure header buttons.

---

## 1. Native Tabs

Native tabs use the experimental `NativeTabs` API from `expo-router/unstable-native-tabs`. This renders truly native tab bars on iOS (UITabBarController) and Android (BottomNavigationView).

### File: `app/(tabs)/_layout.tsx`

```tsx
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { DynamicColorIOS, Platform } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
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
      
      {/* Each trigger name matches a folder in (tabs)/ */}
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <Label>Home</Label>
      </NativeTabs.Trigger>
      
      <NativeTabs.Trigger name="explore">
        <Icon sf={{ default: 'paperplane', selected: 'paperplane.fill' }} />
        <Label>Explore</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```

### Key Points:

- **`NativeTabs.Trigger name`** must match folder names inside `(tabs)/`
- **`Icon sf`** accepts SF Symbol names with `default` and `selected` variants
- **`DynamicColorIOS`** enables automatic light/dark mode color switching on iOS
- **`disableTransparentOnScrollEdge`** keeps tab bar solid (no blur transparency)

---

## 2. Header Title Buttons

Each tab has its own nested Stack layout where you define header buttons.

### File: `app/(tabs)/index/_layout.tsx`

```tsx
import { useDrawer } from '@/components/drawer';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Stack } from 'expo-router';
import { Pressable } from 'react-native';

export default function HomeLayout() {
  const iconColor = useThemeColor({}, 'text');
  const { openDrawer } = useDrawer();

  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: 'Home',
          headerTransparent: true,
          
          // Left button: Hamburger menu to open drawer
          headerLeft: () => (
            <Pressable onPress={openDrawer} style={{ margin: 2 }}>
              <IconSymbol name="line.3.horizontal" size={30} color={iconColor} />
            </Pressable>
          ),
          
          // Right button: Settings
          headerRight: () => (
            <Pressable
              onPress={() => console.log('Settings pressed')}
              style={{ margin: 2 }}>
              <IconSymbol name="gearshape" size={30} color={iconColor} />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
```

### Key Points:

- **`headerLeft`** and **`headerRight`** accept React components
- **`headerTransparent: true`** allows content to scroll behind the header (parallax effect)
- The `openDrawer` function comes from the DrawerContext (see below)
- **`name="index"`** refers to `index.tsx` in the same folder

### Different Buttons Per Tab

Each tab can have completely different header buttons. Compare:

**Home tab**: Hamburger menu + Settings icon

```tsx
headerLeft: () => <IconSymbol name="line.3.horizontal" ... />
headerRight: () => <IconSymbol name="gearshape" ... />
```

**Explore tab**: Search + Share icons

```tsx
headerLeft: () => <IconSymbol name="magnifyingglass" ... />
headerRight: () => <IconSymbol name="square.and.arrow.up" ... />
```

---

## 3. Gesture-Enabled Drawer

The drawer consists of three parts:

1. **DrawerContext** - State management for open/close
2. **Drawer Component** - The animated drawer UI with gestures
3. **Integration** - Wrapping your app

### File: `components/drawer/drawer-context.tsx`

```tsx
import React, { createContext, useCallback, useContext, useState } from 'react';

type DrawerContextType = {
  isOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
};

const DrawerContext = createContext<DrawerContextType | undefined>(undefined);

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openDrawer = useCallback(() => setIsOpen(true), []);
  const closeDrawer = useCallback(() => setIsOpen(false), []);
  const toggleDrawer = useCallback(() => setIsOpen((prev) => !prev), []);

  return (
    <DrawerContext.Provider value={{ isOpen, openDrawer, closeDrawer, toggleDrawer }}>
      {children}
    </DrawerContext.Provider>
  );
}

export function useDrawer() {
  const context = useContext(DrawerContext);
  if (context === undefined) {
    throw new Error('useDrawer must be used within a DrawerProvider');
  }
  return context;
}
```

### File: `components/drawer/drawer.tsx`

```tsx
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDrawer } from './drawer-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.82, 320);
const VELOCITY_THRESHOLD = 500;
const SWIPE_EDGE_WIDTH = 25;

const SPRING_CONFIG = {
  damping: 22,
  stiffness: 200,
  mass: 0.8,
};

type DrawerItem = {
  icon: string;
  label: string;
  href: string;
};

const MENU_ITEMS: DrawerItem[] = [
  { icon: 'house.fill', label: 'Home', href: '/(tabs)/index' },
  { icon: 'paperplane.fill', label: 'Explore', href: '/(tabs)/explore' },
];

export function Drawer({ children }: { children: React.ReactNode }) {
  const { isOpen, closeDrawer, openDrawer } = useDrawer();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();

  const translateX = useSharedValue(-DRAWER_WIDTH);
  const backdropOpacity = useSharedValue(0);
  const contextX = useSharedValue(0);
  const colors = Colors[colorScheme ?? 'light'];

  // Sync animation with isOpen state
  useEffect(() => {
    if (isOpen) {
      translateX.value = withSpring(0, SPRING_CONFIG);
      backdropOpacity.value = withTiming(1, { duration: 250 });
    } else {
      translateX.value = withSpring(-DRAWER_WIDTH, SPRING_CONFIG);
      backdropOpacity.value = withTiming(0, { duration: 200 });
    }
  }, [isOpen]);

  // Pan gesture for dragging the drawer
  const panGesture = Gesture.Pan()
    .onStart(() => {
      contextX.value = translateX.value;
    })
    .onUpdate((event) => {
      const newValue = contextX.value + event.translationX;
      translateX.value = Math.min(0, Math.max(-DRAWER_WIDTH, newValue));
      backdropOpacity.value = interpolate(
        translateX.value,
        [-DRAWER_WIDTH, 0],
        [0, 1],
        Extrapolation.CLAMP
      );
    })
    .onEnd((event) => {
      const shouldOpen =
        event.velocityX > VELOCITY_THRESHOLD ||
        (event.velocityX > -VELOCITY_THRESHOLD && translateX.value > -DRAWER_WIDTH / 2);

      if (shouldOpen) {
        translateX.value = withSpring(0, SPRING_CONFIG);
        backdropOpacity.value = withTiming(1, { duration: 200 });
        runOnJS(openDrawer)();
      } else {
        translateX.value = withSpring(-DRAWER_WIDTH, SPRING_CONFIG);
        backdropOpacity.value = withTiming(0, { duration: 200 });
        runOnJS(closeDrawer)();
      }
    });

  // Edge swipe gesture to open from left edge
  const edgeGesture = Gesture.Pan()
    .activeOffsetX(10)
    .hitSlop({ left: 0, right: SCREEN_WIDTH - SWIPE_EDGE_WIDTH, top: 0, bottom: 0 })
    .onStart(() => {
      contextX.value = translateX.value;
    })
    .onUpdate((event) => {
      if (event.translationX > 0) {
        const newValue = -DRAWER_WIDTH + event.translationX;
        translateX.value = Math.min(0, newValue);
        backdropOpacity.value = interpolate(
          translateX.value,
          [-DRAWER_WIDTH, 0],
          [0, 1],
          Extrapolation.CLAMP
        );
      }
    })
    .onEnd((event) => {
      const shouldOpen =
        event.velocityX > VELOCITY_THRESHOLD ||
        (event.velocityX > -VELOCITY_THRESHOLD && translateX.value > -DRAWER_WIDTH / 2);

      if (shouldOpen) {
        translateX.value = withSpring(0, SPRING_CONFIG);
        backdropOpacity.value = withTiming(1, { duration: 200 });
        runOnJS(openDrawer)();
      } else {
        translateX.value = withSpring(-DRAWER_WIDTH, SPRING_CONFIG);
        backdropOpacity.value = withTiming(0, { duration: 200 });
        runOnJS(closeDrawer)();
      }
    });

  // Animated styles
  const drawerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
    pointerEvents: backdropOpacity.value > 0 ? 'auto' : 'none',
  }));

  // Scale + round corners effect on main content when drawer opens
  const contentAnimatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      translateX.value,
      [-DRAWER_WIDTH, 0],
      [1, 0.92],
      Extrapolation.CLAMP
    );
    const borderRadius = interpolate(
      translateX.value,
      [-DRAWER_WIDTH, 0],
      [0, 24],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ scale }],
      borderRadius,
    };
  });

  return (
    <GestureHandlerRootView style={styles.container}>
      {/* Black background visible when content scales down */}
      <View style={styles.blackBackground} />
      
      {/* Main Content with Edge Gesture */}
      <GestureDetector gesture={edgeGesture}>
        <Animated.View style={[styles.contentContainer, contentAnimatedStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>

      {/* Backdrop overlay */}
      <Animated.View style={[styles.backdrop, backdropAnimatedStyle]}>
        <Pressable style={styles.backdropPressable} onPress={closeDrawer}>
          <View style={[
            styles.backdropInner, 
            { backgroundColor: isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)' }
          ]} />
        </Pressable>
      </Animated.View>

      {/* Drawer Panel */}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[
            styles.drawer,
            drawerAnimatedStyle,
            {
              width: DRAWER_WIDTH,
              backgroundColor: isDark ? '#1a1a1d' : '#ffffff',
              paddingTop: insets.top + 20,
              paddingBottom: insets.bottom + 20,
            },
          ]}>
          {/* Menu Items */}
          <View style={styles.menuContainer}>
            {MENU_ITEMS.map((item, index) => (
              <Pressable
                key={index}
                style={({ pressed }) => [
                  styles.menuItem,
                  {
                    backgroundColor: pressed
                      ? isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'
                      : 'transparent',
                  },
                ]}
                onPress={() => {
                  router.push(item.href as any);
                  closeDrawer();
                }}>
                <View style={[
                  styles.menuIconContainer, 
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }
                ]}>
                  <IconSymbol name={item.icon as any} size={20} color={colors.tint} />
                </View>
                <ThemedText style={styles.menuLabel}>{item.label}</ThemedText>
              </Pressable>
            ))}
          </View>

          {/* Drag Handle Indicator */}
          <View style={styles.dragHandleContainer}>
            <View style={[
              styles.dragHandle, 
              { backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' }
            ]} />
          </View>
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  blackBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    zIndex: 0,
  },
  contentContainer: {
    flex: 1,
    overflow: 'hidden',
    zIndex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  backdropPressable: { flex: 1 },
  backdropInner: { flex: 1 },
  drawer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 2,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 25,
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
  },
  menuContainer: {
    flex: 1,
    paddingHorizontal: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    gap: 14,
  },
  menuIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  dragHandleContainer: {
    position: 'absolute',
    right: 8,
    top: '50%',
    transform: [{ translateY: -20 }],
  },
  dragHandle: {
    width: 4,
    height: 40,
    borderRadius: 2,
  },
});
```

### File: `components/drawer/index.ts`

```tsx
export { Drawer } from './drawer';
export { DrawerProvider, useDrawer } from './drawer-context';
```

### Key Drawer Features:

1. **Two gesture types**:
   - **Edge swipe** (`edgeGesture`) - Swipe from left edge to open
   - **Pan gesture** (`panGesture`) - Drag drawer once open

2. **Animated effects**:
   - Drawer slides in from left
   - Main content scales down (0.92x) with rounded corners
   - Backdrop fades in

3. **Velocity-based behavior**: Fast swipes instantly open/close regardless of position

4. **runOnJS**: Required when calling React state setters from Reanimated worklets

---

## 4. Putting It All Together

### File: `app/_layout.tsx`

```tsx
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { Drawer, DrawerProvider } from '@/components/drawer';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <DrawerProvider>
        <Drawer>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
        </Drawer>
        <StatusBar style="auto" />
      </DrawerProvider>
    </ThemeProvider>
  );
}
```

### The Provider Hierarchy:

```
ThemeProvider
  └── DrawerProvider      ← Provides drawer state
        └── Drawer        ← Renders drawer UI + wraps children
              └── Stack   ← Your app's navigation
```

---

## File Structure

Create these files to replicate this pattern:

```
app/
├── _layout.tsx
├── (tabs)/
│   ├── _layout.tsx
│   ├── index/
│   │   ├── _layout.tsx
│   │   └── index.tsx
│   └── explore/
│       ├── _layout.tsx
│       └── index.tsx
components/
├── drawer/
│   ├── drawer-context.tsx
│   ├── drawer.tsx
│   └── index.ts
├── ui/
│   ├── icon-symbol.tsx        (fallback for non-iOS)
│   └── icon-symbol.ios.tsx    (native SF Symbols)
constants/
└── theme.ts
hooks/
├── use-color-scheme.ts
└── use-theme-color.ts
```

---

## Quick Start Checklist

1. Install dependencies:
   ```bash
   npx expo install react-native-gesture-handler react-native-reanimated react-native-safe-area-context expo-symbols @expo/vector-icons
   ```

2. Create drawer components (`components/drawer/`)

3. Create tab layout with `NativeTabs` (`app/(tabs)/_layout.tsx`)

4. Create nested stack layouts for each tab with header buttons

5. Wrap app in `DrawerProvider` + `Drawer` in root layout

6. Use `useDrawer()` hook in any component to open/close drawer

---

## Notes

- **`expo-router/unstable-native-tabs`** is experimental - API may change
- The drawer's `GestureHandlerRootView` must be at the root for gestures to work properly
- SF Symbol icons work natively on iOS; use `IconSymbol` component with Material Icons fallback for Android/web
- The `unstable_settings.anchor` in root layout sets the default route


