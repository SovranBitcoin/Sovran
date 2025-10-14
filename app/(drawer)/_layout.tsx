import React from 'react';
import { Dimensions, View, Pressable, ScrollView } from 'react-native';
import { Drawer } from 'expo-router/drawer';
import { nip19 } from 'nostr-tools';
import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { Spacer, VStack, HStack } from 'components/ui/View';
import { router } from 'expo-router';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { adjectives, nouns, uniqueUsernameGenerator } from 'unique-username-generator';

import { Avatar } from '@/components/ui/Avatar';

// Main compnent function

const screenWidth = Dimensions.get('screen').width;

function ProfileHeader() {
  const { keys: nostrKeys } = useNostrKeysContext();
  const { getPrimaryColor } = useTheme();

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
      className="flex-1 p-4"
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}>
      <View className="flex-1 bg-transparent p-4 pt-0">
        <TouchableOpacity
          className="items-center"
          onPress={() => {
            if (nostrKeys?.pubkey) {
              router.push({
                pathname: 'share',
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
                <Text weight="bold" size={20} className="text-center text-primary-0">
                  {uniqueUsernameGenerator({
                    seed: nostrKeys?.pubkey,
                    separator: '-',
                    dictionaries: [adjectives, nouns],
                  })}
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
    <Pressable onPress={onPress} className="p-8 pb-8 pt-0">
      <HStack align="center" spacing={12}>
        <Icon name={icon} color={getPrimaryColor('0')} />
        <Text size={18} weight="bold" className="text-primary-0">
          {label}
        </Text>
      </HStack>
    </Pressable>
  );
}

function SovranDrawer() {
  return (
    <ScrollView showsVerticalScrollIndicator={false} className="bg-primary-900">
      <Spacer size={64} />
      <ProfileHeader />
      <VStack spacing={0} style={{ marginTop: -16 }}>
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
      <Spacer size={48} />
    </ScrollView>
  );
}

const WrappedSovranDrawer = withSheetProvider(SovranDrawer);

export default function DrawerLayout() {
  const { keys: nostrKeys } = useNostrKeysContext();

  return (
    <Drawer
      screenOptions={{
        swipeEdgeWidth: screenWidth * 0.15,
        swipeMinDistance: 25,
        drawerStyle: {
          width: nostrKeys?.pubkey ? Math.max(screenWidth - 50, screenWidth * 0.9) : 0,
        },
        keyboardDismissMode: 'none',
      }}
      drawerContent={() => {
        return <WrappedSovranDrawer />;
      }}>
      <Drawer.Screen name="(tabs)" options={{ headerShown: false }} />
    </Drawer>
  );
}
