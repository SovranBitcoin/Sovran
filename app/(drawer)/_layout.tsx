import React, { useCallback, useRef } from 'react';
import { Drawer } from 'expo-router/drawer';
import {
  GestureHandlerRootView,
  Pressable as GesturePressable,
} from 'react-native-gesture-handler';
import { StyleSheet, ScrollView, Dimensions } from 'react-native';
import { router, usePathname } from 'expo-router';
import { DrawerContentComponentProps } from '@react-navigation/drawer';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { useThemeColor } from '@/hooks/useThemeColor';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useInitializationReset } from 'providers/InitializationProvider';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { Avatar } from 'components/ui/Avatar';
import { getUsername } from 'helper/username';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProfileStore, ProfileEntry } from '@/stores/profileStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { CocoManager } from '@/helper/coco/manager';
import { rehydrateProfileStores } from '@/helper/profileScopedStorage';
import { SheetManager } from 'react-native-actions-sheet';

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
    icon: 'mingcute:home-4-fill',
    label: 'Feed',
    route: '(drawer)/(tabs)/feed',
    drawerLabel: 'feed',
  },
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

function ProfileSelector({ closeDrawer }: { closeDrawer: () => void }) {
  const [foreground, defaultColor, shade400] = useThemeColor(['foreground', 'default', 'shade-400'] as const);
  const { getKeysForAccount } = useNostrKeysContext();
  const { resetStages, cancelResetStages } = useInitializationReset();
  const devMode = useSettingsStore((s) => s.experimental);
  const profiles = useProfileStore((s) => s.profiles);
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);

  // Guard against concurrent profile switches (double-tap / rapid taps)
  const switchInProgress = useRef(false);

  const handleSwitchProfile = useCallback(
    async (accountIndex: number) => {
      if (accountIndex === activeAccountIndex) return;
      if (switchInProgress.current) return;
      switchInProgress.current = true;

      try {
        // 1. Close drawer immediately
        closeDrawer();

        // 2. Show loading screen instantly
        resetStages();

        // 3. Cleanup Coco manager
        await CocoManager.cleanup();

        // 4. Switch profile (sets activeAccountIndex)
        useProfileStore.getState().switchProfile(accountIndex);

        // 5. Rehydrate all profile-scoped stores from new profile's storage
        await rehydrateProfileStores();

        // 6. Key change in _layout.tsx triggers full inner provider remount
      } catch (error) {
        console.error('Failed to switch profile:', error);
        cancelResetStages();
      } finally {
        switchInProgress.current = false;
      }
    },
    [activeAccountIndex, closeDrawer, resetStages, cancelResetStages]
  );

  const handleAddProfile = useCallback(async () => {
    if (switchInProgress.current) return;
    switchInProgress.current = true;

    try {
      // 1. Close drawer and show loading screen instantly — no perceived delay
      closeDrawer();
      resetStages();

      const nextIndex = useProfileStore.getState().getNextAccountIndex();

      // 2. Derive keys (crypto work happens behind the loading screen)
      const newKeys = await getKeysForAccount(nextIndex);
      if (!newKeys?.pubkey) {
        console.warn('Failed to derive keys for new profile');
        cancelResetStages();
        return;
      }

      // 3. Store the new profile
      useProfileStore.getState().addProfile(nextIndex, newKeys.pubkey);

      // 4. Cleanup Coco, switch profile, rehydrate stores
      await CocoManager.cleanup();
      useProfileStore.getState().switchProfile(nextIndex);
      await rehydrateProfileStores();

      // 5. Key change in _layout.tsx triggers full inner provider remount
    } catch (error) {
      console.error('Failed to add profile:', error);
      cancelResetStages();
    } finally {
      switchInProgress.current = false;
    }
  }, [getKeysForAccount, closeDrawer, resetStages, cancelResetStages]);

  const handleOpenProfileSheet = useCallback(() => {
    SheetManager.show('profile-switcher', {
      context: 'global',
      payload: {
        onSwitchProfile: handleSwitchProfile,
        onAddProfile: handleAddProfile,
      },
    });
  }, [handleSwitchProfile, handleAddProfile]);

  // Profile selector is only available when experimental/dev mode is enabled
  if (!devMode) return null;

  // Only show selector if there are profiles (should always be true after first launch)
  if (profiles.length === 0) return null;

  return (
    <HStack align="center" spacing={4} style={styles.profileSelector}>
      {profiles
        .filter((profile: ProfileEntry) => profile.accountIndex !== activeAccountIndex)
        .slice(0, 3)
        .map((profile: ProfileEntry) => {
          const isActive = profile.accountIndex === activeAccountIndex;
          return (
            <TouchableOpacity
              key={profile.accountIndex}
              onPress={() => handleSwitchProfile(profile.accountIndex)}
              style={[
                styles.profileAvatarButton,
                isActive && {
                  borderColor: shade400,
                  borderWidth: 2,
                },
              ]}>
              <Avatar
                seed={profile.pubkey}
                name={getUsername(profile.pubkey)}
                size={30}
                variant="person"
              />
            </TouchableOpacity>
          );
        })}
      <TouchableOpacity
        onPress={handleOpenProfileSheet}
        style={[
          styles.profileAvatarButton,
          {
              borderColor: defaultColor,
              borderWidth: 2,
              backgroundColor: defaultColor,
          },
        ]}>
        <Icon name="tabler:dots" size={24} color={foreground} />
      </TouchableOpacity>
    </HStack>
  );
}

function ProfileHeader({ closeDrawer }: { closeDrawer: () => void }) {
  const { keys: nostrKeys } = useNostrKeysContext();
  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);
  const insets = useSafeAreaInsets();

  const handlePress = useCallback(() => {
    if (nostrKeys?.pubkey) {
      closeDrawer();
      router.navigate({
        pathname: '/(user-flow)/profile' as any,
        params: {
          pubkey: nostrKeys.pubkey,
        },
      });
    }
  }, [nostrKeys, closeDrawer]);

  return (
    <LinearGradient
      colors={[
        surface,
        surface,
        surface,
        surface,
        surface,
        surface,
        opacity(surface, 0),
      ]}
      style={[styles.gradientContainer, { paddingTop: insets.top + 16 }]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}>
      <View style={styles.headerContent}>
        <ProfileSelector closeDrawer={closeDrawer} />
        <TouchableOpacity style={styles.profileTouchable} onPress={handlePress}>
          {nostrKeys?.pubkey && (
            <VStack align="center" spacing={16}>
              <Avatar
                seed={nostrKeys?.pubkey}
                name={getUsername(nostrKeys?.pubkey)}
                size={64}
                variant="person"
              />
              <VStack align="center" spacing={8}>
                <Text bold size={20} style={{ textAlign: 'center', color: foreground }}>
                  {getUsername(nostrKeys?.pubkey)}
                </Text>
                <Icon size={42} name="stash:qr-code" color={foreground} />
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
  const [foreground, accent, surfaceTertiary] = useThemeColor(['foreground', 'accent', 'surface-tertiary'] as const);

  return (
    <GesturePressable
      disabled={isActive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuButton,
        isActive && {
          backgroundColor: opacity(surfaceTertiary, 0.72),
          borderColor: opacity(accent, 0.5),
        },
        pressed && { opacity: 0.6 },
      ]}>
      <HStack align="center" spacing={12}>
        <Icon
          name={icon}
          color={isActive ? foreground : opacity(foreground, 0.5)}
          size={24}
        />
        <Text
          size={18}
          bold
          style={{ color: isActive ? foreground : opacity(foreground, 0.5) }}>
          {label}
        </Text>
      </HStack>
    </GesturePressable>
  );
}

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const surface = useThemeColor('surface');
  const pathname = usePathname();
  const navInProgressRef = useRef(false);

  const isRouteActive = useCallback(
    (route: string) => {
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
            !pathname.includes('explore') &&
            !pathname.includes('feed'))
        );
      }
      if (route.includes('(tabs)/feed') && pathname.includes('feed')) {
        return true;
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
    },
    [pathname]
  );

  const handleNavigation = useCallback(
    (route: string) => {
      if (navInProgressRef.current) return;
      if (isRouteActive(route)) {
        props.navigation.closeDrawer();
        return;
      }
      navInProgressRef.current = true;
      router.navigate(`/${route}` as any);
      props.navigation.closeDrawer();
      setTimeout(() => {
        navInProgressRef.current = false;
      }, 400);
    },
    [isRouteActive, props.navigation]
  );

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: surface, flex: 1 }}
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
  const surface = useThemeColor('surface');

  return (
    <GestureHandlerRootView style={styles.container}>
      <Drawer
        screenOptions={{
          headerShown: false,
          drawerType: 'slide',
          drawerStyle: {
            width: DRAWER_WIDTH,
            backgroundColor: surface,
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
    // padding: 16,
    // paddingTop: 0,
  },
  profileSelector: {
    marginBottom: 16,
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderRadius: 20,
    justifyContent: 'flex-end',
  },
  profileAvatarButton: {
    borderRadius: 18,
    padding: 2,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  moreProfilesButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileTouchable: {
    alignItems: 'center',
  },
  menuButton: {
    padding: 18,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginHorizontal: 8,
    marginVertical: 4,
  },
  scrollContent: {
    flexGrow: 1,
  },
});
