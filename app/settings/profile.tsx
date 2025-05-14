import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  Clipboard,
  ScrollView,
  Image,
  TextInput,
} from 'react-native';
import { useSelector } from 'react-redux';
import { useNavigation } from '@react-navigation/native';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import Container from 'components/layout/Container';
import Icon from 'assets/icons';
import { showMessage } from 'helper/popup/popups';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

const DERIVATION_PATH = `m/44'/129372'`;

const Profile = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { currentProfile } = useNostr();
  const [visibleFields, setVisibleFields] = useState({
    mnemonic: false,
    nsec: false,
    cashuMnemonic: false,
  });
  const [isEditMode, setIsEditMode] = useState(false);
  const [displayName, setDisplayName] = useState(currentProfile?.name || '');
  const [cashuMnemonic, setCashuMnemonic] = useState('');
  const navigation = useNavigation();

  useEffect(() => {
    if (currentProfile) {
      try {
        // Calculate cashu mnemonic
        const root = getRoot(currentProfile);
        const path = `${DERIVATION_PATH}/0'/${currentProfile?.id}'/0/0`;
        const seed = root.derive(path);
        const derivedCashuMnemonic = bip39.entropyToMnemonic(seed.privateKey, wordlist);
        setCashuMnemonic(derivedCashuMnemonic);
      } catch (error) {
        console.error('Error calculating cashu mnemonic:', error);
        setCashuMnemonic('Error calculating cashu mnemonic');
      }
    }
  }, [currentProfile]);

  function getRoot(profile) {
    if (profile?.root?.xpriv) {
      const root = HDKey.fromExtendedKey(profile.root.xpriv);
      if (root) {
        return root;
      }
    }

    const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(profile?.mnemonic));
    return root;
  }

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

  const renderDetail = (label, value, editable = false) => (
    <View style={styles.detailContainer}>
      <Text style={styles.detailLabel}>{label}</Text>
      {editable && isEditMode ? (
        <TextInput style={styles.detailText} value={displayName} onChangeText={setDisplayName} />
      ) : (
        <Text style={styles.detailText}>{value || 'N/A'}</Text>
      )}
    </View>
  );

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
                  color={greys(theme)[700]}
                />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => handleCopy(value, messageKey)}>
              <Icon name="lets-icons:copy" size={16} color={greys(theme)[700]} />
            </TouchableOpacity>
          </View>
        </View>
        {description && <Text style={styles.descriptionText}>{description}</Text>}
      </View>
    );
  };

  return (
    <Container>
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
          cashuMnemonic,
          'cashu_mnemonic_copied',
          'cashuMnemonic',
          'This is a mnemonic you can use in other cashu wallets to recover your funds if you ever want to stop using Sovran.'
        )}
      </SafeAreaView>
    </Container>
  );
};

const createStyles = (theme) =>
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
      color: greys(theme)[600],
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
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
    },
    detailLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: greys(theme)[700],
    },
    detailText: {
      fontSize: 16,
      color: greys(theme)[0],
    },
    descriptionText: {
      fontSize: 12,
      fontStyle: 'italic',
      color: greys(theme)[400],
      marginTop: 4,
    },
    editModeText: {
      fontSize: 12,
      color: greys(theme)[400],
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
      backgroundColor: greys(theme)[1500],
      borderRadius: 4,
      marginLeft: 4,
    },
    headerButton: {
      flexDirection: 'row',
      alignItems: 'center',
    },
  });

export default Profile;
