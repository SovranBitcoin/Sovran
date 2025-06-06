import React, { useEffect, useState } from 'react';
import { Linking, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { Text, View } from 'components/common/Themed';
import { greens, greys } from 'helper/colors';
import Wrapper from '../wrapper';
import { truncateMiddle } from 'helper/strings';
import { RowButton, Section } from 'app/settings';
import { useSheetRouteParams, useSheetRouter } from 'react-native-actions-sheet';
import { useWallet } from 'helper/cashu/wallet';
import { StyleSheet, Clipboard } from 'react-native';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Card } from 'components/common/Card';
import Image from 'components/common/Image';
import { useSelector } from 'react-redux';
import { NCSDK } from 'helper/third-party/cashu-address-sdk-rn/sdk';
import { NsecSigner } from 'helper/third-party/cashu-address-sdk-rn/signer';
import { nip19 } from 'nostr-tools';

const MintDetailPage = (props) => {
  const theme = 'dark';
  const styles = createStyles(theme);
  const router = useSheetRouter('mint');
  const params = useSheetRouteParams();
  const [copiedItem, setCopiedItem] = useState(null);

  const { wallet, loading, error } = useWallet({
    mintUrl: params?.mintUrl,
  });

  const handleCopy = async (text, itemName) => {
    try {
      await Clipboard.setString(text);
      setCopiedItem(itemName);
      setTimeout(() => setCopiedItem(null), 2000);
    } catch (error) {
      Alert.alert('Error', 'Failed to copy to clipboard');
    }
  };

  const formatNuts = (nuts) => {
    if (!nuts) return 'N/A';
    const supportedNuts = Object.keys(nuts).filter((nut) => {
      const nutData = nuts[nut];
      return (
        nutData.supported === true ||
        (nutData.methods && nutData.methods.length > 0) ||
        (nutData.supported && Array.isArray(nutData.supported))
      );
    });
    return `NUT-${supportedNuts.join(', NUT-')}`;
  };

  const formatCurrencies = (nuts) => {
    if (!nuts) return 'N/A';
    const currencies = new Set();

    Object.values(nuts).forEach((nut) => {
      if (nut.methods) {
        nut.methods.forEach((method) => {
          if (method.unit) currencies.add(method.unit.toUpperCase());
        });
      }
      if (nut.supported && Array.isArray(nut.supported)) {
        nut.supported.forEach((item) => {
          if (item.unit) currencies.add(item.unit.toUpperCase());
        });
      }
    });

    return currencies.size > 0 ? Array.from(currencies).join(', ') : 'SAT';
  };

  const handleContactPress = (method, info) => {
    switch (method) {
      case 'email':
        Linking.openURL(`mailto:${info}`);
        break;
      case 'twitter':
        Linking.openURL(`https://x.com/${info.replace('@', '')}`);
        break;
      case 'nostr':
        handleCopy(info, 'Nostr Key');
        break;
      default:
        handleCopy(info, 'Contact Info');
    }
  };

  const currentProfile = useSelector((state) => state.nostr.currentProfile);

  if (loading) {
    return (
      <Wrapper>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={greys(theme)[0]} />
          <Text style={styles.loadingText}>Loading mint details...</Text>
        </View>
      </Wrapper>
    );
  }

  if (error || !wallet?.mintInfo) {
    return (
      <Wrapper>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Failed to load mint details</Text>
          <Text style={styles.errorSubtext}>{error?.message || 'Unknown error'}</Text>
        </View>
      </Wrapper>
    );
  }

  const mintInfo = wallet.mintInfo._mintInfo;

  return (
    <Wrapper
      buttons={
        <ButtonHandler
          buttons={[
            {
              text: 'Close',
              variant: 'secondary',
              onPress: () => router?.goBack(),
            },
          ]}
        />
      }>
      <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {/* Mint Header */}
        <View style={styles.headerContainer}>
          <View style={styles.logoContainer}>
            {mintInfo.icon_url ? (
              <Image source={{ uri: mintInfo.icon_url }} style={styles.logoImage} />
            ) : (
              <View style={styles.logo}>
                <Text style={styles.logoText}>
                  {mintInfo.name ? mintInfo.name.charAt(0).toUpperCase() : 'M'}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.mintTitle}>{mintInfo.name || 'Unknown Mint'}</Text>
          {mintInfo.version && <Text style={styles.mintVersion}>{mintInfo.version}</Text>}
        </View>

        {/* Description Card */}
        {mintInfo.description && (
          <Card theme={theme} variant="info" message={mintInfo.description} />
        )}

        {/* Long Description */}
        {mintInfo.description_long && (
          <Card theme={theme} variant="warning" message={mintInfo.description_long} />
        )}

        {/* Message of the Day */}
        {mintInfo.motd && (
          <Card theme={theme} variant="warning" message={`Message: ${mintInfo.motd}`} />
        )}

        {/* Contact Section */}
        {mintInfo.contact && mintInfo.contact.length > 0 && (
          <Section title="Contact">
            {mintInfo.contact.map((contact, index) => (
              <RowButton
                key={index}
                label={contact.info}
                sublabel={contact.method.toUpperCase()}
                onPress={() => handleContactPress(contact.method, contact.info)}
                rightContent={
                  copiedItem === `contact-${index}` ? (
                    <Text style={styles.copiedText}>Copied!</Text>
                  ) : null
                }
              />
            ))}
          </Section>
        )}

        {/* Mint Details Section */}
        <Section title="Mint Details">
          <RowButton label="Version" value={mintInfo.version || 'Unknown'} />
        </Section>

        {/* Actions Section */}
        <Section title="Actions">
          <RowButton
            label="Set as NPC"
            textStyle={styles.actionText}
            style={styles.actionButton}
            onPress={async () => {
              // Handle edit mint navigation
              const sk = nip19.decode(currentProfile?.nsec).data;
              const signer = new NsecSigner(sk);
              const sdk = new NCSDK('https://npubx.cash', signer);

              await sdk.setMint(params?.mintUrl);
            }}
          />
        </Section>
      </ScrollView>
    </Wrapper>
  );
};

const createStyles = (theme) =>
  StyleSheet.create({
    scrollContainer: {
      flex: 1,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 40,
    },
    loadingText: {
      marginTop: 16,
      fontSize: 16,
      color: greys(theme)[2],
    },
    errorContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 40,
      paddingHorizontal: 20,
    },
    errorText: {
      fontSize: 18,
      fontWeight: 'bold',
      color: '#D32F2F',
      textAlign: 'center',
      marginBottom: 8,
    },
    errorSubtext: {
      fontSize: 14,
      color: greys(theme)[2],
      textAlign: 'center',
    },
    headerContainer: {
      alignItems: 'center',
      paddingVertical: 24,
      paddingBottom: 32,
    },
    logoContainer: {
      marginBottom: 16,
    },
    logo: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: '#3f836d',
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoImage: {
      width: 80,
      height: 80,
      borderRadius: 40,
    },
    logoText: {
      fontSize: 40,
      fontWeight: 'bold',
      color: '#ffffff',
    },
    mintTitle: {
      fontSize: 28,
      fontFamily: 'OverpassBold',
      color: greys(theme)[0],
      textAlign: 'center',
      marginBottom: 4,
    },
    mintVersion: {
      fontSize: 14,
      color: greys(theme)[200],
      textAlign: 'center',
    },
    descriptionContainer: {
      marginHorizontal: 16,
      marginBottom: 16,
      padding: 16,
      backgroundColor: greys(theme)[8],
      borderRadius: 12,
      borderLeftWidth: 4,
      borderLeftColor: '#FFA726',
    },
    descriptionText: {
      fontSize: 14,
      color: greys(theme)[1],
      lineHeight: 20,
    },
    actionButton: {
      backgroundColor: greens[500],
      borderRadius: 8,
      marginVertical: 2,
    },
    destructiveButton: {
      backgroundColor: '#D32F2F',
      borderRadius: 8,
      marginVertical: 2,
    },
    actionText: {
      fontSize: 16,
      fontWeight: '600',
      color: greys(theme)[0],
      textAlign: 'center',
    },
    destructiveText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#ffffff',
      textAlign: 'center',
    },
    copiedText: {
      fontSize: 12,
      color: greens[400],
      fontWeight: '600',
    },
  });

export default MintDetailPage;
