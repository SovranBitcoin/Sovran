import React, { useState } from 'react';
import { SafeAreaView, TouchableOpacity, Clipboard, ScrollView, Image } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import { useNostr } from 'redux/nostr';
import { useMnemonic, useCashuMnemonic, useNostrKeys } from 'hooks/useSecureStore';
import Container from 'components/blocks/Container';
import Icon from 'assets/icons';
import { popup } from '@/helper/popup';
import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { Skeleton } from 'components/ui/Skeleton';

const Profile = () => {
  const { getPrimaryColor } = useTheme();
  const { currentProfile } = useNostr();
  const { value: mnemonic, loading: mnemonicLoading } = useMnemonic();
  const { value: cashuMnemonic, loading: cashuMnemonicLoading } = useCashuMnemonic();
  const { value: nostrKeys, loading: nostrKeysLoading } = useNostrKeys();
  const [visibleFields, setVisibleFields] = useState({
    mnemonic: false,
    nsec: false,
    cashuMnemonic: false,
  });

  const handleCopy = (text: string, messageKey: string) => {
    if (text) {
      Clipboard.setString(text);
      popup({ message: messageKey, type: 'success' });
    }
  };

  const toggleFieldVisibility = (field: keyof typeof visibleFields) => {
    setVisibleFields((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const renderCopyableDetail = (
    label: string,
    value: string,
    messageKey: string,
    fieldKey: keyof typeof visibleFields | null = null,
    description: string | null = null,
    isLoading: boolean = false
  ) => {
    const showEyeIcon = fieldKey !== null;
    const isVisible = fieldKey ? visibleFields[fieldKey] : true;

    return (
      <VStack
        blur
        className="rounded-lg"
        style={{
          backgroundColor: getPrimaryColor('800'),
          marginBottom: 8,
          marginTop: 8,
          padding: 8,
        }}>
        <Text
          bold
          overpass
          size={14}
          style={{
            color: getPrimaryColor('400'),
          }}>
          {label}
        </Text>
        <HStack align="center" justify="space-between">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {isLoading ? (
              <Skeleton
                style={{
                  height: 32,
                  width: 100,
                  backgroundColor: getPrimaryColor('700'),
                }}
              />
            ) : (
              <Text
                size={16}
                style={{
                  color: getPrimaryColor('0'),
                }}>
                {showEyeIcon && !isVisible ? '••••••••' : value || 'N/A'}
              </Text>
            )}
          </ScrollView>
          <HStack align="center" style={{ marginLeft: 8 }}>
            {showEyeIcon && !isLoading && (
              <TouchableOpacity onPress={() => toggleFieldVisibility(fieldKey)}>
                <View
                  blur
                  className="rounded"
                  style={{
                    backgroundColor: getPrimaryColor('700'),
                    padding: 8,
                    marginLeft: 4,
                  }}>
                  <Icon
                    name={isVisible ? 'majesticons:eye-off' : 'majesticons:eye'}
                    size={16}
                    color={getPrimaryColor('400')}
                  />
                </View>
              </TouchableOpacity>
            )}
            {!isLoading && (
              <TouchableOpacity onPress={() => handleCopy(value, messageKey)}>
                <View
                  blur
                  className="rounded"
                  style={{
                    backgroundColor: getPrimaryColor('700'),
                    padding: 8,
                    marginLeft: 4,
                  }}>
                  <Icon name="lets-icons:copy" size={16} color={getPrimaryColor('400')} />
                </View>
              </TouchableOpacity>
            )}
          </HStack>
        </HStack>
        {description && (
          <Text
            italic
            overpass
            size={12}
            style={{
              color: getPrimaryColor('200'),
              marginTop: 4,
            }}>
            {description}
          </Text>
        )}
      </VStack>
    );
  };

  return (
    <Container>
      <ScrollView className="px-4">
        <SafeAreaView>
          <Text
            bold
            overpass
            size={13}
            className="uppercase tracking-wide"
            style={{
              color: getPrimaryColor('300'),
              marginBottom: 8,
              marginLeft: 8,
            }}>
            Profile Details
          </Text>

          <VStack align="center" style={{ marginBottom: 16, marginTop: 16 }}>
            {currentProfile?.picture ? (
              <Image
                source={{
                  uri: currentProfile.picture,
                }}
                className="h-[100px] w-[100px] rounded-full"
                resizeMode="cover"
              />
            ) : (
              <Skeleton
                style={{
                  height: 100,
                  width: 100,
                  borderRadius: 50, // Makes it perfectly circular
                  backgroundColor: getPrimaryColor('700'),
                }}
              />
            )}
          </VStack>

          {renderCopyableDetail(
            'NIP06:',
            mnemonic || '',
            'mnemonic_copied',
            'mnemonic',
            'Your recovery phrase that gives access to all your nostr & cashu wallets. Everything is derived from this mnemonic so keep it safe and secure!',
            mnemonicLoading
          )}

          {renderCopyableDetail(
            'Npub:',
            nostrKeys?.npub || '',
            'npub_copied',
            null,
            'Your public identifier on the Nostr network.',
            nostrKeysLoading
          )}

          {renderCopyableDetail(
            'Nsec:',
            nostrKeys?.nsec || '',
            'nsec_copied',
            'nsec',
            'Your private key. Never share this with anyone.',
            nostrKeysLoading
          )}

          {renderCopyableDetail(
            `NUT13:`,
            cashuMnemonic || '',
            'cashu_mnemonic_copied',
            'cashuMnemonic',
            'This is a mnemonic you can use in other cashu wallets to recover your funds if you ever want to stop using Sovran.',
            cashuMnemonicLoading
          )}
        </SafeAreaView>
      </ScrollView>
    </Container>
  );
};

export default Profile;
