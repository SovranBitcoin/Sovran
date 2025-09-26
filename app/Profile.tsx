import React from 'react';
import { nip19 } from 'nostr-tools';
import { View, Pressable, ScrollView } from 'react-native';
import Icon from 'assets/icons';
import { useNostr } from 'helper/redux/nostr';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { Text } from 'components/common/Text';
import { LinearGradient } from 'expo-linear-gradient';
import opacity from 'hex-color-opacity';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import CachedImage from 'components/common/Image';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation } from 'helper/navigation';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { Spacer } from 'components/common/View';

function ProfileHeader() {
  const { currentProfile } = useNostr();
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();

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
              navigation.navigate('profileShare', {
                npub: currentProfile?.npub || nip19.npubEncode(currentProfile?.pubkey),
              });
            } else {
              navigation.navigate('onboard');
            }
          }}>
          {currentProfile?.pubkey && (
            <>
              <CachedImage
                source={{ uri: currentProfile.picture }}
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  marginBottom: 16,
                  backgroundColor: greys(theme)[0],
                }}
              />
              <Text
                weight="bold"
                size={20}
                className="mb-2 mt-4 text-center"
                style={{ color: greys(theme)[0] }}>
                {currentProfile?.profile?.name}
              </Text>
              <Icon size={42} name="stash:qr-code" color={greys(theme)[0]} />
            </>
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
    <Pressable onPress={onPress} className="flex-row items-center justify-start p-8 pb-8 pt-0">
      <Icon name={icon} color={greys(theme)[0]} />
      <Text size={18} weight="bold" className="ml-3" style={{ color: greys(theme)[0] }}>
        {label}
      </Text>
    </Pressable>
  );
}

const Screen = () => {
  const theme = useSelector(memoizedGetTheme);

  const navigation = useTypedNavigation();

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
        <View className="-mt-4 pb-12">
          <ProfileButton
            icon="fluent:wallet-20-filled"
            label="Wallet"
            onPress={() => {
              navigation.navigate('index', {}, { current: 'drawer' });
            }}
          />
          <ProfileButton
            icon="fluent:arrow-swap-16-filled"
            label="Payments"
            onPress={() => {
              navigation.navigate('payments', {}, { current: 'drawer' });
            }}
          />
          <ProfileButton
            icon="clarity:internet-of-things-solid"
            label="Lifestyle"
            onPress={() => {
              navigation.navigate('lifestyle', {}, { current: 'drawer' });
            }}
          />
          <ProfileButton
            icon="material-symbols:settings-rounded"
            label="Settings"
            onPress={() => {
              navigation.navigate('settings', {}, { current: 'drawer' });
            }}
          />
        </View>
      </ScrollView>
    </>
  );
};

export default withSheetProvider(Screen);
