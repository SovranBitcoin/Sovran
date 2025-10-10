/**
 * @fileoverview New User Onboarding Screen for Sovran Application
 *
 * This module contains the React component for creating a new Sovran profile during
 * the onboarding process. It handles profile picture selection, name input, and
 * Nostr profile creation with secure mnemonic generation and storage.
 *
 * The component integrates with Nostr protocol for decentralized identity management
 * and uses BIP39 mnemonic generation for secure key derivation following NIP-06.
 */

import 'shim';
import React, { useState } from 'react';
import {
  TouchableOpacity,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import Container from 'components/blocks/Container';
import { Text } from 'components/ui/Text';
import { router } from 'expo-router';
import { EventTemplate, finalizeEvent, nip19, SimplePool } from 'nostr-tools';
import { PUBLIC_KEYS } from 'helper/constants';
import * as nip06 from 'nostr-tools/nip06';
import { useNostr } from 'redux/nostr';
import * as bip39 from '@scure/bip39';
import { entropyToMnemonic } from 'bip39';
import * as Crypto from 'expo-crypto';
import { store } from 'redux/store';
import { HDKey } from '@scure/bip32';
import { relays } from 'components/ndk';
import { storeMnemonic } from 'helper/secureStorage';
import { Button } from 'components/ui/Button';
import { Card } from 'components/ui/Card';
import { Avatar } from 'components/ui/Avatar';
import { Spacer, VStack, HStack } from 'components/ui/View';

global.Buffer = require('buffer').Buffer;

// Constants
/** Account index for HD key derivation (currently fixed to 0) */
const ACCOUNT_INDEX = 0;

/** Number of entropy bytes for BIP39 mnemonic generation (128 bits) */
const ENTROPY_BYTES = 16;

/** Size in pixels for the large selected profile picture display */
const AVATAR_SIZE_LARGE = 128;

/** Size in pixels for the small profile picture options in the selector */
const AVATAR_SIZE_SMALL = 60;

/** Nostr relay URLs for profile publishing */
const RELAY_URLS = relays;

/**
 * Array of profile picture URLs available for selection
 *
 * These are pre-generated avatar images that users can choose from
 * during profile creation. Each URL points to a hosted image that will be used
 * as the user's public profile picture on the Nostr network.
 */
const PROFILE_PICTURES: string[] = [
  'https://i.ibb.co/hFLfs20/kelbiee-A-photorealistic-caucasian-man-facing-forward-a-digital-96aab0a7-3406-4a14-a262-893d4a07fd7d.webp',
  'https://i.ibb.co/NWRGTD1/kelbiee-A-photorealistic-lebanese-woman-facing-forward-a-digita-b86bf261-8011-4b6d-9760-ac3e13792c8e.png',
  'https://i.ibb.co/s6P30Bs/kelbiee-A-photorealistic-caucasian-man-facing-forward-a-digital-583aad52-cf85-41a1-a4d7-594bfa816efb.webp',
  'https://i.ibb.co/Snm98B9/kelbiee-A-photorealistic-White-woman-facing-forward-a-digital-i-23363858-885f-434d-befa-8d112acc90e7.png',
  'https://i.ibb.co/xYPtXtJ/kelbiee-A-photorealistic-german-man-facing-forward-a-digital-il-7acde628-0725-4900-adb3-3640bef4eff1.webp',
  'https://i.ibb.co/G7yjvGf/kelbiee-A-photorealistic-latina-woman-facing-forward-a-digital-2340219e-5afd-4701-95d6-934f2c1e480f.webp',
  'https://i.ibb.co/CshqCky/kelbiee-A-photorealistic-caucasian-man-facing-forward-a-digital-f1d772bc-e3ff-4cfe-bee8-4b0f067b2fde.webp',
  'https://i.ibb.co/86mmHXG/kelbiee-A-photorealistic-man-facing-forward-a-digital-illustrat-8151d836-41be-48c0-8b4c-c1664de23150.webp',
  'https://i.ibb.co/2Zj79j7/kelbiee-A-photorealistic-lebanese-woman-facing-forward-a-digita-0e565a6b-b105-41b3-8fc6-eabb72e50591.png',
];

// Utility Functions
/**
 * Generates a BIP39 mnemonic phrase for secure key derivation
 *
 * This function creates a cryptographically secure mnemonic phrase using 128 bits
 * of entropy (16 bytes) following BIP39 standards. If a mnemonic already exists
 * in the store, it returns that instead of generating a new one.
 *
 * The generated mnemonic is used to derive Nostr private keys following NIP-06
 * specification, ensuring deterministic key generation across devices.
 *
 * @returns A 12-word BIP39 mnemonic phrase as a space-separated string
 *
 * @example
 * const mnemonic = generateMnemonic();
 * // Returns: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
 *
 * @see {@link https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki} BIP39 specification
 * @see {@link https://github.com/nostr-protocol/nips/blob/master/06.md} NIP-06 specification
 */
function generateMnemonic(): string {
  const existingMnemonic = store.getState()?.nostr?.profiles?.[0]?.mnemonic;
  if (existingMnemonic) return existingMnemonic;

  const entropy = Buffer.from(Crypto.getRandomBytes(ENTROPY_BYTES));
  return entropyToMnemonic(entropy);
}

// Component Interfaces
/**
 * Props interface for the ProfilePictureSelector component
 *
 * @interface ProfilePictureSelectorProps
 */
interface ProfilePictureSelectorProps {
  /** Currently selected profile picture URL */
  selectedProfilePicture: string;
  /** Callback function to update the selected profile picture */
  setSelectedProfilePicture: (profile: string) => void;
  /** Whether the form is currently being submitted (disables interactions) */
  isSubmitting: boolean;
}

/**
 * ProfilePictureSelector component for selecting a profile picture during onboarding
 *
 * This component displays a large preview of the currently selected profile picture
 * and a horizontal scrollable list of available profile picture options. Users can
 * tap on any option to select it as their profile picture.
 *
 * The component uses Avatar components for consistent styling and includes visual
 * feedback for the selected state and disabled state during form submission.
 *
 * @param props - The component props
 * @returns JSX element representing the profile picture selector
 *
 * @example
 * <ProfilePictureSelector
 *   selectedProfilePicture={selectedPicture}
 *   setSelectedProfilePicture={setSelectedPicture}
 *   isSubmitting={false}
 * />
 */
const ProfilePictureSelector = ({
  selectedProfilePicture,
  setSelectedProfilePicture,
  isSubmitting,
}: ProfilePictureSelectorProps) => {
  /**
   * Handles profile picture selection
   *
   * @param profile - The profile picture URL to select
   */
  const handleSelect = (profile: string) => {
    if (!isSubmitting) {
      setSelectedProfilePicture(profile);
    }
  };

  return (
    <VStack align="center" spacing={16}>
      <Avatar
        picture={selectedProfilePicture}
        size={AVATAR_SIZE_LARGE}
        variant="person"
        alt="Selected Profile Picture"
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="max-h-20"
        contentContainerStyle={{ paddingHorizontal: 4 }}>
        <HStack justify="center">
          {PROFILE_PICTURES.map((profile, index) => {
            const isSelected = selectedProfilePicture === profile;
            const opacity = isSubmitting ? 'opacity-30' : isSelected ? 'opacity-100' : 'opacity-60';

            return (
              <TouchableOpacity
                key={profile}
                onPress={() => handleSelect(profile)}
                className={`mx-1 ${opacity}`}
                disabled={isSubmitting}>
                <Avatar
                  picture={profile}
                  size={AVATAR_SIZE_SMALL}
                  variant="person"
                  alt={`Profile Option ${index + 1}`}
                />
              </TouchableOpacity>
            );
          })}
        </HStack>
      </ScrollView>
    </VStack>
  );
};

/**
 * Props interface for the NameInput component
 *
 * @interface NameInputProps
 */
interface NameInputProps {
  /** Current value of the name input field */
  name: string;
  /** Callback function to update the name value */
  setName: (name: string) => void;
  /** Whether the form is currently being submitted (disables input) */
  isSubmitting: boolean;
  /** Whether to show the validation error message */
  showError: boolean;
}

/**
 * NameInput component for entering the user's profile name during onboarding
 *
 * This component provides a text input field for the user to enter their public
 * profile name, along with validation error handling and helpful text about
 * profile visibility. The input is disabled during form submission.
 *
 * The component includes a warning card that appears when validation fails,
 * informing the user that a profile name is required.
 *
 * @param props - The component props
 * @returns JSX element representing the name input form
 *
 * @example
 * <NameInput
 *   name={profileName}
 *   setName={setProfileName}
 *   isSubmitting={false}
 *   showError={hasError}
 * />
 */
const NameInput = ({ name, setName, isSubmitting, showError }: NameInputProps) => {
  const { getPrimaryColor } = useTheme();

  return (
    <VStack spacing={16}>
      <Text weight="medium" size={14} className="text-primary-100">
        Enter your name
      </Text>
      {showError && (
        <>
          <Card message="You must enter something for your profile name" variant="warning" />
          <Spacer size={8} />
        </>
      )}
      <VStack spacing={16}>
        <TextInput
          placeholder="Your public profile name"
          onChangeText={setName}
          className={`rounded-lg border bg-primary-800 p-4 text-base text-white ${
            isSubmitting ? 'opacity-60' : ''
          }`}
          editable={!isSubmitting}
          placeholderTextColor={getPrimaryColor('300')}
          value={name}
        />
        <Text weight="regular" size={12} className="leading-5 text-primary-200">
          Note that your profile will be public, so anyone can search for you and send funds. While
          your profile is public, your transactions remain private.
        </Text>
      </VStack>
    </VStack>
  );
};

// Main Component
/**
 * RecoveryScreen component for new user onboarding and profile creation
 *
 * This is the main component for creating a new Sovran profile during the onboarding
 * process. It handles profile picture selection, name input validation, and the complete
 * Nostr profile creation workflow including secure mnemonic generation and storage.
 *
 * The component follows NIP-06 specification for deterministic key derivation and
 * publishes the profile to Nostr relays for decentralized identity management.
 *
 * @returns JSX element representing the new user onboarding screen
 *
 * @example
 * <RecoveryScreen />
 */
const RecoveryScreen = () => {
  const { setProfiles, setCurrentProfile } = useNostr();

  const [selectedProfilePicture, setSelectedProfilePicture] = useState<string>(PROFILE_PICTURES[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mnemonic] = useState(generateMnemonic());
  const [name, setName] = useState('');
  const [showError, setShowError] = useState(false);

  /**
   * Handles the complete profile creation process
   *
   * This function orchestrates the entire profile creation workflow:
   * 1. Validates the name input
   * 2. Generates Nostr keys from the mnemonic using NIP-06
   * 3. Creates and publishes a Nostr profile event
   * 4. Securely stores the mnemonic
   * 5. Updates the local profile state
   * 6. Navigates to the animation screen
   *
   * The function includes comprehensive error handling and user feedback
   * for each step of the process.
   *
   * @async
   * @throws Will show an alert if profile creation fails
   * @throws Will show an alert if mnemonic storage fails
   *
   * @see {@link https://github.com/nostr-protocol/nips/blob/master/06.md} NIP-06 specification
   */
  const handleCreateProfile = async () => {
    if (!name.trim()) {
      setShowError(true);
      return;
    }

    if (isSubmitting) return;

    setIsSubmitting(true);
    setShowError(false);

    try {
      // Generate keys from mnemonic
      const { privateKey: sk, publicKey: pk } = nip06.accountFromSeedWords(
        mnemonic,
        undefined,
        ACCOUNT_INDEX
      );

      const nsec = nip19.nsecEncode(sk);
      const npub = nip19.npubEncode(pk);

      // Build and publish profile event
      const event: EventTemplate = {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['client', 'sovran.money', `31990:${PUBLIC_KEYS.SUPPORT}:sovran-app`]],
        content: JSON.stringify({
          name,
          picture: selectedProfilePicture,
        }),
      };

      const signedEvent = finalizeEvent(event, sk);
      const pool = new SimplePool();

      await Promise.any(pool.publish(RELAY_URLS, signedEvent)).finally(() =>
        pool.close(RELAY_URLS)
      );

      // Store mnemonic securely
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

      // Create and store new profile
      const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(mnemonic));
      const newProfile = {
        name,
        picture: selectedProfilePicture,
        pubkey: pk,
        npub,
        nsec,
        mnemonic,
        root: {
          xpriv: root.privateExtendedKey,
          xpub: root.publicExtendedKey,
        },
        id: ACCOUNT_INDEX,
      };

      setProfiles([newProfile]);
      setCurrentProfile(newProfile);

      // Navigate to animation screen
      router.push({
        pathname: '/onboard/animate',
        params: { mnemonic, type: 'new' },
      });
    } catch (err) {
      console.error('Failed to create profile:', err);
      Alert.alert('Error', 'Failed to create profile. Please try again.', [{ text: 'OK' }]);
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Handles navigation to the existing account recovery flow
   *
   * This function navigates the user to the mnemonic input screen where they
   * can enter their existing recovery phrase to restore their account.
   *
   * @example
   * // User clicks "I already have a Sovran account" button
   * handleExistingAccount();
   */
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
      className="flex-1">
      <Container className="flex-1">
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <VStack className="flex-1 bg-primary-950 p-4">
            <VStack spacing={8}>
              <Spacer size={16} />
              <Text weight="bold" size={24} className="font-overpass-bold text-white">
                Create Sovran Profile
              </Text>
              <Text weight="regular" size={14} className="text-primary-0">
                Your profile lets others find you and send you bitcoin easily.
              </Text>
              <Spacer size={24} />
            </VStack>

            <ProfilePictureSelector
              selectedProfilePicture={selectedProfilePicture}
              setSelectedProfilePicture={setSelectedProfilePicture}
              isSubmitting={isSubmitting}
            />

            <NameInput
              name={name}
              setName={setName}
              isSubmitting={isSubmitting}
              showError={showError}
            />
          </VStack>
        </ScrollView>
      </Container>

      <VStack className="bg-primary-950 px-4 pb-4">
        <Button
          variant="primary"
          text="Create Sovran Account"
          onPress={handleCreateProfile}
          disabled={isSubmitting}
          loading={isSubmitting}
        />

        <Button
          variant="secondary"
          text="I already have a Sovran account"
          onPress={handleExistingAccount}
          disabled={isSubmitting}
        />
      </VStack>
    </KeyboardAvoidingView>
  );
};

export default RecoveryScreen;
