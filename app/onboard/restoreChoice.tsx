import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  InteractionManager,
} from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, Theme } from 'helper/colors';
import Container from 'components/blocks/Container';
import { Text } from 'components/ui/Text';
import { Spacer, View, HStack, VStack } from 'components/ui/View';
import { useTypedNavigation } from 'helper/navigation';
import { retrieveMnemonic } from 'helper/secureStorage';
import Icon from 'assets/icons';
import Image from 'components/ui/Image';
import { Button } from 'components/ui/Button';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { EventKind } from 'helper/constants';
import * as nip06 from 'nostr-tools/nip06';
import { useFocusEffect } from 'expo-router';
import { Card } from 'components/ui/Card';

interface ProfileInfo {
  name?: string;
  picture?: string;
  pubkey: string;
}

interface ButtonBarProps {
  handleSkip: () => void;
  handleRestoreDifferent: () => void;
  hasNavigated: boolean;
  theme: Theme;
  mnemonic: string | null;
}

function useRestoreCandidate() {
  const [state, setState] = useState({
    profileInfo: null as ProfileInfo | null,
    mnemonic: null as string | null,
    pubkey: null as string | null,
    error: null as string | null,
    shouldSubscribe: false,
    initialized: false,
  });

  const filters = useMemo(() => {
    if (!state.pubkey || !state.shouldSubscribe) return [];
    return [
      {
        authors: [state.pubkey],
        kinds: [EventKind.Metadata],
        limit: 1,
      },
    ];
  }, [state.pubkey, state.shouldSubscribe]);

  const { events } = useSubscribe({ filters });

  // Handle initialization and subscription lifecycle
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const task = InteractionManager.runAfterInteractions(() => {
        if (!state.initialized) {
          setTimeout(async () => {
            try {
              const storedMnemonic = await retrieveMnemonic();

              if (!isMounted) return;

              if (!storedMnemonic) {
                setState((prev) => ({ ...prev, initialized: true }));
                return;
              }

              const { publicKey } = nip06.accountFromSeedWords(storedMnemonic, undefined, 0);

              setState((prev) => ({
                ...prev,
                mnemonic: storedMnemonic,
                pubkey: publicKey,
                shouldSubscribe: true,
                initialized: true,
              }));
            } catch (error) {
              console.error('Error initializing account:', error);
              if (isMounted) {
                setState((prev) => ({
                  ...prev,
                  error: 'Failed to load account information',
                  initialized: true,
                }));
              }
            }
          }, 0);
        } else if (state.pubkey) {
          setState((prev) => ({ ...prev, shouldSubscribe: true }));
        }
      });

      return () => {
        isMounted = false;
        setState((prev) => ({ ...prev, shouldSubscribe: false }));
        task.cancel();
      };
    }, [state.initialized, state.pubkey]) // Removed events from deps
  );

  // Process events separately to avoid infinite loops
  useEffect(() => {
    if (!events?.length || !state.pubkey) return;

    const latestEvent = events.reduce((latest, current) =>
      (latest?.created_at || 0) > (current?.created_at || 0) ? latest : current
    );

    if (!latestEvent?.content) return;

    try {
      const metadata = JSON.parse(latestEvent.content);
      setState((prev) => ({
        ...prev,
        profileInfo: {
          name: metadata.display_name || metadata.displayName || metadata.name || 'Sovran Account',
          picture: metadata.picture || metadata.image,
          pubkey: state.pubkey || 'stored_locally',
        },
      }));
    } catch (error) {
      console.error('Error parsing profile metadata:', error);
    }
  }, [events, state.pubkey]);

  return {
    profileInfo: state.profileInfo,
    mnemonic: state.mnemonic,
    error: state.error,
  } as const;
}

const ButtonBar = ({
  handleSkip,
  handleRestoreDifferent,
  hasNavigated,
  theme,
  mnemonic,
}: ButtonBarProps) => (
  <VStack
    className="bg-transparent"
    style={{ paddingHorizontal: 16, paddingBottom: 16, backgroundColor: greys(theme)[950] }}>
    <View className="px-2">
      <Card
        message="Creating a new account will delete the existing account on this device."
        variant="warning"
      />
    </View>
    <Spacer size={8} />
    <Button
      variant="primary"
      text="Create New Account"
      onPress={handleSkip}
      disabled={hasNavigated}
    />
    <Button
      variant="secondary"
      text={mnemonic ? 'Restore from Seed' : 'Loading...'}
      onPress={handleRestoreDifferent}
      disabled={hasNavigated || !mnemonic}
    />
  </VStack>
);

export default function RestoreChoiceScreen() {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();

  const [hasNavigated, setHasNavigated] = useState(false);

  const { profileInfo, mnemonic, error } = useRestoreCandidate();

  const handleRestore = async () => {
    if (hasNavigated) return;

    try {
      setHasNavigated(true);
      if (mnemonic) {
        navigation.navigate('onboard/animate', {
          mnemonic,
          type: 'recover',
        });
      }
    } catch {
      setHasNavigated(false);
      Alert.alert('Error', 'Failed to restore account. Please try again.');
    }
  };

  const handleSkip = () => {
    if (hasNavigated) return;
    setHasNavigated(true);
    navigation.navigate('onboard/new', { fromRestoreChoice: true });
  };

  const handleRestoreDifferent = () => {
    if (hasNavigated) return;
    setHasNavigated(true);
    navigation.navigate('onboard/mnemonic', { type: 'recover', mnemonic });
  };

  if (error) {
    return (
      <Container style={{ flex: 1 }}>
        <VStack
          align="center"
          justify="center"
          className="flex-1"
          style={{ paddingHorizontal: 32 }}>
          <Icon name="fa6-solid:triangle-exclamation" size={48} color={greys(theme)[400]} />
          <Spacer size={16} />
          <Text className="text-center text-xl font-bold" style={{ color: greys(theme)[0] }}>
            Unable to Load Account
          </Text>
          <Spacer size={12} />
          <Text className="text-center text-base leading-6" style={{ color: greys(theme)[300] }}>
            {error || "We couldn't find account information."}
          </Text>
          <Spacer size={32} />
          <TouchableOpacity
            className="w-full items-center justify-center rounded-xl"
            style={{ backgroundColor: greys(theme)[0], paddingVertical: 16 }}
            onPress={handleSkip}>
            <Text className="text-base font-semibold" style={{ color: greys(theme)[950] }}>
              Continue to Create New Account
            </Text>
          </TouchableOpacity>
        </VStack>
      </Container>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}>
      <Container style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <VStack style={{ flex: 1, paddingTop: 16 }}>
            <Text weight="bold" size={18} style={{ color: greys(theme)[0] }}>
              We found an account backup on this device
            </Text>
            <Spacer size={12} />
            <View style={{ backgroundColor: greys(theme)[950], flex: 1 }}>
              <VStack
                align="center"
                className="rounded-2xl"
                style={{
                  backgroundColor: greys(theme)[800],
                  padding: 12,
                  borderWidth: 1,
                  borderColor: greys(theme)[700],
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.08,
                  shadowRadius: 8,
                  elevation: 2,
                  marginBottom: 24,
                }}>
                <HStack align="center" justify="space-between">
                  <View style={{ marginRight: 8 }}>
                    {!profileInfo ? (
                      <View
                        className="h-[48px] w-[48px] items-center justify-center rounded-full"
                        style={{
                          backgroundColor: greys(theme)[700],
                          borderWidth: 2,
                          borderColor: greys(theme)[700],
                        }}>
                        <ActivityIndicator size="small" color={greys(theme)[0]} />
                      </View>
                    ) : profileInfo?.picture ? (
                      <Image
                        source={{ uri: profileInfo?.picture }}
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 36,
                          borderWidth: 2,
                          borderColor: greys(theme)[700],
                        }}
                      />
                    ) : (
                      <View
                        className="h-[72px] w-[72px] items-center justify-center rounded-full"
                        style={{
                          backgroundColor: greys(theme)[700],
                          borderWidth: 2,
                          borderColor: greys(theme)[700],
                        }}>
                        <Icon name="fa6-solid:user" size={28} color={greys(theme)[400]} />
                      </View>
                    )}
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text weight="bold" size={20} style={{ color: greys(theme)[0] }}>
                      {profileInfo?.name || 'Loading...'}
                    </Text>
                    {/* Keep minimal to focus the decision */}
                  </View>
                </HStack>
                <Spacer size={8} />
                <View className="w-full">
                  <Button variant="primary" text="Restore" onPress={handleRestore} />
                </View>
              </VStack>
            </View>
          </VStack>
        </ScrollView>
      </Container>
      <ButtonBar
        handleSkip={handleSkip}
        handleRestoreDifferent={handleRestoreDifferent}
        hasNavigated={false}
        theme={theme}
        mnemonic={mnemonic}
      />
    </KeyboardAvoidingView>
  );
}
// Tailwind-based layout; minimal inline styles for theme colors
