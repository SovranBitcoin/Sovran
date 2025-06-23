import '../../shim';
import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, shades } from 'helper/colors';
import Container from 'components/layout/Container';
import { Text } from 'components/common/Text';
import { useTypedNavigation } from 'helper/navigation';
import { EventTemplate, finalizeEvent, nip19, SimplePool } from 'nostr-tools';
import * as nip06 from 'node_modules/nostr-tools/lib/cjs/nip06';
import { useNostr } from 'helper/redux/nostr';
import * as bip39 from '@scure/bip39';

import { entropyToMnemonic } from 'bip39';
import * as Crypto from 'expo-crypto';
import { store } from 'helper/redux/store';
import { HDKey } from '@scure/bip32';
import { relays } from 'components/ndk';

// eslint-disable-next-line @typescript-eslint/no-require-imports
global.Buffer = require('buffer').Buffer;

/**
 * Executes an async function within a requestAnimationFrame to improve UI responsiveness
 */
export const runWithAnimationFrame = <T extends any[]>(
  callback: Function,
  setIsSubmitting?: React.Dispatch<React.SetStateAction<boolean>>
) => {
  return async (...args: T) => {
    if (setIsSubmitting) {
      setIsSubmitting(true);
    }

    requestAnimationFrame(async () => {
      try {
        await callback(...args);
      } catch {
      } finally {
        if (setIsSubmitting) {
          setIsSubmitting(false);
        }
      }
    });
  };
};

export function generateMnemonic(): string {
  const mnemonic = store.getState()?.nostr?.profiles?.[0]?.mnemonic;
  if (mnemonic) return mnemonic;

  const entropy = Buffer.from(Crypto.getRandomBytes(16));
  return entropyToMnemonic(entropy);
}

const profilePictures = [
  {
    uri: 'https://i.ibb.co/hFLfs20/kelbiee-A-photorealistic-caucasian-man-facing-forward-a-digital-96aab0a7-3406-4a14-a262-893d4a07fd7d.webp',
  },
  {
    uri: 'https://i.ibb.co/NWRGTD1/kelbiee-A-photorealistic-lebanese-woman-facing-forward-a-digita-b86bf261-8011-4b6d-9760-ac3e13792c8e.png',
  },
  {
    uri: 'https://i.ibb.co/s6P30Bs/kelbiee-A-photorealistic-caucasian-man-facing-forward-a-digital-583aad52-cf85-41a1-a4d7-594bfa816efb.webp',
  },
  {
    uri: 'https://i.ibb.co/Snm98B9/kelbiee-A-photorealistic-White-woman-facing-forward-a-digital-i-23363858-885f-434d-befa-8d112acc90e7.png',
  },
  {
    uri: 'https://i.ibb.co/xYPtXtJ/kelbiee-A-photorealistic-german-man-facing-forward-a-digital-il-7acde628-0725-4900-adb3-3640bef4eff1.webp',
  },
  {
    uri: 'https://i.ibb.co/G7yjvGf/kelbiee-A-photorealistic-latina-woman-facing-forward-a-digital-2340219e-5afd-4701-95d6-934f2c1e480f.webp',
  },
  {
    uri: 'https://i.ibb.co/CshqCky/kelbiee-A-photorealistic-caucasian-man-facing-forward-a-digital-f1d772bc-e3ff-4cfe-bee8-4b0f067b2fde.webp',
  },
  {
    uri: 'https://i.ibb.co/86mmHXG/kelbiee-A-photorealistic-man-facing-forward-a-digital-illustrat-8151d836-41be-48c0-8b4c-c1664de23150.webp',
  },
  {
    uri: 'https://i.ibb.co/2Zj79j7/kelbiee-A-photorealistic-lebanese-woman-facing-forward-a-digita-0e565a6b-b105-41b3-8fc6-eabb72e50591.png',
  },
];

// Relay URLs used for Nostr connections
const RELAY_URLS = relays;

// Separate ProfilePictureSelector component
const ProfilePictureSelector = ({
  selectedProfilePicture,
  setSelectedProfilePicture,
  isSubmitting,
  styles,
}) => (
  <View style={styles.profileImageContainer}>
    <View style={styles.selectedProfileContainer}>
      {selectedProfilePicture && (
        <Image source={{ uri: selectedProfilePicture.uri }} style={styles.selectedProfileImage} />
      )}
    </View>

    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.profileOptionsScroll}
      contentContainerStyle={styles.profileOptionsContent}>
      {profilePictures.map((profile, index) => (
        <TouchableOpacity
          key={index}
          onPress={() =>
            handleProfilePictureSelect(profile, setSelectedProfilePicture, isSubmitting)
          }
          style={[
            styles.profileOption,
            selectedProfilePicture === profile && styles.selectedProfileOption,
            isSubmitting && styles.disabledControl,
          ]}
          disabled={isSubmitting}>
          <Image source={{ uri: profile.uri }} style={styles.profileOptionImage} />
        </TouchableOpacity>
      ))}
    </ScrollView>
  </View>
);

// Helper function for profile picture selection
const handleProfilePictureSelect = (profile, setSelectedProfilePicture, isSubmitting) => {
  if (isSubmitting) return;
  setSelectedProfilePicture(profile);
};

// Separate NameInput component
const NameInput = ({ name, setName, isSubmitting, styles, theme }) => (
  <View style={styles.inputContainer}>
    <Text weight="medium" size={14} style={styles.inputLabel}>
      Enter your name
    </Text>
    <TextInput
      placeholder="Your public profile name"
      onChangeText={(newText) => setName(newText)}
      style={[styles.textInput, isSubmitting && styles.disabledControl]}
      editable={!isSubmitting}
      placeholderTextColor={greys(theme)[600]}
      value={name}
    />
    <Text weight="regular" size={12} style={styles.privacyNote}>
      Note that your profile will be public, so anyone can search for you and send funds. While your
      profile is public, your transactions remain private.
    </Text>
  </View>
);

// Separate ButtonBar component
const ButtonBar = ({ handleCreateProfile, handleExistingAccount, isSubmitting, styles, theme }) => (
  <View style={styles.bottomButtons}>
    <TouchableOpacity
      style={[styles.createButton, isSubmitting && styles.disabledControl]}
      onPress={handleCreateProfile}
      disabled={isSubmitting}>
      {isSubmitting ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={greys(theme)[0]} />
          <Text weight="bold" size={16} style={[styles.createButtonText, { marginLeft: 8 }]}>
            Creating...
          </Text>
        </View>
      ) : (
        <Text weight="bold" size={16} style={styles.createButtonText}>
          Create Sovran Account
        </Text>
      )}
    </TouchableOpacity>

    <TouchableOpacity
      style={[styles.existingButton, isSubmitting && styles.disabledControl]}
      onPress={handleExistingAccount}
      disabled={isSubmitting}>
      <Text
        size={16}
        weight="bold"
        style={[styles.existingButtonText, isSubmitting && styles.disabledButtonText]}>
        I already have a Sovran account
      </Text>
    </TouchableOpacity>
  </View>
);

// Main RecoveryScreen component
const RecoveryScreen = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useTypedNavigation();
  const { setProfiles, setCurrentProfile } = useNostr();

  // State
  const [selectedProfilePicture, setSelectedProfilePicture] = useState(profilePictures[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mnemonic] = useState(generateMnemonic());
  const [name, setName] = useState('');

  const handleCreateProfile = runWithAnimationFrame(async () => {
    try {
      if (!name.trim() || isSubmitting) return;

      const accountIndex = 0; // for now we force it to create account at index 0 only

      // Generate keys from mnemonic
      const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(
        mnemonic,
        undefined,
        accountIndex
      );

      const nsec = nip19.nsecEncode(sk);
      const npub = nip19.npubEncode(pk);

      // Build profile event
      const event: EventTemplate = {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          [
            'client',
            'sovran.money',
            '31990:1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2:sovran-app',
          ],
        ],
        content: JSON.stringify({
          name,
          picture: selectedProfilePicture.uri,
        }),
      };

      const signedEvent = finalizeEvent(event, sk);
      const pool = new SimplePool();
      await Promise.any(pool.publish(RELAY_URLS, signedEvent)).finally(() =>
        pool.close(RELAY_URLS)
      );

      // Update local profile storage
      const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(mnemonic));
      const newProfile = {
        name,
        picture: selectedProfilePicture.uri,
        pubkey: pk,
        npub,
        nsec,
        mnemonic,
        root: {
          xpriv: root.privateExtendedKey,
          xpub: root.publicExtendedKey,
        },
        id: accountIndex,
      };

      // setProfiles([...(profiles || []), newProfile]);
      setProfiles([newProfile]); // for now we force it to create account at index 0 only
      setCurrentProfile(newProfile);
      navigation.navigate('onboard/displayMnemonic', { mnemonic });
    } catch (err) {
      console.error(err);
    }
  }, setIsSubmitting);

  const handleExistingAccount = () => {
    if (isSubmitting) return;
    navigation.navigate('onboard/mnemonic', {
      type: 'recover',
      mnemonic: null,
    });
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}>
      <Container style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled">
          <View style={styles.container}>
            <Text weight="bold" size={24} style={styles.headerTitle}>
              Create Sovran Profile
            </Text>
            <Text weight="regular" size={14} style={styles.headerSubtitle}>
              Your profile lets others find you and send you bitcoin easily.
            </Text>

            <ProfilePictureSelector
              selectedProfilePicture={selectedProfilePicture}
              setSelectedProfilePicture={setSelectedProfilePicture}
              isSubmitting={isSubmitting}
              styles={styles}
            />

            <NameInput
              name={name}
              setName={setName}
              isSubmitting={isSubmitting}
              styles={styles}
              theme={theme}
            />
          </View>
        </ScrollView>
      </Container>

      <ButtonBar
        handleCreateProfile={handleCreateProfile}
        handleExistingAccount={handleExistingAccount}
        isSubmitting={isSubmitting}
        styles={styles}
        theme={theme}
      />
    </KeyboardAvoidingView>
  );
};

const createStyles = (theme: string) =>
  StyleSheet.create({
    scrollContainer: {
      flexGrow: 1,
    },
    container: {
      flex: 1,
      padding: 16,
      backgroundColor: greys(theme)[2300],
    },
    headerTitle: {
      fontFamily: 'OverpassBold',
      color: greys(theme)[0],
      marginBottom: 8,
      marginTop: 16,
    },
    headerSubtitle: {
      color: greys(theme)[400],
      marginBottom: 24,
    },
    profileImageContainer: {
      alignItems: 'center',
      marginBottom: 24,
    },
    selectedProfileContainer: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: greys(theme)[1800],
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 24,
      overflow: 'hidden',
    },
    selectedProfileImage: {
      width: 120,
      height: 120,
      borderRadius: 60,
    },
    profileOptionsScroll: {
      maxHeight: 80,
    },
    profileOptionsContent: {
      flexDirection: 'row',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    profileOption: {
      width: 60,
      height: 60,
      borderRadius: 30,
      marginHorizontal: 4,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    selectedProfileOption: {
      borderColor: shades[300],
    },
    profileOptionImage: {
      width: 56,
      height: 56,
      borderRadius: 28,
    },
    inputContainer: {
      marginTop: 16,
    },
    inputLabel: {
      color: greys(theme)[200],
      marginBottom: 8,
    },
    textInput: {
      backgroundColor: greys(theme)[1800],
      color: greys(theme)[0],
      borderRadius: 8,
      padding: 16,
      fontSize: 16,
      borderWidth: 1,
      borderColor: greys(theme)[1500],
      marginBottom: 16,
    },
    privacyNote: {
      color: greys(theme)[400],
      marginBottom: 16,
      lineHeight: 18,
    },
    bottomButtons: {
      paddingHorizontal: 16,
      paddingBottom: 16,
      backgroundColor: greys(theme)[2300],
    },
    createButton: {
      backgroundColor: shades[300],
      padding: 16,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 12,
    },
    createButtonText: {
      color: greys(theme)[0],
      textAlign: 'center',
    },
    existingButton: {
      backgroundColor: greys(theme)[1800],
      padding: 16,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
    },
    existingButtonText: {
      color: greys(theme)[0],
      textAlign: 'center',
    },
    disabledControl: {
      opacity: 0.6,
    },
    disabledButtonText: {
      color: greys(theme)[400],
    },
    loadingContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

export default RecoveryScreen;
