import React from 'react';
import { Dimensions, View, Pressable, ScrollView } from 'react-native';
import { Drawer } from 'expo-router/drawer';
import { nip19 } from 'nostr-tools';
import Icon from 'assets/icons';
import { useNostr } from 'helper/redux/nostr';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { Text } from 'components/ui/Text';
import { LinearGradient } from 'expo-linear-gradient';
// migrate to using polished for opacity
import opacity from 'hex-color-opacity';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import CachedImage from 'components/ui/Image';
import { memoizedGetTheme } from 'helper/redux/settings';
import { memoizedGetSelectedMint } from 'helper/redux/cashu/selectors';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { Spacer, VStack, HStack } from 'components/ui/View';
import { router } from 'expo-router';

const screenWidth = Dimensions.get('screen').width;

function ProfileHeader() {
  const { currentProfile } = useNostr();
  const theme = useSelector(memoizedGetTheme);

  return (
    <LinearGradient
      colors={[
        greys(theme)[900],
        greys(theme)[900],
        greys(theme)[900],
        greys(theme)[900],
        greys(theme)[900],
        greys(theme)[900],
        opacity(greys(theme)[900], 0),
      ]}
      className="flex-1 p-4"
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}>
      <View className="flex-1 bg-transparent p-4 pt-0" style={{ paddingBottom: 58 }}>
        <TouchableOpacity
          className="items-center"
          onPress={() => {
            if (currentProfile?.pubkey) {
              router.push({
                pathname: 'profileShare',
                params: {
                  npub: currentProfile?.npub || nip19.npubEncode(currentProfile?.pubkey),
                },
              });
            } else {
              router.push('/onboard');
            }
          }}>
          {currentProfile?.pubkey && (
            <VStack align="center" spacing={16}>
              <CachedImage
                source={{ uri: currentProfile.picture }}
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: greys(theme)[0],
                }}
              />
              <VStack align="center" spacing={8}>
                <Text
                  weight="bold"
                  size={20}
                  className="text-center"
                  style={{ color: greys(theme)[0] }}>
                  {currentProfile?.profile?.name}
                </Text>
                <Icon size={42} name="stash:qr-code" color={greys(theme)[0]} />
              </VStack>
            </VStack>
          )}
        </TouchableOpacity>
      </View>
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
  const theme = useSelector(memoizedGetTheme);

  return (
    <Pressable onPress={onPress} className="p-8 pb-8 pt-0">
      <HStack align="center" spacing={12}>
        <Icon name={icon} color={greys(theme)[0]} />
        <Text size={18} weight="bold" style={{ color: greys(theme)[0] }}>
          {label}
        </Text>
      </HStack>
    </Pressable>
  );
}

function SovranDrawer() {
  const theme = useSelector(memoizedGetTheme);

  return (
    <>
      <ScrollView
        stickyHeaderIndices={[0]}
        showsVerticalScrollIndicator={false}
        style={{
          backgroundColor: greys(theme)[900],
        }}>
        <Spacer size={64} />
        <ProfileHeader />
        <VStack spacing={0} style={{ marginTop: -16, paddingBottom: 48 }}>
          <ProfileButton
            icon="fluent:wallet-20-filled"
            label="Wallet"
            onPress={() => {
              router.push('/(drawer)/(tabs)');
            }}
          />
          <ProfileButton
            icon="fluent:arrow-swap-16-filled"
            label="Payments"
            onPress={() => {
              router.push('/(drawer)/(tabs)/payments');
            }}
          />
          <ProfileButton
            icon="clarity:internet-of-things-solid"
            label="Lifestyle"
            onPress={() => {
              router.push('/(drawer)/(tabs)/lifestyle');
            }}
          />
          <ProfileButton
            icon="material-symbols:settings-rounded"
            label="Settings"
            onPress={() => {
              router.push('/settings-pages');
            }}
          />
        </VStack>
      </ScrollView>
    </>
  );
}

export default function DrawerLayout() {
  const { currentProfile } = useNostr();
  const selectedMint = useSelector(memoizedGetSelectedMint);
  return (
    <Drawer
      screenOptions={{
        swipeEnabled: currentProfile?.pubkey && selectedMint ? true : false,
        headerShown: false,
        drawerType: 'slide',
        swipeEdgeWidth: screenWidth * 0.15,
        swipeMinDistance: 25,
        drawerPosition: 'left',
        drawerStyle: {
          backgroundColor: 'transparent',
          width:
            currentProfile?.pubkey && selectedMint
              ? Math.max(screenWidth - 50, screenWidth * 0.9)
              : 0,
          paddingRight: 0,
        },
        keyboardDismissMode: 'none',
        drawerContentContainerStyle: {
          flexGrow: 1,
        },
      }}
      drawerContent={() => {
        if (!(currentProfile?.pubkey && selectedMint)) return <></>;
        const WrappedSovranDrawer = withSheetProvider(SovranDrawer);
        return <WrappedSovranDrawer />;
      }}>
      <Drawer.Screen name="(tabs)" options={{ headerShown: false }} />
    </Drawer>
  );
}
