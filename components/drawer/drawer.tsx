import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
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

  // Pan gesture for the drawer
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

  // Edge swipe gesture to open
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

  const handleBackdropPress = () => {
    closeDrawer();
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      {/* Black background layer */}
      <View style={styles.blackBackground} />
      
      {/* Main Content with Edge Gesture */}
      <GestureDetector gesture={edgeGesture}>
        <Animated.View style={[styles.contentContainer, contentAnimatedStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>

      {/* Backdrop with blur-like effect */}
      <Animated.View
        style={[
          styles.backdrop,
          backdropAnimatedStyle,
        ]}
      >
        <Pressable style={styles.backdropPressable} onPress={handleBackdropPress}>
          <View style={[styles.backdropInner, { backgroundColor: isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)' }]} />
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
          ]}
        >
          {/* Menu Items */}
          <View style={styles.menuContainer}>
            {MENU_ITEMS.map((item, index) => (
              <Pressable
                key={index}
                style={({ pressed }) => [
                  styles.menuItem,
                  {
                    backgroundColor: pressed
                      ? isDark
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(0,0,0,0.04)'
                      : 'transparent',
                  },
                ]}
                onPress={() => {
                  router.push(item.href as any);
                  closeDrawer();
                }}
              >
                <View style={[styles.menuIconContainer, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' }]}>
                  <IconSymbol name={item.icon as any} size={20} color={colors.tint} />
                </View>
                <Text style={styles.menuLabel}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Drag Handle Indicator */}
          <View style={styles.dragHandleContainer}>
            <View style={[styles.dragHandle, { backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' }]} />
          </View>
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
  backdropPressable: {
    flex: 1,
  },
  backdropInner: {
    flex: 1,
  },
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

