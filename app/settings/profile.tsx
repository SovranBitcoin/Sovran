import React, { useState } from 'react';
import { SafeAreaView, TouchableOpacity, Clipboard, ScrollView, Image } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import Container from 'components/layout/Container';
import Icon from 'assets/icons';
import { showMessage } from 'helper/popup/popups';
import { View } from 'components/common/View';
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
      <View
        blur
        className="mb-2 mt-2 rounded-lg p-2"
        style={{
          backgroundColor: greys(theme)[800],
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
        <View className="flex-row items-center justify-between">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text
              size={16}
              style={{
                color: greys(theme)[0],
              }}>
              {showEyeIcon && !isVisible ? '••••••••' : value || 'N/A'}
            </Text>
          </ScrollView>
          <View className="flex-row items-center" style={{ marginLeft: 8 }}>
            {showEyeIcon && (
              <TouchableOpacity onPress={() => toggleFieldVisibility(fieldKey)}>
                <View
                  blur
                  className="ml-1 rounded p-2"
                  style={{
                    backgroundColor: greys(theme)[700],
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
                className="ml-1 rounded p-2"
                style={{
                  backgroundColor: greys(theme)[700],
                }}>
                <Icon name="lets-icons:copy" size={16} color={greys(theme)[400]} />
              </View>
            </TouchableOpacity>
          </View>
        </View>
        {description && (
          <Text
            italic
            overpass
            size={12}
            className="mt-1"
            style={{
              color: greys(theme)[200],
            }}>
            {description}
          </Text>
        )}
      </View>
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
            className="mb-2 ml-2 uppercase tracking-wide"
            style={{
              color: greys(theme)[300],
            }}>
            Profile Details
          </Text>

          <View className="mb-4 mt-4 items-center">
            <Image
              source={{
                uri: currentProfile?.picture || 'https://via.placeholder.com/150',
              }}
              className="h-[100px] w-[100px] rounded-full"
              resizeMode="cover"
            />
          </View>

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
