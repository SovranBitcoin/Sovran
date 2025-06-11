import { useState } from 'react';
import { Linking, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { Text, View } from 'components/common/Themed';
import { greens, greys } from 'helper/colors';
import Wrapper from '../wrapper';
import { RowButton, Section } from 'app/settings';
import { useSheetRouteParams, useSheetRouter } from 'react-native-actions-sheet';
import { useWallet } from 'helper/cashu/wallet';
import { StyleSheet } from 'react-native';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Card } from 'components/common/Card';
import Image from 'components/common/Image';
import { useSelector } from 'react-redux';
import { NCSDK } from 'helper/third-party/cashu-address-sdk-rn/sdk';
import { NsecSigner } from 'helper/third-party/cashu-address-sdk-rn/signer';
import { nip19 } from 'nostr-tools';
import Heatmap from 'components/layout/Heatmap';
import Icon, { CurrencyIcon } from 'assets/icons';
import { Canvas, Path, Skia, Group } from '@shopify/react-native-skia';
import { memoizedGetTheme } from 'helper/redux/settings';
import { truncateMiddle } from 'helper/strings';
import * as Clipboard from 'expo-clipboard';
import { showSuccess } from 'helper/popup/popups';
import { useTypedNavigation } from 'helper/navigation';
import { npubToPubkey } from 'components/layout/Transaction';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';

const MintDetailPage = (props) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const router = useSheetRouter('mint');
  const params = useSheetRouteParams();
  const [copiedItem, setCopiedItem] = useState(null);
  const navigation = useTypedNavigation();

  const { wallet, loading, error } = useWallet({
    mintUrl: params?.mintUrl,
  });

  const handleCopy = async (text, itemName) => {
    try {
      await Clipboard.setStringAsync(text);
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
        navigation.navigate('userMessages', {
          pubkey: npubToPubkey(info),
        });
        break;
      default:
        handleCopy(info, 'Contact Info');
    }
  };

  const currentProfile = useSelector(memoizedGetCurrentProfile);

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
  const allowSetAsNPC = // reason: we want to allow websockets for the npubx.cash, otherwise it just complicates the codebase.
    mintInfo?.nuts?.['17']?.supported?.[0]?.commands?.includes('bolt11_mint_quote');

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
          <Heatmap mintInfo={mintInfo} mintUrl={params?.mintUrl} wallet={wallet} />
        </View>

        {/* pill tags */}
        {/* <View style={{}}>
          <View
            style={{
              flexDirection: 'row',
              paddingVertical: 8,
              paddingHorizontal: 8,
              backgroundColor: greys(theme)[1800],
              borderRadius: 12,
              borderWidth: 0.5,
              borderColor: greys(theme)[1500],
              alignItems: 'center',
              marginRight: 8,
              marginBottom: 8,
            }}>
            <Icon name="material-symbols:update-rounded" size={24} color={greys(theme)[700]} />
            <Text style={{ color: greys(theme)[700], marginLeft: 8 }} bold size={16}>
              Realtime Updates
            </Text>
          </View>

          <View
            style={{
              flexDirection: 'row',
              paddingVertical: 8,
              paddingHorizontal: 8,
              backgroundColor: greys(theme)[1800],
              borderRadius: 12,
              borderWidth: 0.5,
              borderColor: greys(theme)[1500],
              alignItems: 'center',
              marginRight: 8,
              marginBottom: 8,
            }}>
            <Icon name="ic:round-cloud-sync" size={24} color={greys(theme)[700]} />
            <Text style={{ color: greys(theme)[700], marginLeft: 8 }} bold size={16}>
              Restore Money
            </Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              paddingVertical: 8,
              paddingHorizontal: 8,
              backgroundColor: greys(theme)[1800],
              borderRadius: 12,
              borderWidth: 0.5,
              borderColor: greys(theme)[1500],
              alignItems: 'center',
              marginRight: 8,
              marginBottom: 8,
            }}>
            <Icon name="uil:invoice" size={24} color={greys(theme)[700]} />
            <Text style={{ color: greys(theme)[700], marginLeft: 8 }} bold size={16}>
              Payment Requests
            </Text>
          </View>

          <View
            style={{
              flexDirection: 'row',
              paddingVertical: 8,
              paddingHorizontal: 8,
              backgroundColor: greys(theme)[1800],
              borderRadius: 12,
              borderWidth: 0.5,
              borderColor: greys(theme)[1500],
              alignItems: 'center',
              marginRight: 8,
              marginBottom: 8,
            }}>
            <Icon name="ic:round-cloud-sync" size={24} color={greys(theme)[700]} />
            <Text style={{ color: greys(theme)[700], marginLeft: 8 }} bold size={16}>
              Restore Money
            </Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              paddingVertical: 8,
              paddingHorizontal: 8,
              backgroundColor: greys(theme)[1800],
              borderRadius: 12,
              borderWidth: 0.5,
              borderColor: greys(theme)[1500],
              alignItems: 'center',
              marginRight: 8,
              marginBottom: 8,
            }}>
            <Icon name="solar:key-bold" size={24} color={greys(theme)[700]} />
            <Text style={{ color: greys(theme)[700], marginLeft: 8 }} bold size={16}>
              P2PK
            </Text>
          </View>
        </View> */}

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
                label={
                  contact.method.toUpperCase() === 'NOSTR' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <CurrencyIcon colors={[greys(theme)[700]]} width={20} currency={'nostr'} />
                      <Text style={{ marginLeft: 8, color: greys(theme)[100] }} bold>
                        {truncateMiddle(contact.info, 10)}
                      </Text>
                    </View>
                  ) : contact.method.toUpperCase() === 'TWITTER' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Icon name="prime:twitter" size={20} color={greys(theme)[700]} />
                      <Text style={{ marginLeft: 8, color: greys(theme)[100] }} bold>
                        {contact.info}
                      </Text>
                    </View>
                  ) : contact.method.toUpperCase() === 'EMAIL' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Icon name="mdi:at" size={20} color={greys(theme)[700]} />
                      <Text style={{ marginLeft: 8, color: greys(theme)[100] }} bold>
                        {contact.info}
                      </Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={{ marginLeft: 8, color: greys(theme)[100] }} bold>
                        {contact.info}
                      </Text>
                    </View>
                  )
                }
                // label={<Icon name="prime:twitter" size={24} color={greys(theme)[700]} />}
                // label={contact.method.toUpperCase()}
                // sublabel={contact.method.toUpperCase()}
                onPress={() => handleContactPress(contact.method, contact.info)}
              />
            ))}
          </Section>
        )}

        {/* Mint Details Section */}
        {/* <Section title="Mint Details">
          <RowButton label="Version" value={mintInfo.version || 'Unknown'} />
        </Section> */}

        {/* Actions Section */}
        <Section title="Actions">
          {allowSetAsNPC && (
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
          )}
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
    container2: {
      position: 'relative',
      justifyContent: 'center',
      alignItems: 'center',
    },
    centerContent2: {
      position: 'absolute',
      justifyContent: 'center',
      alignItems: 'center',
    },
  });

export default MintDetailPage;
