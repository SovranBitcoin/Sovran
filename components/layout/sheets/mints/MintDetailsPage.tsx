import React from 'react';
import { Linking, ActivityIndicator, ScrollView, Alert, StyleSheet } from 'react-native';
import { Spacer, View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { greens, greys, Theme } from 'helper/colors';
import Wrapper from '../wrapper';
import { RowButton, Section } from 'app/settings';
import { useSheetRouteParams, useSheetRouter } from 'react-native-actions-sheet';
import { useWallet } from 'helper/cashuClient';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Card } from 'components/common/Card';
import { useSelector } from 'react-redux';
import Heatmap from 'components/layout/Heatmap';
import Icon, { CurrencyIcon } from 'assets/icons';
import { memoizedGetTheme } from 'helper/redux/settings';
import { truncateMiddle } from 'helper/strings';
import * as Clipboard from 'expo-clipboard';
import { useTypedNavigation } from 'helper/navigation';
import { npubToPubkey } from 'components/layout/Transaction';

const MintDetailPage = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const router = useSheetRouter('mint');
  const params = useSheetRouteParams();
  const navigation = useTypedNavigation();

  const { wallet, loading, error } = useWallet({
    mintUrl: params?.mintUrl,
    forceRefresh: true,
    profile: null,
    unit: null,
  });

  const handleCopy = async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
    } catch {
      Alert.alert('Error', 'Failed to copy to clipboard');
    }
  };

  const handleContactPress = (method: string, info: string) => {
    switch (method) {
      case 'email':
        Linking.openURL(`mailto:${info}`);
        break;
      case 'twitter':
      case 'x':
        Linking.openURL(`https://x.com/${info.replace('@', '')}`);
        break;
      case 'nostr':
        navigation.navigate('userMessages', {
          pubkey: npubToPubkey(info),
        });
        router?.close();
        break;
      default:
        handleCopy(info);
    }
  };

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
  // const allowSetAsNPC = // reason: we want to allow websockets for the npubx.cash, otherwise it just complicates the codebase.
  //   mintInfo?.nuts?.['17']?.supported?.[0]?.commands?.includes('bolt11_mint_quote');

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

        {/* Description Card */}
        {mintInfo.description && (
          <>
            <Card variant="info" message={mintInfo.description} />
            <Spacer size={12} />
          </>
        )}

        {/* Long Description */}
        {mintInfo.description_long && (
          <>
            <Card variant="warning" message={mintInfo.description_long} />
            <Spacer size={12} />
          </>
        )}

        {/* Message of the Day */}
        {mintInfo.motd && (
          <>
            <Card variant="warning" message={`Message: ${mintInfo.motd}`} />
            <Spacer size={12} />
          </>
        )}

        {/* Contact Section */}
        {mintInfo.contact && mintInfo.contact.length > 0 && (
          <Section title="Contact">
            {mintInfo.contact.map((contact: any, index: number) => (
              <RowButton
                isFirst={index === 0}
                key={index}
                label={
                  contact.method.toUpperCase() === 'NOSTR' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <CurrencyIcon colors={[greys(theme)[400]]} width={20} currency={'nostr'} />
                      <Text style={{ marginLeft: 8, color: greys(theme)[50] }} bold>
                        {truncateMiddle(contact.info, 10)}
                      </Text>
                    </View>
                  ) : ['X', 'TWITTER'].includes(contact.method.toUpperCase()) ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Icon name="hugeicons:new-twitter" size={20} color={greys(theme)[400]} />
                      <Text style={{ marginLeft: 8, color: greys(theme)[50] }} bold>
                        {contact.info}
                      </Text>
                    </View>
                  ) : contact.method.toUpperCase() === 'EMAIL' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Icon name="mdi:at" size={20} color={greys(theme)[400]} />
                      <Text style={{ marginLeft: 8, color: greys(theme)[50] }} bold>
                        {contact.info}
                      </Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={{ marginLeft: 8, color: greys(theme)[50] }} bold>
                        {contact.info}
                      </Text>
                    </View>
                  )
                }
                onPress={() => handleContactPress(contact.method, contact.info)}
              />
            ))}
          </Section>
        )}
      </ScrollView>
    </Wrapper>
  );
};

const createStyles = (theme: Theme) =>
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
      color: greys(theme)[200],
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
      color: greys(theme)[200],
      textAlign: 'center',
    },
    headerContainer: {
      alignItems: 'center',
      paddingVertical: 24,
      paddingBottom: 32,
    },
    actionButton: {
      backgroundColor: greens[300],
      borderRadius: 8,
      marginVertical: 2,
    },
    actionText: {
      fontSize: 16,
      fontWeight: '600',
      color: greys(theme)[0],
      textAlign: 'center',
    },
  });

export default MintDetailPage;
