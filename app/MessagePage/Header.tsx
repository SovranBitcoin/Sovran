import React from 'react';
import { Animated, Dimensions } from 'react-native';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { greys, Theme } from 'helper/colors';
import Icon, { ArrowIcon, VerifiedIcon } from 'assets/icons';
import { BlurView } from 'expo-blur';
import opacity from 'hex-color-opacity';
import CachedImage from 'components/common/Image';
import { useTypedNavigation } from 'helper/navigation';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { SheetManager } from 'react-native-actions-sheet';
import { muteUser, reportUser, addContact, removeContact } from 'helper/redux/nostr';
import { useDispatch, useSelector } from 'react-redux';
import { showMessage } from 'helper/popup/popups';
import { RootState } from 'helper/redux/store';

interface HeaderProps {
  theme: Theme;
  combinedSearchAndProfiles: any[];
  params: any;
  profiles: any[];
}

const Header = ({ theme, combinedSearchAndProfiles, params, profiles }: HeaderProps) => {
  const navigation = useTypedNavigation();
  const maxWidth = Math.min(Dimensions.get('window').width, 600);
  const bannerHeight = (maxWidth * 214) / 600 + 32;

  const profile = combinedSearchAndProfiles.find((p) => p.pubkey === params.pubkey);
  const isVerified = profiles.some((p) => p.pubkey === params.pubkey);
  const profileImage = profile?.picture || profile?.image;
  const displayName =
    profile?.displayName ||
    profile?.display_name ||
    profile?.username ||
    profile?.name ||
    'Unknown User';

  const dispatch = useDispatch();
  const contacts = useSelector((state: RootState) => state.nostr.contacts || []);
  const isContact = contacts.some((c) => c.pubkey === params.pubkey);

  const handleGoBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      console.warn('No previous screen to go back to.');
    }
  };

  return (
    <Animated.View style={styles.container}>
      {/* Banner Image */}
      <CachedImage
        style={[styles.bannerImage, { width: maxWidth, height: bannerHeight }]}
        source={{ uri: profile?.banner }}
      />

      {/* Blur Effect */}
      <BlurView
        tint="default"
        intensity={33}
        experimentalBlurMethod="dimezisBlurView"
        style={[styles.blurView, { width: maxWidth, height: bannerHeight }]}
      />

      {/* Header Content */}
      <View style={[styles.headerContent, { width: maxWidth }]}>
        {/* Back Button */}
        <TouchableOpacity
          onPress={handleGoBack}
          style={[
            styles.iconButton,
            { marginLeft: 12, backgroundColor: opacity(greys(theme)[950], 0.25) },
          ]}>
          <ArrowIcon size={24} rotate={-135} color={greys(theme)[0]} />
        </TouchableOpacity>

        {/* Profile Information */}
        <View style={styles.profileContainer}>
          {profileImage && (
            <Animated.View style={styles.profileImageContainer}>
              {isVerified && (
                <View style={[styles.verifiedBadge, { backgroundColor: greys(theme)[950] }]}>
                  <VerifiedIcon />
                </View>
              )}
              <CachedImage
                style={[styles.profileImage, { borderColor: greys(theme)[600] }]}
                source={{ uri: profileImage }}
              />
              <Animated.View style={styles.transparent}>
                <Text style={styles.displayName}>{displayName}</Text>
              </Animated.View>
            </Animated.View>
          )}
        </View>

        {/* Placeholder Button (Hidden) */}
        <TouchableOpacity
          onPress={() => {
            SheetManager.show('button-handler', {
              payload: {
                buttons: [
                  {
                    variant: 'secondary',
                    icon: 'majesticons:text',
                    text: 'Feed',
                    onPress: async () => {
                      navigation.navigate('feed', {
                        pubkey: params.pubkey,
                      });
                    },
                  },
                  {
                    variant: 'secondary',
                    icon: isContact ? 'la:user-minus' : 'la:user-plus',
                    text: isContact ? 'Remove Contact' : 'Add Contact',
                    onPress: async () => {
                      if (isContact) {
                        dispatch(removeContact(params.pubkey));
                        await showMessage('Contact removed');
                      } else {
                        dispatch(addContact({ pubkey: params.pubkey, profile }));
                        await showMessage('Contact added');
                      }
                    },
                  },
                  {
                    variant: 'secondary',
                    icon: 'la:user-slash',
                    text: 'Mute User',
                    onPress: async () => {
                      await showMessage('User muted successfully');
                      dispatch(muteUser(params.pubkey));
                    },
                  },
                  {
                    variant: 'secondary',
                    icon: 'material-symbols:report-rounded',
                    text: 'Report User',
                    onPress: async () => {
                      await showMessage('User reported successfully');
                      dispatch(reportUser(params.pubkey));
                    },
                  },
                ],
              },
            });
          }}
          style={[
            styles.iconButton,
            { marginRight: 12, backgroundColor: opacity(greys(theme)[950], 0.25) },
          ]}>
          <Icon name="material-symbols:info-rounded" size={24} color={greys(theme)[0]} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = {
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.66,
  },
  blurView: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 32,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    marginTop: 32,
  },
  iconButton: {
    borderRadius: 1000,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileContainer: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    flex: 1,
  },
  profileImageContainer: {
    position: 'relative',
    height: 72,
    backgroundColor: 'transparent',
    marginRight: 8,
    display: 'flex',
    alignItems: 'center',
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    zIndex: 100,
    borderRadius: 100,
    height: 28,
    width: 28,
    padding: 1,
  },
  profileImage: {
    width: 72,
    height: 72,
    borderRadius: 1000,
    borderWidth: 0.2,
  },
  transparent: {
    backgroundColor: 'transparent',
    width: '100%',
    paddingTop: 6,
  },
  displayName: {
    fontSize: 16,
    fontFamily: 'OverpassBold',
    width: '100%',
  },
  hiddenButton: {
    backgroundColor: 'transparent',
    borderRadius: 1000,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    opacity: 0,
    pointerEvents: 'none',
  },
};

export default Header;
