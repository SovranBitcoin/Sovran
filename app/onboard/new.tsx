import '../../shim';
import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Image,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, shades, Theme } from 'helper/colors';
import Container from 'components/blocks/Container';
import { Text } from 'components/ui/Text';
import { router } from 'expo-router';
import { EventTemplate, finalizeEvent, nip19, SimplePool } from 'nostr-tools';
import { PUBLIC_KEYS } from 'helper/constants';
// @ts-ignore
import * as nip06 from 'node_modules/nostr-tools/lib/cjs/nip06';
import { useNostr } from 'helper/redux/nostr';
import * as bip39 from '@scure/bip39';

import { entropyToMnemonic } from 'bip39';
import * as Crypto from 'expo-crypto';
import { store } from 'helper/redux/store';
import { HDKey } from '@scure/bip32';
import { relays } from 'components/ndk';
import { storeMnemonic } from 'helper/secureStorage';
import { Button } from 'components/ui/Button';
import { Card } from 'components/ui/Card';
import { Spacer, VStack, HStack } from 'components/ui/View';

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

interface ProfilePictureSelectorProps {
  selectedProfilePicture: any;
  setSelectedProfilePicture: (profile: any) => void;
  isSubmitting: boolean;
  styles: any;
}

const ProfilePictureSelector = ({
  selectedProfilePicture,
  setSelectedProfilePicture,
  isSubmitting,
  styles,
}: ProfilePictureSelectorProps) => (
  <VStack align="center">
    <View style={styles.selectedProfileContainer}>
      {selectedProfilePicture && (
        <Image source={{ uri: selectedProfilePicture.uri }} style={styles.selectedProfileImage} />
      )}
    </View>

    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="max-h-20"
      contentContainerStyle={styles.profileOptionsContent}>
      <HStack justify="center">
        {profilePictures.map((profile, index) => (
          <TouchableOpacity
            key={index}
            onPress={() =>
              handleProfilePictureSelect(profile, setSelectedProfilePicture, isSubmitting)
            }
            className="mx-1"
            style={[
              styles.profileOption,
              selectedProfilePicture === profile && styles.selectedProfileOption,
              isSubmitting && styles.disabledControl,
            ]}
            disabled={isSubmitting}>
            <Image source={{ uri: profile.uri }} style={styles.profileOptionImage} />
          </TouchableOpacity>
        ))}
      </HStack>
    </ScrollView>
  </VStack>
);

const handleProfilePictureSelect = (
  profile: any,
  setSelectedProfilePicture: (profile: any) => void,
  isSubmitting: boolean
) => {
  if (isSubmitting) return;
  setSelectedProfilePicture(profile);
};

interface NameInputProps {
  name: string;
  setName: (name: string) => void;
  isSubmitting: boolean;
  styles: any;
  theme: Theme;
  error: boolean;
}

const NameInput = ({ name, setName, isSubmitting, styles, theme, error }: NameInputProps) => (
  <VStack spacing={16}>
    <Text weight="medium" size={14} style={styles.inputLabel}>
      Enter your name
    </Text>
    {error && (
      <>
        <Card message="You must enter something for your profile name" variant="warning" />
        <Spacer size={8} />
      </>
    )}
    <VStack spacing={16}>
      <TextInput
        placeholder="Your public profile name"
        onChangeText={(newText) => setName(newText)}
        style={[styles.textInput, isSubmitting && styles.disabledControl]}
        editable={!isSubmitting}
        placeholderTextColor={greys(theme)[300]}
        value={name}
      />
      <Text weight="regular" size={12} style={styles.privacyNote}>
        Note that your profile will be public, so anyone can search for you and send funds. While
        your profile is public, your transactions remain private.
      </Text>
    </VStack>
  </VStack>
);

// Main RecoveryScreen component
const RecoveryScreen = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { setProfiles, setCurrentProfile } = useNostr();

  // State
  const [selectedProfilePicture, setSelectedProfilePicture] = useState(profilePictures[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mnemonic] = useState(generateMnemonic());
  const [name, setName] = useState('');
  const [error, setError] = useState(false);

  // Note: prevScreen logic removed as it's not needed with new router

  const handleCreateProfile = runWithAnimationFrame(async () => {
    try {
      if (!name.trim() || isSubmitting) {
        setError(true);
        return;
      }

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
        tags: [['client', 'sovran.money', `31990:${PUBLIC_KEYS.SUPPORT}:sovran-app`]],
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

      // Store mnemonic securely before proceeding
      const mnemonicStored = await storeMnemonic(mnemonic);
      if (!mnemonicStored) {
        console.error('Failed to store mnemonic securely');
        Alert.alert(
          'Security Error',
          'Failed to securely store your recovery phrase. Please try again.',
          [{ text: 'OK' }]
        );
        return;
      }

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
      // Skip seed phrase display and verification - go directly to animation
      router.push({
        pathname: '/onboard/animate',
        params: { mnemonic, type: 'new' },
      });
    } catch (err) {
      console.error(err);
    }
  }, setIsSubmitting);

  const handleExistingAccount = () => {
    if (isSubmitting) return;
    router.push({
      pathname: '/onboard/mnemonic',
      params: {
        type: 'recover',
        mnemonic: '',
      },
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
            <VStack spacing={8}>
              <Spacer size={16} />
              <Text weight="bold" size={24} style={styles.headerTitle}>
                Create Sovran Profile
              </Text>
              <Text weight="regular" size={14} style={styles.headerSubtitle}>
                Your profile lets others find you and send you bitcoin easily.
              </Text>
              <Spacer size={24} />
            </VStack>

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
              error={error}
            />
          </View>
        </ScrollView>
      </Container>

      <View style={styles.bottomButtons}>
        <Button
          variant="primary"
          text={prevScreen === 'onboard/nostr' ? 'Create Sovran Account' : 'Next'}
          onPress={handleCreateProfile}
          disabled={isSubmitting}
          loading={isSubmitting}
        />

        {prevScreen === 'onboard/nostr' && (
          <Button
            variant="secondary"
            text="I already have a Sovran account"
            onPress={handleExistingAccount}
            disabled={isSubmitting}
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    scrollContainer: {
      flexGrow: 1,
    },
    container: {
      flex: 1,
      padding: 16,
      backgroundColor: greys(theme)[950],
    },
    headerTitle: {
      fontFamily: 'OverpassBold',
      color: greys(theme)[0],
    },
    headerSubtitle: {
      color: greys(theme)[200],
    },
    selectedProfileContainer: {
      width: 120,
      height: 120,
      borderRadius: 60,
      backgroundColor: greys(theme)[800],
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    },
    selectedProfileImage: {
      width: 120,
      height: 120,
      borderRadius: 60,
    },
    profileOptionsContent: {
      paddingHorizontal: 4,
    },
    profileOption: {
      width: 60,
      height: 60,
      borderRadius: 30,
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
    inputLabel: {
      color: greys(theme)[100],
    },
    textInput: {
      backgroundColor: greys(theme)[800],
      color: greys(theme)[0],
      borderRadius: 8,
      padding: 16,
      fontSize: 16,
      borderWidth: 1,
      borderColor: greys(theme)[700],
    },
    privacyNote: {
      color: greys(theme)[200],
      lineHeight: 18,
    },
    bottomButtons: {
      paddingHorizontal: 16,
      paddingBottom: 16,
      backgroundColor: greys(theme)[950],
    },
    disabledControl: {
      opacity: 0.6,
    },
  });

export default RecoveryScreen;
