import React from 'react';
import { nip19 } from 'nostr-tools';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import Icon, { QRIcon } from 'assets/icons';
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
import { withSheetProvider } from 'components/hocs/withSheetProvider';

export const EventKind = {
  Unknown: -1,
  Metadata: 0,
  TextNote: 1,
  RecommendServer: 2,
  ContactList: 3, // NIP-02
  DirectMessage: 4, // NIP-04
  Deletion: 5, // NIP-09
  Repost: 6, // NIP-18
  Reaction: 7, // NIP-25
  BadgeAward: 8, // NIP-58
  SnortSubscriptions: 1000, // NIP-XX
  Polls: 6969, // NIP-69
  FileHeader: 1063, // NIP-94
  Relays: 10002, // NIP-65 Relay List Metadata
  Ephemeral: 20_000,
  Auth: 22242, // NIP-42
  PubkeyLists: 30000, // NIP-51a
  NoteLists: 30001, // NIP-51b
  TagLists: 30002, // NIP-51c
  Badge: 30009, // NIP-58
  ProfileBadges: 30008, // NIP-58
  ZapRequest: 9734, // NIP 57
  ZapReceipt: 9735, // NIP 57
  HttpAuthentication: 27235, // NIP XX - HTTP Authentication
} as const;

const Screen = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const { profiles, currentProfile, setCurrentProfile } = useNostr();
  const navigation = useTypedNavigation();

  function getName(profile) {
    const dn =
      profile?.profile?.displayName ||
      profile?.profile?.display_name ||
      profile?.profile?.username ||
      profile?.profile?.name ||
      '';
    return dn;
  }

  const profileIcons = profiles.slice(0).map((profile, i) => (
    <TouchableOpacity
      key={profile.pubkey}
      onPress={() => {
        setCurrentProfile({
          id: i,
          pubkey: profile.pubkey,
          ...profile,
        });
      }}
      style={styles.smallProfilePicture}>
      {profile?.picture && (
        <CachedImage
          source={{ uri: profile.picture }}
          style={{
            width: 32,
            height: 32,
          }}
        />
      )}
    </TouchableOpacity>
  ));

  // Add the camera icon at the end of the profile icons
  // check if there is a currentProfile
  // if (currentProfile?.pubkey) {
  //   profileIcons.push(
  //     <TouchableOpacity
  //       key="camera-icon"
  //       onPress={() => {
  //         navigation.navigate("onboard/welcome", {});
  //       }}
  //     >
  //       <View
  //         style={{
  //           borderRadius: 1000,
  //           padding: 8,
  //           backgroundColor: greys(theme)[1000],
  //         }}
  //       >
  //         <DotsIcon
  //           style={{
  //             width: 16,
  //             height: 16,
  //           }}
  //         />
  //       </View>
  //     </TouchableOpacity>
  //   );
  // }

  return (
    <>
      <ScrollView
        stickyHeaderIndices={[0]}
        showsVerticalScrollIndicator={false}
        style={{
          backgroundColor: greys(theme)[2100],
        }}>
        <LinearGradient
          colors={[
            greys(theme)[2100],
            greys(theme)[2100],
            greys(theme)[2100],
            greys(theme)[2100],
            greys(theme)[2100],
            greys(theme)[2100],
            opacity(greys(theme)[2100], 0),
          ]}
          style={[styles.gradientContainer]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}>
          <View
            style={{
              padding: 16,
              paddingTop: 0,
              paddingBottom: 58,
              flex: 1,
              backgroundColor: 'transparent',
            }}>
            <View
              style={{
                marginBottom: 16,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
              <View
                style={{
                  flexDirection: 'row',
                }}>
                {profileIcons}
              </View>
            </View>
            <TouchableOpacity
              style={{
                alignItems: 'center',
              }}
              onPress={() => {
                if (currentProfile?.pubkey) {
                  navigation.navigate('profileShare', {
                    npub:
                      profiles.find((profile) => profile.pubkey === currentProfile.pubkey)?.npub ||
                      nip19.npubEncode(
                        profiles.find((profile) => profile.pubkey === currentProfile.pubkey)?.pubkey
                      ),
                  });
                } else {
                  navigation.navigate('onboard');
                }
              }}>
              {currentProfile?.pubkey ? (
                <>
                  <CachedImage
                    source={{ uri: currentProfile.picture }}
                    style={styles.modalProfilePicture}
                  />
                  <Text weight="bold" size={20} style={styles.name}>
                    {getName(currentProfile)}
                  </Text>
                  <QRIcon
                    color={greys(theme)[0]}
                    style={{
                      width: 32,
                      height: 32,
                    }}
                  />
                </>
              ) : (
                <>
                  <View
                    style={{
                      borderRadius: 1000,
                      padding: 32,
                      backgroundColor: greys(theme)[2300],
                      borderColor: greys(theme)[1300],
                      borderWidth: 0.2,
                    }}>
                    <QRIcon
                      style={{
                        width: 32,
                        height: 32,
                      }}
                    />
                  </View>
                  <Text style={styles.name}>Create Account</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </LinearGradient>
        <View
          style={{
            marginTop: -16,
            paddingBottom: 48,
          }}>
          <Pressable
            onPress={() => {
              navigation.navigate('index', {}, { current: 'drawer' });
            }}
            style={styles.menuButton}>
            <Icon name="fluent:wallet-20-filled" color={greys(theme)[0]} />
            <Text size={18} weight="bold" style={styles.menuText}>
              Wallet
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              navigation.navigate('payments', {}, { current: 'drawer' });
            }}
            style={styles.menuButton}>
            <Icon name="fluent:arrow-swap-16-filled" color={greys(theme)[0]} />
            <Text size={18} weight="bold" style={styles.menuText}>
              Payments
            </Text>
          </Pressable>
          {/* <Pressable
            onPress={() => {
              navigation.navigate('myEsims', {}, { current: 'drawer' });
            }}
            style={styles.menuButton}>
            <Icon name="fluent:sim-24-filled" color={greys(theme)[0]} />
            <Text size={18} weight="bold" style={styles.menuText}>
              eSIM
            </Text>
          </Pressable> */}
          {/* <Pressable
            onPress={() => {
              navigation.navigate('myVpns', {}, { current: 'drawer' });
            }}
            style={styles.menuButton}>
            <Icon name="ic:baseline-vpn-lock" color={greys(theme)[0]} />
            <Text size={18} weight="bold" style={styles.menuText}>
              VPN
            </Text>
          </Pressable> */}
          <Pressable
            onPress={() => {
              navigation.navigate('lifestyle', {}, { current: 'drawer' });
            }}
            style={styles.menuButton}>
            <Icon
              name="clarity:internet-of-things-solid"
              color={greys(theme)[0]}
              spin={{
                duration: 2000,
                delay: 4000,
                outputRange: ['0deg', '120deg'],
              }}
            />
            <Text size={18} weight="bold" style={styles.menuText}>
              Lifestyle
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              navigation.navigate('settings', {}, { current: 'drawer' });
            }}
            style={styles.menuButton}>
            <Icon name="material-symbols:settings-rounded" color={greys(theme)[0]} />
            <Text size={18} weight="bold" style={styles.menuText}>
              Settings
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    smallProfilePicture: {
      width: 32,
      height: 32,
      borderRadius: 16,
      marginRight: 8,
      backgroundColor: greys(theme)[1500],
      overflow: 'hidden',
    },
    modalProfilePicture: {
      width: 64,
      height: 64,
      borderRadius: 32,
      marginBottom: 16,
      backgroundColor: greys(theme)[0],
    },
    name: {
      color: greys(theme)[0],
      marginBottom: 8,
      marginTop: 16,
      textAlign: 'center',
    },
    about: {
      fontSize: 16,
      color: greys(theme)[0],
      textAlign: 'center',
      marginBottom: 8,
    },
    website: {
      fontSize: 14,
      color: '#1e90ff',
      marginTop: 4,
    },
    contactContainer: {
      alignItems: 'center',
      marginBottom: 16,
    },
    contactProfilePicture: {
      width: 32,
      height: 32,
      borderRadius: 16,
      marginBottom: 8,
    },
    contactName: {
      fontSize: 20,
      color: greys(theme)[0],
      textAlign: 'center',
    },
    qrText: {
      color: greys(theme)[0],
      fontSize: 24,
    },
    menuButton: {
      paddingTop: 0,
      paddingBottom: 32,
      padding: 32,
      justifyContent: 'flex-start',
      alignItems: 'center',
      flexDirection: 'row',
    },
    menuText: {
      marginLeft: 12,
      color: greys(theme)[0],
    },
    gradientContainer: {
      padding: 16,
      paddingTop: 48,
      flex: 1,
    },
    container: {
      borderRadius: 12,
      borderWidth: 0.5,
      borderColor: greys(theme)[1500],
      backgroundColor: greys(theme)[1800],
      padding: 8,
      flexDirection: 'row',
      flexWrap: 'wrap',
      margin: 16,
    },
    iconRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    iconContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: greys(theme)[1500],
      borderCurve: 'continuous',
    },
    iconLabel: {
      color: 'white',
      marginTop: 8,
      fontSize: 12,
      textAlign: 'center',
    },
    actionSheetContainer: {
      padding: 16,
      backgroundColor: greys(theme)[2300],
    },
    headerText: {
      color: greys(theme)[0],
      fontSize: 24,
      fontWeight: 'bold',
      marginBottom: 8,
    },
    subHeaderText: {
      color: greys(theme)[400],
      fontSize: 16,
      marginBottom: 24,
    },
    communitiesGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      gap: 12,
    },
    communityBox: {
      width: '30%',
      aspectRatio: 1,
      backgroundColor: greys(theme)[1800],
      borderRadius: 12,
      padding: 12,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    selectedCommunityBox: {
      borderColor: '#1e90ff',
      backgroundColor: opacity('#1e90ff', 0.1),
    },
    communityName: {
      color: greys(theme)[0],
      fontSize: 14,
      textAlign: 'center',
    },
    selectedCommunityText: {
      color: '#1e90ff',
      fontWeight: 'bold',
    },
    profileItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      // borderBottomWidth: 1,
      // borderBottomColor: greys(theme)[1800],
    },
    selectedProfileItem: {
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
    },
    actionSheetProfilePic: {
      width: 40,
      height: 40,
      borderRadius: 20,
      marginRight: 12,
    },
    profileName: {
      color: greys(theme)[0],
      fontSize: 16,
      flex: 1,
    },
    checkIconContainer: {
      marginLeft: 'auto',
      marginRight: 8,
    },
    accountButtonsContainer: {
      marginTop: 8,
    },
    createAccountButton: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      marginTop: 8,
    },
    createAccountIcon: {
      width: 24,
      height: 24,
      marginRight: 12,
    },
    createAccountText: {
      color: greys(theme)[0],
      fontSize: 16,
    },
    editButton: {
      padding: 8,
    },
    editButtonText: {
      color: greys(theme)[0],
      fontSize: 16,
    },
    importButton: {
      padding: 16,
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
      marginBottom: 12,
      alignItems: 'center',
    },
    importButtonText: {
      color: greys(theme)[0],
      fontSize: 16,
    },
    input: {
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
      padding: 16,
      color: greys(theme)[0],
      fontSize: 16,
      marginBottom: 12,
    },
    errorText: {
      color: 'red',
      fontSize: 14,
      marginBottom: 12,
    },
    bannerContainer: {
      position: 'relative',
      marginBottom: 40,
    },
    bannerImage: {
      width: '100%',
      aspectRatio: 3,
      borderRadius: 12,
    },
    profileInfoContainer: {
      position: 'absolute',
      bottom: -40,
      left: 16,
      right: 16,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
    },
    profilePicture: {
      width: 80,
      height: 80,
      borderRadius: 40,
      borderWidth: 4,
      borderColor: greys(theme)[2300],
    },
    followerCount: {
      color: greys(theme)[0],
      fontSize: 14,
      marginBottom: 8,
      marginRight: 8,
    },
    defaultProfilePicture: {
      backgroundColor: greys(theme)[1500],
      justifyContent: 'center',
      alignItems: 'center',
    },
    defaultProfileInitial: {
      color: greys(theme)[0],
      fontSize: 32,
      fontWeight: 'bold',
    },
    nameContainer: {
      marginHorizontal: 24,
    },
    displayName: {
      fontSize: 20,
      fontWeight: 'bold',
      color: greys(theme)[0],
      marginBottom: 0,
    },
    npub: {
      fontSize: 14,
      color: greys(theme)[400],
      marginBottom: 4,
    },
    continueButton: {
      backgroundColor: '#1e90ff',
      padding: 16,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: 16,
    },
    continueButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: 'bold',
    },
    tagsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 8,
      gap: 8,
    },
    tag: {
      backgroundColor: greys(theme)[1800],
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 12,
    },
    tagText: {
      color: greys(theme)[0],
      fontSize: 12,
    },
  });

export default withSheetProvider(Screen);
