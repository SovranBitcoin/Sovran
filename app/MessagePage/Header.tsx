import React from 'react';
import { Animated, Dimensions, Pressable } from 'react-native';
import { View, Text } from 'components/common/Themed';
import { greys } from 'helper/colors';
import { ArrowIcon, InfoIcon, VerifiedIcon } from 'assets/icons';
import { BlurView } from 'expo-blur';
import opacity from 'hex-color-opacity';
import CachedImage from 'components/common/Image';
import { useTypedNavigation } from 'helper/navigation';
import { TouchableOpacity } from 'components/common/TouchableOpacity';

const Header = ({ theme, combinedSearchAndProfiles, params, profiles }) => {
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
          style={[styles.iconButton, { backgroundColor: opacity(greys(theme)[2300], 0.25) }]}>
          <ArrowIcon size={24} rotate={-135} color={greys(theme)[0]} />
        </TouchableOpacity>

        {/* Profile Information */}
        <View style={styles.profileContainer}>
          {profileImage && (
            <Animated.View style={styles.profileImageContainer}>
              {isVerified && (
                <View style={[styles.verifiedBadge, { backgroundColor: greys(theme)[2300] }]}>
                  <VerifiedIcon fill={greys(theme)[100]} />
                </View>
              )}
              <CachedImage
                style={[styles.profileImage, { borderColor: greys(theme)[1300] }]}
                source={{ uri: profileImage }}
              />
              <Animated.View style={styles.transparent}>
                <Text style={styles.displayName}>{displayName}</Text>
              </Animated.View>
            </Animated.View>
          )}
        </View>

        {/* Placeholder Button (Hidden) */}
        <Pressable style={styles.hiddenButton}>
          <InfoIcon color={greys(theme)[0]} />
        </Pressable>
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
    marginLeft: 12,
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
