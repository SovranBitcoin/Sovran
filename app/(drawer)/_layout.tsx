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
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import {
  switchToExistingProfile,
  createAndSwitchProfile,
  switchToImportedProfile,
} from '@/shared/lib/profile/profileSessionOrchestrator';
import { keyImportFailedPopup, profileSwitcherPopup, walletStillLoadingPopup } from '@/shared/lib/popup';
import { storeImportedNsec } from '@/shared/lib/nostr/secureStorage';
import type { ProfileSwitcherAction } from '@/shared/lib/popup/actionSheetTypes';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.82, 320);

const DRAWER_CLOSE_SETTLE_MS = 300;

function waitForDrawerClose(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DRAWER_CLOSE_SETTLE_MS));
}

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
    icon: 'ph:user-bold',
    label: 'Contacts',
    route: '(drawer)/(tabs)/contacts',
    drawerLabel: 'contacts',
  },
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
  const profiles = useProfileStore((s) => s.profiles);
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);
  const switchingRef = useRef(false);

  const executeProfileAction = useCallback(
    async (action: ProfileSwitcherAction) => {
      if (switchingRef.current) return;
      switchingRef.current = true;

      closeDrawer();
      await waitForDrawerClose();

      switch (action.type) {
        case 'switch': {
          if (action.accountIndex === activeAccountIndex) {
            switchingRef.current = false;
            return;
          }
          const switched = await switchToExistingProfile({ accountIndex: action.accountIndex });
          if (!switched) {
            switchingRef.current = false;
            walletStillLoadingPopup();
          }
          break;
        }
        case 'create': {
          const created = await createAndSwitchProfile();
          if (!created) switchingRef.current = false;
          break;
        }
        case 'import': {
          if (useProfileStore.getState().hasPubkey(action.pubkeyHex)) {
            keyImportFailedPopup({ text: 'This identity already exists as a profile.' });
            return;
          }

          const stored = await storeImportedNsec(action.pubkeyHex, action.nsec);
          if (!stored) {
            keyImportFailedPopup({ text: 'Failed to store nsec securely.' });
            return;
          }

          if (!useProfileStore.getState().hasPubkey(action.pubkeyHex)) {
            useProfileStore
              .getState()
              .addProfile(action.accountIndex, action.pubkeyHex, 'imported');
          }

          const imported = await switchToImportedProfile({ accountIndex: action.accountIndex });
          if (!imported) {
            switchingRef.current = false;
            walletStillLoadingPopup();
          }
          break;
        }
      }
    },
    [closeDrawer, activeAccountIndex]
  );

  const handleOpenProfileSheet = useCallback(() => {
    profileSwitcherPopup({
      onRequestAction: executeProfileAction,
    });
  }, [executeProfileAction]);

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
              onPress={() => {
                if (profile.accountIndex === activeAccountIndex) return;
                void executeProfileAction({
                  type: 'switch',
                  accountIndex: profile.accountIndex,
                });
              }}
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
  const { isOffline } = useOfflineStatus();

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
      style={[styles.gradientContainer, { paddingTop: isOffline ? 0 : insets.top }]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}>
      <View style={styles.headerContent}>
        <ProfileSelector closeDrawer={closeDrawer} />
        <TouchableOpacity style={styles.profileTouchable} onPress={handlePress}>
          {nostrKeys?.pubkey && (
            <VStack align="center" spacing={16}>
              <Avatar seed={nostrKeys?.pubkey} picture={picture} name={displayName} size={64} />
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
      if (route === '(drawer)/(tabs)' || route === '(drawer)/(tabs)/index') {
        return (
          pathname === '/' ||
          pathname === '/index' ||
          pathname === '/(drawer)/(tabs)' ||
          pathname === '/(drawer)/(tabs)/' ||
          pathname.includes('(tabs)/index') ||
          (pathname.includes('(tabs)') &&
            !pathname.includes('explore') &&
            !pathname.includes('feed') &&
            !pathname.includes('contacts'))
        );
      }
      if (route.includes('(tabs)/feed') && pathname.includes('feed')) {
        return true;
      }
      if (route.includes('(tabs)/contacts') && pathname.includes('contacts')) {
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
