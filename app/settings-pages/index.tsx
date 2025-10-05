import React from 'react';
import { TouchableOpacity, Image, ScrollView, Linking } from 'react-native';
import { Text } from 'components/ui/Text';
import { useSelector } from 'react-redux';
import { memoizedGetSettings, memoizedGetTheme } from 'helper/redux/settings';

import { greys, reds, Theme } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import {
  ActionSheetProvider,
  connectActionSheet,
  useActionSheet,
} from '@expo/react-native-action-sheet';
import { router } from 'expo-router';
import { truncateMiddle } from 'helper/strings';
import Container from 'components/blocks/Container';
import { SheetManager } from 'react-native-actions-sheet';
import * as Application from 'expo-application';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { device } from 'helper/version';
import Icon from 'assets/icons';

export const name = Application.applicationName;
export const version = Application.nativeApplicationVersion;
export const buildNumber = Application.nativeBuildVersion;

export const Section: React.FC<{
  title: string;
  children: React.ReactNode;
  isDanger?: boolean;
}> = ({ title, children, isDanger }) => {
  const theme = useSelector(memoizedGetTheme);
  return (
    <View className="py-3">
      <Text
        className={`my-2 ml-3 uppercase tracking-wide ${isDanger ? '' : ''}`}
        size={13}
        medium
        overpass
        style={{
          color: isDanger ? reds[300] : greys(theme)[300],
        }}>
        {title}
      </Text>
      <View className="overflow-hidden rounded-xl">{children}</View>
    </View>
  );
};

const ProfileButton = ({ currentProfile, theme }: { currentProfile: any; theme: Theme }) => {
  return (
    <TouchableOpacity
      onPress={() => {
        router.push('/settings-pages/profile');
      }}>
      <View
        blur
        className="flex-row items-center justify-start bg-transparent p-3"
        style={{
          backgroundColor: greys(theme)[800],
        }}>
        <HStack spacing={12} flex={1}>
          <Image
            alt=""
            source={{
              uri: currentProfile?.picture,
            }}
            className="h-[60px] w-[60px] rounded-full"
          />
          <VStack spacing={2} flex={1}>
            <Text
              size={18}
              bold
              overpass
              style={{
                color: greys(theme)[0],
              }}>
              {currentProfile?.profile?.name}
            </Text>
            <Text
              size={16}
              style={{
                color: greys(theme)[400],
              }}>
              {truncateMiddle(currentProfile?.npub, 8)}
            </Text>
          </VStack>
        </HStack>
        <Icon name="fa6-solid:chevron-right" color={greys(theme)[400]} size={22} />
      </View>
    </TouchableOpacity>
  );
};

export const RowButton: React.FC<{
  label: string | React.ReactElement;
  value?: string;
  onPress?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  isDanger?: boolean;
  rightIcon?: React.ReactNode;
}> = ({ label, value, onPress, isFirst, isLast, isDanger, rightIcon }) => {
  const theme = useSelector(memoizedGetTheme);
  return (
    <View
      blur
      className={`p-3 ${isFirst ? 'rounded-t-xl' : ''} ${isLast ? 'rounded-b-xl' : ''} bg-transparent`}
      style={{
        backgroundColor: greys(theme)[800],
        borderColor: greys(theme)[700],
        borderTopWidth: !isFirst ? 1 : 0,
      }}>
      <TouchableOpacity
        onPress={onPress}
        disabled={!onPress}
        className="w-full flex-row items-center justify-start pr-1">
        <Text
          className="tracking-tight"
          size={16}
          style={{
            color: isDanger ? reds[300] : greys(theme)[0],
          }}>
          {label}
        </Text>
        <View className="flex-1" />
        {value && (
          <Text
            className="tracking-tight"
            overpass
            bold
            size={16}
            style={{
              color: isDanger ? reds[300] : greys(theme)[400],
            }}>
            {value}
          </Text>
        )}
        {onPress ? (
          (rightIcon ?? (
            <Icon
              name="fa6-solid:chevron-right"
              color={isDanger ? reds[300] : greys(theme)[400]}
              size={19}
            />
          ))
        ) : (
          <Spacer size={4} />
        )}
      </TouchableOpacity>
    </View>
  );
};

const ModalScreen = () => {
  const theme = useSelector(memoizedGetTheme);
  const { currentProfile } = useNostr();

  const { showActionSheetWithOptions } = useActionSheet();

  const handleBTCFormatPress = () => {
    const options = ['Bitcoin (BTC)', 'Satoshi (short-Sats)', 'Satoshis (Sats)', 'Cancel'];
    const cancelButtonIndex = 3;

    showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex,
      },
      (buttonIndex) => {
        if (buttonIndex !== cancelButtonIndex) {
        }
      }
    );
  };

  const handleFiatCurrencyPress = () => {
    const options = ['USD', 'EUR', 'GBP', 'Cancel'];
    const cancelButtonIndex = 3;

    showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex,
      },
      (buttonIndex) => {
        if (buttonIndex !== cancelButtonIndex) {
        }
      }
    );
  };

  const settings = useSelector(memoizedGetSettings);

  return (
    <Container>
      <ScrollView>
        <Section title="Account">
          <ProfileButton currentProfile={currentProfile} theme={theme} />
        </Section>
        <Section title="Preferences">
          <RowButton isFirst label="Bitcoin Display Format" onPress={handleBTCFormatPress} />
          <RowButton label="Preferred Fiat Currency" onPress={handleFiatCurrencyPress} />
          <RowButton
            label="Theme"
            onPress={() => {
              router.push('/settings-pages/theme');
            }}
          />
          {device.platform('ios').gte(10) && (
            <RowButton
              label="Background Image"
              onPress={() => {
                router.push('/settings-pages/backgroundImages');
              }}
            />
          )}
        </Section>
        <Section title="App Information">
          <RowButton
            isFirst
            label="About This Release"
            onPress={() => {
              router.push('/settings-pages/about');
            }}
          />
          <RowButton
            label="View Source on GitHub"
            onPress={() => {
              Linking.openURL('https://github.com/SovranBitcoin/Sovran');
            }}
          />
          <RowButton
            label="Contact the Developer"
            onPress={() => {
              Linking.openURL('https://x.com/KevinKelbie');
            }}
          />
        </Section>
        <Section title="Security">
          <RowButton
            label="Passcode"
            onPress={() => {
              router.push('/settings-pages/passcode');
            }}
            isFirst
          />
        </Section>
        <Section title="Danger Zone" isDanger>
          <RowButton
            label="Delete Account"
            onPress={() => {
              SheetManager.show('delete-router');
            }}
            isLast
            isDanger
          />
        </Section>
        {settings?.experimental && (
          <>
            <Section title="Advanced Debugging">
              <RowButton
                label="Restore Counter"
                onPress={() => {
                  router.push('/settings-pages/restoreCounter');
                }}
              />
              <RowButton
                label="Websocket Connections"
                onPress={() => {
                  router.push('/settings-pages/websocketConnections');
                }}
              />
              <RowButton
                label="Check Proofs"
                onPress={() => {
                  router.push('/settings-pages/proofs');
                }}
              />
            </Section>
          </>
        )}

        <TouchableOpacity
          onPress={() => {
            router.push('/settings-pages/design');
          }}>
          <VStack spacing={4}>
            <Text
              className="text-center"
              overpass
              bold
              size={13}
              style={{
                color: greys(theme)[300],
              }}>
              {name}
            </Text>
            <Text
              className="text-center"
              size={13}
              overpass
              medium
              style={{
                color: greys(theme)[300],
              }}>
              App Version {version} ({buildNumber})
            </Text>
          </VStack>
        </TouchableOpacity>
      </ScrollView>
    </Container>
  );
};

const ConnectedModalScreen = connectActionSheet(ModalScreen);

const App = () => (
  <ActionSheetProvider>
    <ConnectedModalScreen />
  </ActionSheetProvider>
);

export default withSheetProvider(App);
