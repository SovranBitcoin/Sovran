import React, { useRef, useCallback } from 'react';
import { ScrollView, Linking, Alert, Switch } from 'react-native';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import { Avatar } from 'components/ui/Avatar';
import { useSettingsStore } from 'stores/settingsStore';

import { ActionSheetProvider, connectActionSheet } from '@expo/react-native-action-sheet';
import { Link } from 'expo-router';
import { truncateMiddle } from 'helper/strings';
import Container from 'components/blocks/Container';
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
import { CocoManager } from 'helper/coco/manager';
import { popup } from '@/helper/popup';
import opacity from 'hex-color-opacity';

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
          color: isDanger ? getRedColor('300') : opacity(getPrimaryColor('0'), 0.5),
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
                  color: opacity(getPrimaryColor('0'), 0.4),
                }}>
                {truncateMiddle(nostrKeys?.npub || '', 8)}
              </Text>
            </VStack>
          </HStack>
          <Icon
            name="fa6-solid:chevron-right"
            color={opacity(getPrimaryColor('0'), 0.4)}
            size={22}
          />
        </View>
      </TouchableOpacity>
    </Link>
  );
};

export const ROW_ICON_SIZE = 20;

export const RowButton: React.FC<{
  label: string;
  value?: string;
  onPress?: () => void;
  href?: string;
  isFirst?: boolean;
  isLast?: boolean;
  isDanger?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}> = ({ label, value, onPress, href, isFirst, isLast, isDanger, leftIcon, rightIcon }) => {
  const { getPrimaryColor, getRedColor } = useTheme();

  const content = (
    <View
      className={`p-3 ${isFirst ? 'rounded-t-xl' : ''} ${isLast ? 'rounded-b-xl' : ''} bg-transparent`}
      style={{
        backgroundColor: getPrimaryColor('800'),
        borderColor: getPrimaryColor('700'),
        borderTopWidth: !isFirst ? 1 : 0,
      }}>
      <HStack align="center" gap={8} style={{ paddingRight: 4 }}>
        {leftIcon}
        <Text
          className="tracking-tight"
          size={ROW_ICON_SIZE - 5}
          bold
          style={{
            flex: 1,
            color: isDanger ? getRedColor('300') : getPrimaryColor('0'),
            includeFontPadding: false,
            lineHeight: ROW_ICON_SIZE - 4,
          }}>
          {label}
        </Text>
        {value && (
          <Text
            className="tracking-tight"
            overpass
            bold
            size={ROW_ICON_SIZE}
            style={{
              color: isDanger ? getRedColor('300') : opacity(getPrimaryColor('0'), 0.4),
              includeFontPadding: false,
              lineHeight: ROW_ICON_SIZE,
            }}>
            {value}
          </Text>
        )}
        {onPress || href ? (
          (rightIcon ?? (
            <Icon
              name="fa6-solid:chevron-right"
              color={isDanger ? getRedColor('300') : opacity(getPrimaryColor('0'), 0.4)}
              size={ROW_ICON_SIZE}
            />
          ))
        ) : (
          <Spacer size={4} />
        )}
      </HStack>
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

const TRIPLE_TAP_WINDOW_MS = 1500;

const ModalScreen = () => {
  const { getPrimaryColor, getShadeColor } = useTheme();
  const sendLocationEnabled = useSettingsStore((state) => state.sendLocationEnabled);
  const setSendLocationEnabled = useSettingsStore((state) => state.setSendLocationEnabled);
  const devMode = useSettingsStore((state) => state.experimental);
  const setDevMode = useSettingsStore((state) => state.setExperimental);
  const mockMode = useSettingsStore((state) => state.mockMode);
  const setMockMode = useSettingsStore((state) => state.setMockMode);
  const mockOffline = useSettingsStore((state) => state.mockOffline);
  const setMockOffline = useSettingsStore((state) => state.setMockOffline);

  const tapCountRef = useRef(0);
  const lastTapRef = useRef(0);

  const handleVersionPress = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current > TRIPLE_TAP_WINDOW_MS) {
      tapCountRef.current = 0;
    }
    tapCountRef.current += 1;
    lastTapRef.current = now;

    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      setDevMode(!devMode);
      popup({
        message: devMode ? 'Developer mode disabled' : 'Developer mode enabled',
        type: 'success',
      });
    }
  }, [devMode, setDevMode]);

  const handleExportDatabase = async () => {
    try {
      await CocoManager.exportDatabase();
    } catch (error) {
      Alert.alert('Export Failed', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const handleFreeReservedProofs = () => {
    Alert.alert(
      'Free Reserved Proofs',
      'This will attempt to rollback any operations holding reserved proofs, and release orphaned reservations. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await CocoManager.freeAllReservedProofs();

              console.log(result);
              popup({
                message: 'Reserved proofs freed',
                type: 'success',
                text:
                  `Reserved proofs found: ${result.totalReservedProofs}\n` +
                  `Rolled back send ops: ${result.rolledBackSendOperations}\n` +
                  `Rolled back melt ops: ${result.rolledBackMeltOperations}\n` +
                  `Orphaned reservations released: ${result.releasedOrphanedReservations}\n` +
                  `Errors: ${result.errors.length}`,
              });
            } catch (error) {
              popup({
                message: 'Failed to free reserved proofs',
                type: 'error',
                text: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          },
        },
      ]
    );
  };

  return (
    <Container>
      <ScrollView className="px-4">
        <Section title="Account">
          <ProfileButton />
        </Section>
        <Section title="Preferences">
          <RowButton label="Theme" href="/settings-pages/theme" isFirst />
          <RowButton label="Swap Routing" href="/settings-pages/routing" isLast />
        </Section>
        <Section title="App Information">
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
          {/* <RowButton label="Passcode" href="/settings-pages/passcode" isFirst /> */}
          <RowButton label="P2PK Keys" href="/settings-pages/keyring" isLast />
        </Section>

        <Section title="Privacy">
          <View
            style={{
              backgroundColor: getPrimaryColor('900'),
              borderRadius: 12,
              padding: 16,
            }}>
            <HStack align="center" justify="space-between">
              <VStack flex={1} style={{ marginRight: 12 }}>
                <Text size={16} style={{ color: getPrimaryColor('0') }}>
                  Location Stamps
                </Text>
                <Text
                  size={13}
                  style={{
                    color: opacity(getPrimaryColor('0'), 0.4),
                    marginTop: 4,
                  }}>
                  Attach your approximate location when making transactions. (metadata only stored
                  on your device)
                </Text>
              </VStack>
              <Switch
                value={sendLocationEnabled ?? false}
                onValueChange={setSendLocationEnabled}
                trackColor={{
                  false: getPrimaryColor('700'),
                  true: getShadeColor('300'),
                }}
                thumbColor={getPrimaryColor('0')}
              />
            </HStack>
          </View>
        </Section>

        {devMode ? (
          <Section title="Recovery">
            <RowButton label="Recover Wallet" href="/settings-pages/recovery" isFirst isLast />
          </Section>
        ) : null}

        {devMode ? (
          <Section title="Developer">
            <RowButton label="Export Database" onPress={handleExportDatabase} isFirst />
            <RowButton label="Free Reserved Proofs" onPress={handleFreeReservedProofs} />
            <RowButton label="Storage Inspector" href="/settings-pages/storage" />
            <View
              style={{
                backgroundColor: getPrimaryColor('800'),
                borderColor: getPrimaryColor('700'),
                borderTopWidth: 1,
                padding: 12,
              }}>
              <HStack align="center" justify="space-between">
                <Text size={16} style={{ color: getPrimaryColor('0') }}>
                  Mock Mode
                </Text>
                <Switch
                  value={mockMode}
                  onValueChange={setMockMode}
                  trackColor={{
                    false: getPrimaryColor('700'),
                    true: getShadeColor('300'),
                  }}
                  thumbColor={getPrimaryColor('0')}
                />
              </HStack>
            </View>
            <View
              style={{
                backgroundColor: getPrimaryColor('800'),
                borderColor: getPrimaryColor('700'),
                borderTopWidth: 1,
                borderBottomLeftRadius: 12,
                borderBottomRightRadius: 12,
                padding: 12,
              }}>
              <HStack align="center" justify="space-between">
                <Text size={16} style={{ color: getPrimaryColor('0') }}>
                  Mock Offline
                </Text>
                <Switch
                  value={mockOffline}
                  onValueChange={setMockOffline}
                  trackColor={{
                    false: getPrimaryColor('700'),
                    true: getShadeColor('300'),
                  }}
                  thumbColor={getPrimaryColor('0')}
                />
              </HStack>
            </View>
          </Section>
        ) : null}

        <Section title="Danger Zone" isDanger>
          <RowButton label="Delete Account" href="/settings-pages/delete" isFirst isLast isDanger />
        </Section>

        <TouchableOpacity onPress={handleVersionPress}>
          <VStack spacing={4}>
            <Text
              className="text-center"
              overpass
              bold
              size={13}
              style={{
                color: opacity(getPrimaryColor('0'), 0.5),
              }}>
              {name}
            </Text>
            <Text
              className="text-center"
              size={13}
              overpass
              medium
              style={{
                color: opacity(getPrimaryColor('0'), 0.5),
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
