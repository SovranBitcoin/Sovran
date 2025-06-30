import React, { useState } from 'react';
import {
  StyleSheet,
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  Clipboard,
  ScrollView,
  Image,
} from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import Container from 'components/layout/Container';
import Icon from 'assets/icons';
import { showMessage } from 'helper/popup/popups';

const Profile = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { currentProfile } = useNostr();
  const [visibleFields, setVisibleFields] = useState({
    mnemonic: false,
    nsec: false,
    cashuMnemonic: false,
  });

  const handleCopy = (text, messageKey) => {
    if (text) {
      Clipboard.setString(text);
      showMessage(messageKey);
    }
  };

  const toggleFieldVisibility = (field) => {
    setVisibleFields((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const renderCopyableDetail = (label, value, messageKey, fieldKey = null, description = null) => {
    const showEyeIcon = fieldKey !== null;
    const isVisible = fieldKey ? visibleFields[fieldKey] : true;

    return (
      <View style={styles.detailContainer}>
        <Text style={styles.detailLabel}>{label}</Text>
        <View style={styles.sensitiveField}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={styles.detailText}>
              {showEyeIcon && !isVisible ? '••••••••' : value || 'N/A'}
            </Text>
          </ScrollView>
          <View style={styles.iconContainer}>
            {showEyeIcon && (
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => toggleFieldVisibility(fieldKey)}>
                <Icon
                  name={isVisible ? 'majesticons:eye-off' : 'majesticons:eye'}
                  size={16}
                  color={greys(theme)[400]}
                />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => handleCopy(value, messageKey)}>
              <Icon name="lets-icons:copy" size={16} color={greys(theme)[400]} />
            </TouchableOpacity>
          </View>
        </View>
        {description && <Text style={styles.descriptionText}>{description}</Text>}
      </View>
    );
  };

  return (
    <Container>
      <ScrollView>
        <SafeAreaView style={styles.content}>
          <Text style={styles.sectionTitle}>Profile Details</Text>

          <View style={styles.profilePictureContainer}>
            <Image
              source={{
                uri: currentProfile?.picture || 'https://via.placeholder.com/150',
              }}
              style={styles.profilePicture}
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

const createStyles = (theme: string) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: 16,
    },
    sectionTitle: {
      marginVertical: 6,
      marginLeft: 8,
      fontSize: 13,
      letterSpacing: 0.33,
      fontWeight: '500',
      color: greys(theme)[300],
      textTransform: 'uppercase',
    },
    profilePictureContainer: {
      alignItems: 'center',
      marginVertical: 12,
    },
    profilePicture: {
      width: 100,
      height: 100,
      borderRadius: 50,
    },
    detailContainer: {
      marginVertical: 8,
      padding: 8,
      backgroundColor: greys(theme)[800],
      borderRadius: 8,
    },
    detailLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: greys(theme)[400],
    },
    detailText: {
      fontSize: 16,
      color: greys(theme)[0],
    },
    descriptionText: {
      fontSize: 12,
      fontStyle: 'italic',
      color: greys(theme)[200],
      marginTop: 4,
    },
    editModeText: {
      fontSize: 12,
      color: greys(theme)[200],
      marginBottom: 4,
    },
    sensitiveField: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    iconContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    iconButton: {
      padding: 8,
      backgroundColor: greys(theme)[700],
      borderRadius: 4,
      marginLeft: 4,
    },
    headerButton: {
      flexDirection: 'row',
      alignItems: 'center',
    },
  });

export default Profile;
