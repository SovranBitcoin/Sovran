import React, { useEffect } from 'react';
import { Dimensions, Pressable, StyleSheet, ScrollView } from 'react-native';
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
import { LinearGradient } from 'expo-linear-gradient';
import { nip19 } from 'nostr-tools';
import { router } from 'expo-router';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { View, VStack, HStack, Spacer } from 'components/ui/View';
import { Avatar } from 'components/ui/Avatar';
import { getUsername } from 'helper/username';
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

type MenuItem = {
  icon: string;
  label: string;
  href: string;
};

const MENU_ITEMS: MenuItem[] = [
  { icon: 'fluent:wallet-20-filled', label: 'Wallet', href: '/(tabs)/index' },
  { icon: 'fluent:arrow-swap-16-filled', label: 'Payments', href: '/(tabs)/payments' },
  { icon: 'clarity:internet-of-things-solid', label: 'Lifestyle', href: '/(tabs)/explore' },
  { icon: 'material-symbols:settings-rounded', label: 'Settings', href: '/settings-pages' },
];

function ProfileHeader() {
  const { keys: nostrKeys } = useNostrKeysContext();
  const { getPrimaryColor } = useTheme();
  const { closeDrawer } = useDrawer();

  return (
    <LinearGradient
      colors={[
        getPrimaryColor('900'),
        getPrimaryColor('900'),
        getPrimaryColor('900'),
        getPrimaryColor('900'),
        getPrimaryColor('900'),
        getPrimaryColor('900'),
        opacity(getPrimaryColor('900'), 0),
      ]}
      style={styles.gradientContainer}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}>
      <View style={styles.headerContent}>
        <TouchableOpacity
          style={styles.profileTouchable}
          onPress={() => {
            if (nostrKeys?.pubkey) {
              closeDrawer();
              router.push({
                pathname: '/share',
                params: {
                  type: 'profile',
                  data: nostrKeys?.npub || nip19.npubEncode(nostrKeys?.pubkey),
                },
              });
            }
          }}>
          {nostrKeys?.pubkey && (
            <VStack align="center" spacing={16}>
              <Avatar seed={nostrKeys?.pubkey} size={64} variant="person" />
              <VStack align="center" spacing={8}>
                <Text bold size={20} style={{ textAlign: 'center', color: getPrimaryColor('0') }}>
                  {getUsername(nostrKeys?.pubkey)}
                </Text>
                <Icon size={42} name="stash:qr-code" color={getPrimaryColor('0')} />
              </VStack>
            </VStack>
          )}
        </TouchableOpacity>
      </View>
      <Spacer size={58} />
    </LinearGradient>
  );
}

function ProfileButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  const { getPrimaryColor } = useTheme();

  return (
    <Pressable onPress={onPress} style={styles.menuButton}>
      <HStack align="center" spacing={12}>
        <Icon name={icon} color={getPrimaryColor('0')} size={24} />
        <Text size={18} bold style={{ color: getPrimaryColor('0') }}>
          {label}
        </Text>
      </HStack>
    </Pressable>
  );
}

function DrawerContent() {
  const { getPrimaryColor } = useTheme();
  const { closeDrawer } = useDrawer();

  const handleNavigation = (href: string) => {
    closeDrawer();
    router.push(href as any);
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: getPrimaryColor('900') }}
      contentContainerStyle={styles.scrollContent}>
      <Spacer size={64} />
      <ProfileHeader />
      <VStack spacing={0} style={{ marginTop: -16 }}>
        {MENU_ITEMS.map((item, index) => (
          <ProfileButton
            key={index}
            icon={item.icon}
            label={item.label}
            onPress={() => handleNavigation(item.href)}
          />
        ))}
      </VStack>
      <Spacer size={48} />
    </ScrollView>
  );
}

export function Drawer({ children }: { children: React.ReactNode }) {
  const { isOpen, closeDrawer, openDrawer } = useDrawer();
  const { getPrimaryColor } = useTheme();

  const translateX = useSharedValue(-DRAWER_WIDTH);
  const backdropOpacity = useSharedValue(0);
  const contextX = useSharedValue(0);

  // Sync animation with isOpen state
  useEffect(() => {
    if (isOpen) {
      translateX.value = withSpring(0, SPRING_CONFIG);
      backdropOpacity.value = withTiming(1, { duration: 250 });
    } else {
      translateX.value = withSpring(-DRAWER_WIDTH, SPRING_CONFIG);
      backdropOpacity.value = withTiming(0, { duration: 200 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const scale = interpolate(translateX.value, [-DRAWER_WIDTH, 0], [1, 0.92], Extrapolation.CLAMP);
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

      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, backdropAnimatedStyle]}>
        <Pressable style={styles.backdropPressable} onPress={handleBackdropPress}>
          <View style={[styles.backdropInner, { backgroundColor: 'rgba(0,0,0,0.6)' }]} />
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
              backgroundColor: getPrimaryColor('900'),
            },
          ]}>
          <DrawerContent />
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
    overflow: 'hidden',
  },
  gradientContainer: {
    flex: 1,
    padding: 16,
  },
  headerContent: {
    flex: 1,
    backgroundColor: 'transparent',
    padding: 16,
    paddingTop: 0,
  },
  profileTouchable: {
    alignItems: 'center',
  },
  menuButton: {
    padding: 32,
    paddingBottom: 32,
    paddingTop: 0,
  },
  scrollContent: {
    flexGrow: 1,
  },
});
