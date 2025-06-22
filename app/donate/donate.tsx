import React from 'react';
import { StyleSheet, View, TouchableOpacity, Linking, ScrollView } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import Container from 'components/layout/Container';
import { Text } from 'components/common/Themed';
import { greys } from 'helper/colors';
import { useNavigation } from 'expo-router';
import CachedImage from 'components/common/Image';

// Organization interface
interface Organization {
  pubkey: string;
  displayName: string;
  image?: string;
  about?: string;
  website?: string;
}

// Predefined organizations
const FEATURED_ORGANIZATIONS: Organization[] = [
  {
    pubkey: 'f1989a96d75aa386b4c871543626cbb362c03248b220dc9ae53d7cefbcaaf2c1',
    displayName: 'HRF',
    image:
      'https://image.nostr.build/cf2831d214006f97688d669eb95c2b224e6d4579492d05a9086e4e64c7af9845.png',
    about:
      'The Human Rights Foundation is a nonpartisan, nonprofit organization that promotes and protects human rights globally, with a focus on closed societies.',
    website: 'HRF.org',
  },
  // {
  //   pubkey: "787338757fc25d65cd929394d5e7713cf43638e8d259e8dcf5c73b834eb851f2",
  //   displayName: "OpenSats",
  //   image:
  //     "https://cdn.nostr.build/i/p/2625c1c7593ffed6a0619e28f57de0691b8327dffc5367b125c09ac60d8b99a9.png",
  //   about:
  //     "Open source dev funding powered by sats - 100% pass through with no management fees - 501(c)(3) approved - bitcoin for a better world! ⚡",
  //   website: "https://opensats.org",
  // },
  // {
  //   pubkey: "dd4b44b40ac9e5fc856d0687c107627e6125aff350e46f34d22baa261a153922",
  //   displayName: "Bitshala",
  //   image:
  //     "https://nostr.build/i/nostr.build_aa94b27c7bc1ecbdce424fc5c0fa3d253d103a633568464b3df16e19f7784cb7.jpg",
  //   about: "The Indian Bitcoin Developer Academy",
  //   website: "https://www.bitshala.org/",
  // },
  // {
  //   pubkey: "0780b32ad406598bc4f3b79c07a90063ac6fb618e692151628eb2acff934b515",
  //   displayName: "African Bitcoiners",
  //   image:
  //     "https://nostr.build/i/56dff5eb565ed970cb872c45a4b6afb146be896b9957e05455a2249c5b555c69.jpg",
  //   about:
  //     "We are bringing freedom to Africa through Bitcoin adoption and education. Please support us.",
  //   website: "http://www.bitcoiners.africa",
  // },
  // {
  //   pubkey: "bd982176e5573528b3914b0b24ed7284da2bfb0b009f1d52ade0a28f8b2599a7",
  //   displayName: "Bitcoin Babies 🍼",
  //   image: "https://m.primal.net/KMFR.jpg",
  //   about:
  //     "Bitcoin Babies is a groundbreaking project that seeks to address the critical issue of infant malnutrition in third-world countries. We are committed to revolutionizing the landscape by combining the power of Bitcoin with nurturing infants and empowering mothers with knowledge, resources, and financial wellness for a brighter future",
  //   website: "bitcoinbabies.com",
  // },
];

export default function OrganizationScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useNavigation();

  const handleNavigation = (pubkey: string) => {
    navigation.navigate('userMessages', { pubkey });
  };

  return (
    <Container>
      <ScrollView>
        <View style={styles.organizationGrid}>
          {FEATURED_ORGANIZATIONS.map((org) => (
            <OrganizationTile
              key={org.pubkey}
              organization={org}
              onPress={() => handleNavigation(org.pubkey)}
            />
          ))}
        </View>
      </ScrollView>
    </Container>
  );
}

interface OrganizationTileProps {
  organization: Organization;
  onPress: () => void;
}

function OrganizationTile({ organization, onPress }: OrganizationTileProps) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { displayName, image, about, website } = organization;

  const handleWebsitePress = (url: string) => {
    Linking.openURL(url);
  };

  return (
    <TouchableOpacity onPress={onPress} style={styles.organizationTile}>
      {image && <CachedImage source={{ uri: image }} style={styles.tileImage} />}
      <View style={styles.tileTitleContainer}>
        <Text style={styles.tileTitle}>{displayName}</Text>
        {about && (
          <Text numberOfLines={2} ellipsizeMode="tail" style={styles.tileAbout}>
            {about}
          </Text>
        )}
        {website && (
          <TouchableOpacity onPress={() => handleWebsitePress(website)}>
            <Text style={styles.websiteLink}>{website}</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
    organizationGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginTop: 8,
    },
    organizationTile: {
      width: '48%',
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
      alignItems: 'flex-start',
      marginBottom: 16,
      overflow: 'hidden',
    },
    tileImage: {
      width: '100%',
      aspectRatio: 1,
      backgroundColor: greys(theme)[1500],
    },
    tileTitleContainer: {
      padding: 8,
      width: '100%',
    },
    tileTitle: {
      fontWeight: 'bold',
    },
    tileAbout: {
      fontSize: 12,
      color: greys(theme)[400],
      marginTop: 4,
    },
    websiteLink: {
      color: greys(theme)[600],
      fontSize: 12,
      marginTop: 4,
    },
  });
