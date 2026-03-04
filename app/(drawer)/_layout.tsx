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
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useInitializationReset } from '@/shared/providers/InitializationProvider';
import { Text } from '@/shared/ui/primitives/Text';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { getUsername } from '@/shared/lib/username';
import { useProfileDisplay } from '@/shared/hooks/useProfileDisplay';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProfileStore, ProfileEntry } from '@/shared/stores/global/profileStore';
import {
  createAndSwitchProfile,
  isProfileTransitionInProgress,
  switchToExistingProfile,
  switchToImportedProfile,
} from '@/shared/lib/profile/profileSessionOrchestrator';
import { profileSwitcherPopup } from '@/shared/lib/popup';

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
    route: '(drawer)/(tabs)/index',
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
    route: '(settings-flow)',
    drawerLabel: 'settings',
  },
];

function ProfileSelector({ closeDrawer }: { closeDrawer: () => void }) {
  const [foreground, defaultColor, shade400] = useThemeColor([
    'foreground',
    'default',
    'shade-400',
  ] as const);
  const { getKeysForAccount } = useNostrKeysContext();
  const { resetStages, cancelResetStages } = useInitializationReset();
  const profiles = useProfileStore((s) => s.profiles);
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);

  const handleSwitchProfile = useCallback(
    async (accountIndex: number) => {
      if (accountIndex === activeAccountIndex) return;
      if (isProfileTransitionInProgress()) return;

      // Close drawer immediately so loading UI is visible.
      closeDrawer();
      await switchToExistingProfile({
        accountIndex,
        resetStages,
        cancelResetStages,
      });
    },
    [activeAccountIndex, closeDrawer, resetStages, cancelResetStages]
  );

  const handleAddProfile = useCallback(async () => {
    if (isProfileTransitionInProgress()) return;

    // Close drawer immediately so loading UI is visible.
    closeDrawer();
    await createAndSwitchProfile({
      getKeysForAccount,
      resetStages,
      cancelResetStages,
    });
  }, [getKeysForAccount, closeDrawer, resetStages, cancelResetStages]);

  const handleImportProfile = useCallback(
    async (npubNumber: number) => {
      if (isProfileTransitionInProgress()) return;

      // Profile entry is created by ImportNsec before this callback runs.
      closeDrawer();
      await switchToImportedProfile({
        accountIndex: npubNumber,
        resetStages,
        cancelResetStages,
      });
    },
    [closeDrawer, resetStages, cancelResetStages]
  );

  const handleOpenProfileSheet = useCallback(() => {
    profileSwitcherPopup({
      onSwitchProfile: handleSwitchProfile,
      onAddProfile: handleAddProfile,
      onImportProfile: handleImportProfile,
    });
  }, [handleSwitchProfile, handleAddProfile, handleImportProfile]);

  // Only show selector if there are profiles (should always be true after first launch)
  if (profiles.length === 0) return null;

  return (
    <HStack align="center" spacing={4} style={styles.profileSelector}>
      {profiles
        .filter((profile: ProfileEntry) => profile.accountIndex !== activeAccountIndex)
        .sort((a, b) => (a.source === 'imported' ? 0 : 1) - (b.source === 'imported' ? 0 : 1))
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
                picture={profile.cachedPicture}
                name={profile.cachedDisplayName || getUsername(profile.pubkey)}
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
  const { displayName, picture } = useProfileDisplay(nostrKeys?.pubkey || '');

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
      colors={[surface, surface, surface, surface, surface, surface, opacity(surface, 0)]}
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
                picture={picture}
                name={displayName}
                size={64}
                variant="person"
              />
              <VStack align="center" spacing={8}>
                <Text bold size={20} style={{ textAlign: 'center', color: foreground }}>
                  {displayName}
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
  const [foreground, surfaceTertiary] = useThemeColor(['foreground', 'surface-tertiary'] as const);

  return (
    <GesturePressable
      disabled={isActive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuButton,
        isActive && {
          backgroundColor: opacity(surfaceTertiary, 0.72),
        },
        pressed && { opacity: 0.6 },
      ]}>
      <HStack align="center" spacing={12}>
        <Icon name={icon} color={isActive ? foreground : opacity(foreground, 0.5)} size={24} />
        <Text size={18} bold style={{ color: isActive ? foreground : opacity(foreground, 0.5) }}>
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
      // Wallet route points to tab index; keep legacy checks for grouped paths.
      if (route === '(drawer)/(tabs)' || route === '(drawer)/(tabs)/index') {
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
