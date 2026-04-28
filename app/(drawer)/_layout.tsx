import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Drawer } from 'expo-router/drawer';
import {
  GestureHandlerRootView,
  Pressable as GesturePressable,
} from 'react-native-gesture-handler';
import { StyleSheet, ScrollView, Dimensions } from 'react-native';
import { router, usePathname } from 'expo-router';
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
import {
  keyImportFailedPopup,
  profileSwitcherPopup,
  walletStillLoadingPopup,
  type ProfileSwitcherAction,
} from '@/shared/lib/popup';
import { storeImportedNsec } from '@/shared/lib/nostr/secureStorage';

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
                state={profile.cachedPicture ? 'image' : 'fallback'}
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
  const foreground = useThemeColor('foreground');
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
    <View style={[styles.gradientContainer, { paddingTop: isOffline ? 0 : insets.top }]}>
      <View style={styles.headerContent}>
        <ProfileSelector closeDrawer={closeDrawer} />
        <TouchableOpacity style={styles.profileTouchable} onPress={handlePress}>
          {nostrKeys?.pubkey && (
            <VStack align="center" spacing={16}>
              <Avatar
                state={picture ? 'image' : 'fallback'}
                seed={nostrKeys?.pubkey}
                picture={picture}
                name={displayName}
                size={64}
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
    </View>
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
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);

  return (
    <GesturePressable
      disabled={isActive}
      onPress={onPress}
      style={({ pressed }) => [styles.menuButton, pressed && { opacity: 0.6 }]}>
      <HStack align="center" spacing={12} style={styles.menuButtonContent}>
        <Icon name={icon} color={isActive ? foreground : opacity(foreground, 0.5)} size={24} />
        <Text size={18} bold style={{ color: isActive ? foreground : opacity(foreground, 0.5) }}>
          {label}
        </Text>
      </HStack>
    </GesturePressable>
  );
}

function CustomDrawerContent(props: DrawerContentComponentProps) {
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
  isRouteActive: (route: string) => boolean;
  handleNavigation: (route: string) => void;
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
              <ProfileHeader closeDrawer={closeDrawer} />
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
  return (
    <GestureHandlerRootView style={styles.container}>
      <Drawer
        screenOptions={{
          headerShown: false,
          drawerType: 'slide',
          drawerStyle: {
            width: DRAWER_WIDTH,
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
  menuButtonContent: {
    // intentionally empty — kept for the HStack wrapper
  },
  scrollContent: {
    flexGrow: 1,
  },
});
