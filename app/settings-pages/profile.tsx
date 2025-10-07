import React, { useState } from 'react';
import { SafeAreaView, TouchableOpacity, Clipboard, ScrollView, Image } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import { useNostr } from 'redux/nostr';
import Container from 'components/blocks/Container';
import Icon from 'assets/icons';
import { popup } from '@/helper/popup';
import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';

const Profile = () => {
  const { getPrimaryColor } = useTheme();
  const { currentProfile } = useNostr();
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
    description: string | null = null
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
            <Text
              size={16}
              style={{
                color: getPrimaryColor('0'),
              }}>
              {showEyeIcon && !isVisible ? '••••••••' : value || 'N/A'}
            </Text>
          </ScrollView>
          <HStack align="center" style={{ marginLeft: 8 }}>
            {showEyeIcon && (
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
      <ScrollView>
        <SafeAreaView className="px-4">
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
            <Image
              source={{
                uri: currentProfile?.picture || 'https://via.placeholder.com/150',
              }}
              className="h-[100px] w-[100px] rounded-full"
              resizeMode="cover"
            />
          </VStack>

          {renderCopyableDetail(
            'NIP06:',
            currentProfile?.mnemonic,
            'mnemonic_copied',
            'mnemonic',
            'Your recovery phrase that gives access to all your nostr & cashu wallets. Everything is derived from this mnemonic so keep it safe and secure!'
          )}

          {renderCopyableDetail(
            'Npub:',
            currentProfile?.npub,
            'npub_copied',
            null,
            'Your public identifier on the Nostr network.'
          )}

          {renderCopyableDetail(
            'Nsec:',
            currentProfile?.nsec,
            'nsec_copied',
            'nsec',
            'Your private key. Never share this with anyone.'
          )}

          {renderCopyableDetail(
            `NUT13:`,
            currentProfile?.nut13,
            'cashu_mnemonic_copied',
            'cashuMnemonic',
            'This is a mnemonic you can use in other cashu wallets to recover your funds if you ever want to stop using Sovran.'
          )}
        </SafeAreaView>
      </ScrollView>
    </Container>
  );
};

export default Profile;
