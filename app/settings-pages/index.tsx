import React from 'react';
import { ScrollView, Linking } from 'react-native';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import { Avatar } from 'components/ui/Avatar';

import { ActionSheetProvider, connectActionSheet } from '@expo/react-native-action-sheet';
import { Link } from 'expo-router';
import { truncateMiddle } from 'helper/strings';
import Container from 'components/blocks/Container';
import { SheetManager } from 'react-native-actions-sheet';
import * as Application from 'expo-application';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import Icon from 'assets/icons';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { getUsername } from '@/helper/username';

export const name = Application.applicationName;
export const version = Application.nativeApplicationVersion;
export const buildNumber = Application.nativeBuildVersion;

export const Section: React.FC<{
  title: string;
  children: React.ReactNode;
  isDanger?: boolean;
}> = ({ title, children, isDanger }) => {
  const { getPrimaryColor, getRedColor } = useTheme();

  return (
    <View className="py-3">
      <Text
        className={`my-2 ml-3 uppercase tracking-wide ${isDanger ? '' : ''}`}
        size={13}
        medium
        overpass
        style={{
          color: isDanger ? getRedColor('300') : getPrimaryColor('300'),
        }}>
        {title}
      </Text>
      <View className="overflow-hidden rounded-xl">{children}</View>
    </View>
  );
};

const ProfileButton = () => {
  const { keys: nostrKeys } = useNostrKeysContext();
  const { getPrimaryColor } = useTheme();

  return (
    <Link href="/settings-pages/profile" asChild>
      <TouchableOpacity>
        <View
          className="flex-row items-center justify-start bg-transparent p-3"
          style={{
            backgroundColor: getPrimaryColor('900'),
          }}>
          <HStack spacing={12} flex={1}>
            <Avatar seed={nostrKeys?.pubkey} variant="person" size={60} />
            <VStack spacing={2} flex={1}>
              <Text
                size={18}
                bold
                overpass
                style={{
                  color: getPrimaryColor('0'),
                }}>
                {getUsername(nostrKeys?.pubkey || '')}
              </Text>
              <Text
                size={16}
                style={{
                  color: getPrimaryColor('400'),
                }}>
                {truncateMiddle(nostrKeys?.npub || '', 8)}
              </Text>
            </VStack>
          </HStack>
          <Icon name="fa6-solid:chevron-right" color={getPrimaryColor('400')} size={22} />
        </View>
      </TouchableOpacity>
    </Link>
  );
};

export const RowButton: React.FC<{
  label: string | React.ReactElement;
  value?: string;
  onPress?: () => void;
  href?: string;
  isFirst?: boolean;
  isLast?: boolean;
  isDanger?: boolean;
  rightIcon?: React.ReactNode;
}> = ({ label, value, onPress, href, isFirst, isLast, isDanger, rightIcon }) => {
  const { getPrimaryColor, getRedColor } = useTheme();

  const content = (
    <View
      className={`p-3 ${isFirst ? 'rounded-t-xl' : ''} ${isLast ? 'rounded-b-xl' : ''} bg-transparent`}
      style={{
        backgroundColor: getPrimaryColor('900'),
        borderColor: getPrimaryColor('700'),
        borderTopWidth: !isFirst ? 1 : 0,
      }}>
      <View className="w-full flex-row items-center justify-start pr-1">
        <Text
          className="tracking-tight"
          size={16}
          style={{
            color: isDanger ? getRedColor('300') : getPrimaryColor('0'),
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
              color: isDanger ? getRedColor('300') : getPrimaryColor('400'),
            }}>
            {value}
          </Text>
        )}
        {onPress || href ? (
          (rightIcon ?? (
            <Icon
              name="fa6-solid:chevron-right"
              color={isDanger ? getRedColor('300') : getPrimaryColor('400')}
              size={19}
            />
          ))
        ) : (
          <Spacer size={4} />
        )}
      </View>
    </View>
  );

  if (href) {
    return (
      <Link href={href as any} asChild>
        <TouchableOpacity>{content}</TouchableOpacity>
      </Link>
    );
  }

  return (
    <TouchableOpacity onPress={onPress} disabled={!onPress}>
      {content}
    </TouchableOpacity>
  );
};

const ModalScreen = () => {
  const { getPrimaryColor } = useTheme();

  return (
    <Container>
      <ScrollView className="px-4">
        <Section title="Account">
          <ProfileButton />
        </Section>
        <Section title="Preferences">
          <RowButton label="Theme" href="/settings-pages/theme" />
        </Section>
        <Section title="App Information">
          <RowButton isFirst label="About This Release" href="/settings-pages/about" />
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
          <RowButton label="Passcode" href="/settings-pages/passcode" isFirst />
          <RowButton label="P2PK Keys" href="/settings-pages/keyring" isLast />
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

        <Link href="/settings-pages/design" asChild>
          <TouchableOpacity>
            <VStack spacing={4}>
              <Text
                className="text-center"
                overpass
                bold
                size={13}
                style={{
                  color: getPrimaryColor('300'),
                }}>
                {name}
              </Text>
              <Text
                className="text-center"
                size={13}
                overpass
                medium
                style={{
                  color: getPrimaryColor('300'),
                }}>
                App Version {version} ({buildNumber})
              </Text>
            </VStack>
          </TouchableOpacity>
        </Link>
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
