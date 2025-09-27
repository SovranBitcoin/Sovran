import React, { useState } from 'react';
import { SafeAreaView, TouchableOpacity, Clipboard, ScrollView, Image } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import Container from 'components/layout/Container';
import Icon from 'assets/icons';
import { showMessage } from 'helper/popup/popups';
import { View, HStack, VStack } from 'components/common/View';
import { Text } from 'components/common/Text';

const Profile = () => {
  const theme = useSelector(memoizedGetTheme);
  const { currentProfile } = useNostr();
  const [visibleFields, setVisibleFields] = useState({
    mnemonic: false,
    nsec: false,
    cashuMnemonic: false,
  });

  const handleCopy = (text: string, messageKey: string) => {
    if (text) {
      Clipboard.setString(text);
      showMessage(messageKey);
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
          backgroundColor: greys(theme)[800],
          marginBottom: 8,
          marginTop: 8,
          padding: 8,
        }}>
        <Text
          bold
          overpass
          size={14}
          style={{
            color: greys(theme)[400],
          }}>
          {label}
        </Text>
        <HStack align="center" justify="space-between">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text
              size={16}
              style={{
                color: greys(theme)[0],
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
                    backgroundColor: greys(theme)[700],
                    padding: 8,
                    marginLeft: 4,
                  }}>
                  <Icon
                    name={isVisible ? 'majesticons:eye-off' : 'majesticons:eye'}
                    size={16}
                    color={greys(theme)[400]}
                  />
                </View>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => handleCopy(value, messageKey)}>
              <View
                blur
                className="rounded"
                style={{
                  backgroundColor: greys(theme)[700],
                  padding: 8,
                  marginLeft: 4,
                }}>
                <Icon name="lets-icons:copy" size={16} color={greys(theme)[400]} />
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
              color: greys(theme)[200],
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
              color: greys(theme)[300],
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
