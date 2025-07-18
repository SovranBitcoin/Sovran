import React from 'react';
import { StyleSheet, TouchableOpacity, Image, ScrollView, Linking } from 'react-native';
import { Text } from 'components/common/Text';
import { useSelector } from 'react-redux';
import { memoizedGetSettings, memoizedGetTheme } from 'helper/redux/settings';
import FeatherIcon from '@expo/vector-icons/Feather';

import { greys, reds, Theme } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import {
  ActionSheetProvider,
  connectActionSheet,
  useActionSheet,
} from '@expo/react-native-action-sheet';
import { useTypedNavigation } from 'helper/navigation';
import { truncateMiddle } from 'helper/strings';
import Container from 'components/layout/Container';
import { SheetManager } from 'react-native-actions-sheet';
import * as Application from 'expo-application';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { View } from 'components/common/View';

export const name = Application.applicationName;
export const version = Application.nativeApplicationVersion;
export const buildNumber = Application.nativeBuildVersion;

export const Section: React.FC<{
  title: string;
  children: React.ReactNode;
  isDanger?: boolean;
}> = ({ title, children, isDanger }) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme, isDanger);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
};

const ProfileButton = ({ currentProfile, theme }: { currentProfile: any; theme: Theme }) => {
  const styles = createStyles(theme);
  const navigation = useTypedNavigation();

  return (
    <TouchableOpacity
      onPress={() => {
        navigation.navigate('settings/profile');
      }}>
      <View blur style={styles.profile}>
        <Image
          alt=""
          source={{
            uri: currentProfile?.picture,
          }}
          style={styles.profileAvatar}
        />
        <View style={styles.profileBody}>
          <Text style={styles.profileName}>{currentProfile?.profile?.name}</Text>
          <Text style={styles.profileHandle}>{truncateMiddle(currentProfile?.npub, 8)}</Text>
        </View>
        <FeatherIcon color={greys(theme)[400]} name="chevron-right" size={22} />
      </View>
    </TouchableOpacity>
  );
};

export const RowButton: React.FC<{
  label: string | React.ReactElement;
  value?: string;
  onPress: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  isDanger?: boolean;
  rightIcon?: React.ReactNode;
}> = ({ label, value, onPress, isFirst, isLast, isDanger, rightIcon }) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme, isDanger);
  return (
    <View
      blur
      style={[
        styles.rowWrapper,
        {
          borderTopWidth: !isFirst ? 1 : 0,
        },
      ]}>
      <TouchableOpacity
        onPress={onPress}
        style={[styles.row, isFirst && styles.rowFirst, isLast && styles.rowLast]}>
        <Text style={[styles.rowLabel, isDanger && styles.rowLabelDanger]}>{label}</Text>

        <View style={styles.rowSpacer} />
        {value && (
          <Text
            style={[
              styles.rowValue,
              {
                marginRight: 3,
                fontFamily: 'OverpassBold',
              },
              isDanger ? { color: reds[300] } : { color: greys(theme)[400] },
            ]}>
            {value}
          </Text>
        )}
        {onPress ? (
          (rightIcon ?? (
            <FeatherIcon
              style={{
                marginRight: !!onPress ? 0 : 8,
              }}
              color={isDanger ? reds[300] : greys(theme)[400]}
              name="chevron-right"
              size={19}
            />
          ))
        ) : (
          <View
            style={{
              marginRight: 2,
            }}></View>
        )}
      </TouchableOpacity>
    </View>
  );
};

const ModalScreen = () => {
  const theme = useSelector(memoizedGetTheme);
  const { currentProfile } = useNostr();
  const styles = createStyles(theme);

  const navigation = useTypedNavigation();

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
          {/* <RowButton
          label="Manage Profiles"
          onPress={() => {
            SheetManager.show('sheet-with-router');
          }}
        /> */}
        </Section>
        <Section title="Preferences">
          <RowButton isFirst label="Bitcoin Display Format" onPress={handleBTCFormatPress} />
          <RowButton label="Preferred Fiat Currency" onPress={handleFiatCurrencyPress} />
          <RowButton
            label="Theme"
            onPress={() => {
              navigation.navigate('themeSettings');
            }}
          />
          <RowButton
            label="Background Image"
            onPress={() => {
              navigation.navigate('backgroundImageSettings');
            }}
          />
          {/* <RowButton
          label="Language"
          onPress={() => {
            navigation.navigate('languageSettings', {
              countries: ['GB', 'FR', 'ES', 'DE', 'PT'],
            });
          }}
        /> */}
        </Section>
        <Section title="App Information">
          <RowButton
            isFirst
            label="About This Release"
            onPress={() => {
              navigation.navigate('settings/about');
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
            label="Show Seed Phrase"
            onPress={() => {
              navigation.navigate('settings/showSeedPhrase');
            }}
            isFirst
          />
          <RowButton
            label="Verify Seed Phrase"
            onPress={() => {
              navigation.navigate('settings/verifySeedPhrase');
            }}
          />
          <RowButton
            label="Passcode"
            onPress={() => {
              navigation.navigate('settings/passcode');
            }}
          />
        </Section>
        {/* <Section title="npubx.cash Settings">
        <View style={styles.rowWrapper}>
          <View style={[styles.row, styles.rowFirst, styles.rowLast]}>
            <Text style={styles.rowLabel}>Listen for Transactions</Text>
            <View style={styles.rowSpacer} />
            <Switch
              value={form.listenForTransactions}
              onValueChange={handleTransactionSwitch}
            />
          </View>
        </View>
        <RowButton
          label="Custom Lightning URL"
          onPress={() => {
            navigation.navigate("settings/customNpub");
          }}
        />
      </Section> */}
        {/* <Section title="Mint Settings">
        <RowButton
          label="Manage Mints"
          onPress={() => {
            SheetManager.show("mint");
          }}
        /> */}
        {/* <RowButton
          label="Mint allocation"
          onPress={() => {
            navigation.navigate("mints");
          }}
        /> */}
        {/* </Section> */}
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
              {/* <RowButton
          label="Show Local Storage"
          onPress={() => {
            navigation.navigate('settings/store');
          }}
        /> */}
              <RowButton
                label="Nostr Data"
                onPress={() => {
                  navigation.navigate('settings/nostrData');
                }}
              />
              <RowButton
                label="Restore Counter"
                onPress={() => {
                  navigation.navigate('settings/restoreCounter');
                }}
              />
              <RowButton
                label="Websocket Connections"
                onPress={() => {
                  navigation.navigate('settings/websocketConnections');
                }}
              />
              <RowButton
                label="Check Proofs"
                onPress={() => {
                  navigation.navigate('settings/proofs');
                }}
              />
            </Section>
          </>
        )}

        <TouchableOpacity
          onPress={() => {
            navigation.navigate('settings/design');
          }}>
          <Text
            style={[
              styles.contentFooter,
              {
                fontFamily: 'OverpassBold',
              },
            ]}>
            {name}
          </Text>
          <Text
            style={[
              styles.contentFooter,
              {
                marginTop: 4,
              },
            ]}>
            App Version {version} ({buildNumber})
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </Container>
  );
};

const createStyles = (theme: Theme, isDanger?: boolean) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      paddingHorizontal: 16,
    },
    headerAction: {
      width: 40,
      height: 40,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    headerTitle: {
      fontSize: 19,
      fontWeight: '600',
      color: greys(theme)[0],
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      textAlign: 'center',
    },
    content: {
      paddingHorizontal: 16,
    },
    contentFooter: {
      marginTop: 24,
      fontSize: 13,
      fontWeight: '500',
      textAlign: 'center',
      color: greys(theme)[300],
    },
    section: {
      paddingVertical: 12,
    },
    sectionTitle: {
      margin: 8,
      marginLeft: 12,
      fontSize: 13,
      letterSpacing: 0.33,
      fontWeight: '500',
      color: isDanger ? reds[300] : greys(theme)[300],
      textTransform: 'uppercase',
    },
    sectionBody: {
      borderRadius: 12,
      shadowColor: greys(theme)[500],
      shadowOffset: {
        width: 0,
        height: 1,
      },
      shadowOpacity: 0.2,
      shadowRadius: 1.41,
      elevation: 2,
      overflow: 'hidden',
    },
    profile: {
      padding: 12,
      backgroundColor: greys(theme)[800],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
    },
    profileAvatar: {
      width: 60,
      height: 60,
      borderRadius: 9999,
      marginRight: 12,
    },
    profileBody: {
      marginRight: 'auto',
    },
    profileName: {
      fontSize: 18,
      fontWeight: '600',
      color: greys(theme)[0],
    },
    profileHandle: {
      marginTop: 2,
      fontSize: 16,
      fontWeight: '400',
      color: greys(theme)[400],
    },
    row: {
      height: 44,
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingRight: 12,
    },
    rowWrapper: {
      paddingLeft: 16,
      backgroundColor: greys(theme)[800],
      borderColor: greys(theme)[700],
    },
    rowFirst: {
      borderTopLeftRadius: 12,
      borderTopRightRadius: 12,
    },
    rowLabel: {
      fontSize: 16,
      letterSpacing: 0.24,
      color: greys(theme)[0],
    },
    rowValue: {
      fontSize: 16,
      letterSpacing: 0.24,
      color: greys(theme)[0],
    },
    rowLabelDanger: {
      color: reds[300],
    },
    rowSpacer: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
    },
    rowLast: {
      borderBottomLeftRadius: 12,
      borderBottomRightRadius: 12,
    },
    rowLabelLogout: {
      width: '100%',
      textAlign: 'center',
      fontWeight: '600',
      color: reds[300],
    },
    debugContainer: {
      padding: 12,
      backgroundColor: greys(theme)[800],
      borderRadius: 8,
      marginVertical: 8,
    },
    debugText: {
      color: greys(theme)[0],
      fontSize: 14,
    },
    changeProfileButton: {
      marginTop: 8,
      paddingVertical: 4,
      paddingHorizontal: 8,
      backgroundColor: greys(theme)[700],
      borderRadius: 4,
    },
    changeProfileText: {
      color: greys(theme)[0],
      fontSize: 14,
      fontWeight: '500',
      textAlign: 'center',
    },
  });

const ConnectedModalScreen = connectActionSheet(ModalScreen);

const App = () => (
  <ActionSheetProvider>
    <ConnectedModalScreen />
  </ActionSheetProvider>
);

export default withSheetProvider(App);
