import React, { useCallback } from 'react';
import { Drawer } from 'expo-router/drawer';
import {
  GestureHandlerRootView,
  Pressable as GesturePressable,
} from 'react-native-gesture-handler';
import { StyleSheet, ScrollView, Dimensions } from 'react-native';
import { router, usePathname } from 'expo-router';
import { DrawerContentComponentProps } from '@react-navigation/drawer';
import { LinearGradient } from 'expo-linear-gradient';
import { nip19 } from 'nostr-tools';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { Avatar } from 'components/ui/Avatar';
import { getUsername } from 'helper/username';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.82, 320);

type MenuItem = {
  icon: string;
  label: string;
  route: string;
  drawerLabel: string;
};

const MENU_ITEMS: MenuItem[] = [
  {
    icon: 'fluent:wallet-20-filled',
    label: 'Wallet',
    route: '(drawer)/(tabs)',
    drawerLabel: 'wallet',
  },
  {
    icon: 'fluent:arrow-swap-16-filled',
    label: 'Payments',
    route: '(drawer)/(tabs)/payments',
    drawerLabel: 'payments',
  },
  // {
  //   icon: 'clarity:internet-of-things-solid',
  //   label: 'Explore',
  //   route: '(drawer)/(tabs)/explore',
  //   drawerLabel: 'explore',
  // },
  {
    icon: 'material-symbols:settings-rounded',
    label: 'Settings',
    route: 'settings-pages',
    drawerLabel: 'settings',
  },
];

function ProfileHeader({ closeDrawer }: { closeDrawer: () => void }) {
  const { keys: nostrKeys } = useNostrKeysContext();
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();

  const handlePress = useCallback(() => {
    if (nostrKeys?.pubkey) {
      closeDrawer();
      router.navigate({
        pathname: '/share',
        params: {
          type: 'profile',
          data: nostrKeys?.npub || nip19.npubEncode(nostrKeys?.pubkey),
        },
      });
    }
  }, [nostrKeys, closeDrawer]);

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
      style={[styles.gradientContainer, { paddingTop: insets.top + 16 }]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}>
      <View style={styles.headerContent}>
        <TouchableOpacity style={styles.profileTouchable} onPress={handlePress}>
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

function MenuButton({
  icon,
  label,
  onPress,
  isActive,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  isActive: boolean;
}) {
  const { getPrimaryColor } = useTheme();

  return (
    <GesturePressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuButton,
        isActive && { backgroundColor: opacity(getPrimaryColor('700'), 0.5) },
        pressed && { opacity: 0.6 },
      ]}>
      <HStack align="center" spacing={12}>
        <Icon
          name={icon}
          color={isActive ? getPrimaryColor('0') : getPrimaryColor('300')}
          size={24}
        />
        <Text
          size={18}
          bold
          style={{ color: isActive ? getPrimaryColor('0') : getPrimaryColor('300') }}>
          {label}
        </Text>
      </HStack>
    </GesturePressable>
  );
}

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const { getPrimaryColor } = useTheme();
  const pathname = usePathname();

  const handleNavigation = useCallback(
    (route: string) => {
      router.navigate(`/${route}` as any);
      props.navigation.closeDrawer();
    },
    [props.navigation]
  );

  const isRouteActive = (route: string) => {
    // Wallet is (drawer)/(tabs) - the index tab (no "wallet" in path, it's index)
    if (route === '(drawer)/(tabs)') {
      return (
        pathname === '/' ||
        pathname === '/index' ||
        pathname === '/(drawer)/(tabs)' ||
        pathname === '/(drawer)/(tabs)/' ||
        pathname.includes('(tabs)/index') ||
        (pathname.includes('(tabs)') &&
          !pathname.includes('payments') &&
          !pathname.includes('explore'))
      );
    }
    if (route.includes('(tabs)/payments') && pathname.includes('payments')) {
      return true;
    }
    if (route.includes('(tabs)/explore') && pathname.includes('explore')) {
      return true;
    }
    if (route.includes('settings') && pathname.includes('settings')) {
      return true;
    }
    return false;
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: getPrimaryColor('900'), flex: 1 }}
      contentContainerStyle={styles.scrollContent}>
      <ProfileHeader closeDrawer={() => props.navigation.closeDrawer()} />
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
  );
}

export default function DrawerLayout() {
  const { getPrimaryColor } = useTheme();

  return (
    <GestureHandlerRootView style={styles.container}>
      <Drawer
        screenOptions={{
          headerShown: false,
          drawerType: 'slide',
          drawerStyle: {
            width: DRAWER_WIDTH,
            backgroundColor: getPrimaryColor('900'),
            borderTopRightRadius: 24,
            borderBottomRightRadius: 24,
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
  gradientContainer: {
    padding: 16,
  },
  headerContent: {
    backgroundColor: 'transparent',
    padding: 16,
    paddingTop: 0,
  },
  profileTouchable: {
    alignItems: 'center',
  },
  menuButton: {
    padding: 20,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginHorizontal: 8,
    marginVertical: 2,
  },
  scrollContent: {
    flexGrow: 1,
  },
});
