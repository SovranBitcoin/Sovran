import React, { useCallback, useRef, useState, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { StyleSheet, ScrollView, Dimensions, VirtualizedList } from 'react-native';
import { View, HStack, VStack } from 'components/common/View';
import { Text } from 'components/common/Text';
import { useNostr } from 'helper/redux/nostr';
import { useCashu } from 'helper/redux/cashu';
import { formatCurrency } from 'helper/currency';
import Modal from 'components/layout/Modal';
import { VerifiedIcon } from 'assets/icons';
import { greys, Theme } from 'helper/colors';
import PagerView from 'react-native-pager-view';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import CachedImage from 'components/common/Image';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation } from 'helper/navigation';
import { Tabs } from 'components/common/Tabs';
import { maybeConvertNpub } from 'helper/cashuClient';
import { nip19 } from 'nostr-tools';
import { memoizedGetAllBalancesMultipleCurrencies } from 'helper/redux/cashu/selectors';

export function convertNpub(pubkey: string) {
  try {
    const npub = nip19.decode(pubkey);
    if (npub?.type === 'npub') return maybeConvertNpub(pubkey)?.slice(2);
  } catch {
    return pubkey;
  }
  return maybeConvertNpub(pubkey)?.slice(2);
}

const RenderContactItem = ({ item }: { item: any }) => {
  const { profiles } = useNostr();
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();
  const muted = item.profile?.muted;
  if (muted) return null;
  return (
    <ContactItem
      isVerified={profiles.some((profile) => profile.pubkey === item.pubkey)}
      contact={item}
      theme={theme}
      navigation={navigation}
    />
  );
};

const Section = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { profiles, search, currentProfile, messages, contacts } = useNostr();
  const { transactions } = useCashu();
  const [selectedTab, setSelectedTab] = useState('Recent activity');

  const filteredProfiles = profiles.filter((p) => p.pubkey !== currentProfile?.pubkey);
  const filteredSearch = search.filter((s) => s.pubkey !== currentProfile?.pubkey);

  const groupedTransactions = transactions
    .filter((t) => t?.nostr?.pubkey)
    .reduce((acc, transaction) => {
      const pubkey = convertNpub(transaction.nostr?.pubkey);
      acc[pubkey] = acc[pubkey] || { pubkey: pubkey, transactions: [] };
      acc[pubkey].transactions.push(transaction);
      return acc;
    }, {});

  const combinedSearchAndProfilesMap = new Map();

  filteredProfiles.forEach((profile) => {
    if (profile.pubkey) {
      combinedSearchAndProfilesMap.set(profile.pubkey, profile);
    }
  });

  filteredSearch
    .filter((group) => group.pubkey)
    .map((f) => ({ pubkey: f.pubkey, ...f.profile }))
    .filter(
      (profile) =>
        messages.some((m) => m.pubkey === profile.pubkey) ||
        transactions.some((t) => convertNpub(t.nostr?.pubkey) === profile.pubkey)
    )
    .forEach((profile) => {
      combinedSearchAndProfilesMap.set(profile.pubkey, profile);
    });

  contacts
    .map((f) => ({ pubkey: f.pubkey, ...f.profile }))
    .forEach((profile) => {
      combinedSearchAndProfilesMap.set(profile.pubkey, profile);
    });

  const combinedSearchAndProfiles = Array.from(combinedSearchAndProfilesMap.values());

  const groupedMessages = messages.reduce((acc, message) => {
    const { pubkey: pk, sender } = message;
    const pubkey = pk || sender;
    acc[pubkey] = acc[pubkey] || { pubkey, messages: [] };
    acc[pubkey].messages.push(message);
    return acc;
  }, {});

  const combinedGroups = {} as any;

  Object.values(groupedTransactions).forEach((group: any) => {
    if (!combinedGroups[group.pubkey]) {
      combinedGroups[group.pubkey] = { pubkey: group.pubkey, transactions: [], messages: [] };
    }
    combinedGroups[group.pubkey].transactions = [
      ...(combinedGroups[group.pubkey].transactions || []),
      ...(group.transactions || []),
    ];
  });

  Object.values(groupedMessages).forEach((group: any) => {
    if (!combinedGroups[group.pubkey]) {
      combinedGroups[group.pubkey] = { pubkey: group.pubkey, transactions: [], messages: [] };
    }
    combinedGroups[group.pubkey].messages = [
      ...(combinedGroups[group.pubkey].messages || []),
      ...(group.messages || []),
    ];
  });

  const enrichedContacts = Object.values(combinedGroups)
    .filter((group) => group.pubkey !== 'Unknown')
    .map((group) => ({
      pubkey: group.pubkey,
      profile: combinedSearchAndProfiles.find((p) => p.pubkey === group.pubkey) || {
        display_name: 'Unknown User',
      },
      transactions: (group.transactions || []).sort((a, b) => new Date(b.date) - new Date(a.date)),
      messages: (group.messages || []).sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      ),
    }))
    .sort((a, b) => {
      const dateA = new Date(a.transactions[0]?.date || a.messages[0]?.created_at);
      const dateB = new Date(b.transactions[0]?.date || b.messages[0]?.created_at);
      return dateB - dateA;
    });

  combinedSearchAndProfiles
    .filter((p) => !enrichedContacts.some((ec) => ec.pubkey === p.pubkey))
    .filter((profile) => {
      return profile.pubkey !== 'Unknown';
    })
    .forEach((profile) => {
      enrichedContacts.push({
        pubkey: profile.pubkey,
        profile,
        transactions: [],
        messages: [],
      });
    });

  const allBalances = useSelector(memoizedGetAllBalancesMultipleCurrencies);
  const mintInfo = useSelector((state: any) => state.cashu?.info || {});

  const mintsData = useMemo(() => {
    const uniqueMintUrls = [...new Set((allBalances || []).map((b: any) => b.mintUrl))];

    return uniqueMintUrls.map((mintUrl) => {
      const info = mintInfo[mintUrl] || {};
      const nostrContact = (info.contact || []).find(
        (c: any) => c.method && c.method.toLowerCase() === 'nostr'
      )?.info;
      let hostname;
      try {
        hostname = new URL(mintUrl).hostname;
      } catch {
        hostname = mintUrl;
      }

      const pubkey = nostrContact ? convertNpub(nostrContact) : undefined;
      const profile = (pubkey && combinedSearchAndProfiles.find((p) => p.pubkey === pubkey)) || {
        pubkey,
        picture: info.icon_url,
        image: info.icon_url,
        displayName: info.name || hostname,
        name: info.name || hostname,
      };

      return {
        mintUrl,
        pubkey: pubkey || `mint-${mintUrl}`,
        profile,
        transactions: [],
        messages: [],
      };
    });
  }, [allBalances, mintInfo, combinedSearchAndProfiles]);

  const pagerRef = useRef<PagerView>(null);

  const onPageSelected = useCallback((event: any) => {
    const pageIndex = event.nativeEvent.position;
    const tabNames = ['Recent activity', 'Contacts', 'Mints'];
    setSelectedTab(tabNames[pageIndex]);
  }, []);

  const handleTabPress = (tab: string, index: number) => {
    setSelectedTab(tab);
    pagerRef.current?.setPage(index);
  };

  const tabs = ['Recent activity', 'Contacts', 'Mints'].filter(Boolean);

  const getItem = (data: any, index: number) => data[index];

  const getItemCount = (data: any) => data.length;

  return (
    <Modal
      scrollEnabled={false}
      showBack={false}
      showHeader={false}
      buttons={null}
      childrenStyles={styles.modalContent}>
      <View
        style={{
          paddingHorizontal: 12,
        }}>
        <Tabs
          tabs={tabs}
          selectedTab={selectedTab}
          handleTabPress={handleTabPress}
          amounts={[
            String(enrichedContacts.length),
            String(contacts.length),
            String(mintsData.length),
          ]}
        />
      </View>
      <View
        style={{
          flex: 1,
          paddingLeft: 16,
          paddingRight: 16,
        }}>
        <PagerView
          ref={pagerRef}
          onPageSelected={onPageSelected}
          style={{
            height: Dimensions.get('window').height,
            backgroundColor: greys(theme)[950],
          }}
          initialPage={0}
          scrollEnabled={contacts.length > 0}>
          <ScrollView key="1">
            <VirtualizedList
              data={enrichedContacts}
              initialNumToRender={10}
              renderItem={(item) => <RenderContactItem {...item} />}
              keyExtractor={(item) => item.pubkey}
              getItemCount={getItemCount}
              getItem={getItem}
              style={{
                backgroundColor: greys(theme)[950],
                paddingBottom: 256,
              }}
            />
          </ScrollView>
          <ScrollView key="2">
            <VirtualizedList
              data={contacts}
              initialNumToRender={1}
              renderItem={(item) => <RenderContactItem {...item} />}
              keyExtractor={(item) => item.pubkey}
              getItemCount={getItemCount}
              getItem={getItem}
              style={{
                backgroundColor: greys(theme)[950],
                paddingBottom: 256,
              }}
            />
          </ScrollView>
          <ScrollView key="3">
            <VirtualizedList
              data={mintsData}
              initialNumToRender={5}
              renderItem={(item) => <RenderContactItem {...item} />}
              keyExtractor={(item) => item.pubkey || item.mintUrl}
              getItemCount={getItemCount}
              getItem={getItem}
              style={{
                backgroundColor: greys(theme)[950],
                paddingBottom: 256,
              }}
            />
          </ScrollView>
        </PagerView>
      </View>
    </Modal>
  );
};

export const SearchBar = ({ theme, navigation }: { theme: Theme; navigation: any }) => {
  const styles = createStyles(theme);
  return (
    <View>
      <View style={styles.searchBlurView}>
        <TouchableOpacity
          onPress={() => navigation.navigate('contacts', { unit: 'sat' })}
          style={styles.searchPressable}>
          <Text style={styles.searchPlaceholder}>Search for contacts</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const ContactItem = ({
  contact,
  isVerified,
  theme,
  navigation,
}: {
  contact: any;
  isVerified: boolean;
  theme: Theme;
  navigation: any;
}) => {
  const styles = createStyles(theme);

  const mostRecentTransaction = contact?.transactions?.[0];
  const mostRecentMessage = contact?.messages?.[0];

  const mostRecentActivity = mostRecentTransaction || mostRecentMessage;
  const formattedDate = mostRecentActivity
    ? formatCustomDate(new Date(mostRecentActivity.date || mostRecentActivity.created_at))
    : null;

  const previewText = mostRecentTransaction
    ? `You sent ${formatCurrency(
        {
          currency:
            mostRecentTransaction.unit === 'sat' ? 'BTC' : mostRecentTransaction.unit.toUpperCase(),
          value: mostRecentTransaction.amount,
          denomination: mostRecentTransaction.unit === 'sat' ? 'sats' : mostRecentTransaction.unit,
        },
        {
          locale: 'en-US',
          precision: mostRecentTransaction.unit === 'sat' ? 0 : 2,
          currencyDisplay: mostRecentTransaction.unit === 'sat' ? 'name' : 'symbol',
          denomination: mostRecentTransaction.unit === 'sat' ? 'sats' : mostRecentTransaction.unit,
        }
      )}`
    : mostRecentMessage
      ? mostRecentMessage.content
      : '';

  return (
    <TouchableOpacity
      style={styles.contactItem}
      onPress={() => {
        if (contact.profile) {
          navigation.navigate('userMessages', {
            pubkey: contact.profile?.pubkey,
            profile: contact.profile,
          });
        } else {
        }
      }}>
      <HStack align="center" justify="space-between" style={styles.row}>
        <HStack align="center">
          <ProfilePicture
            imageUri={contact.profile.picture || contact.profile.image}
            isVerified={isVerified}
            theme={theme}
          />
          <View style={styles.textContainer}>
            <Text style={styles.profileName}>
              {contact.profile?.displayName || contact.profile?.name || 'Unknown User'}
            </Text>
            <Text style={styles.previewText}>
              {previewText.length > 50
                ? `${previewText.slice(0, 50)}...`
                : previewText || 'No activity'}
            </Text>
          </View>
        </HStack>
        {formattedDate && <Text style={styles.date}>{formattedDate}</Text>}
      </HStack>
    </TouchableOpacity>
  );
};

const ProfilePicture = ({
  imageUri,
  isVerified,
  theme,
}: {
  imageUri: string;
  isVerified: boolean;
  theme: Theme;
}) => {
  const styles = createStyles(theme);
  return (
    <VStack style={styles.profilePictureContainer} align="center" justify="center">
      {isVerified && (
        <View style={styles.verifiedIconContainer}>
          <VerifiedIcon />
        </View>
      )}
      {imageUri ? (
        <CachedImage style={styles.profilePicture} source={{ uri: imageUri }} />
      ) : (
        <View style={styles.placeholderCircle} />
      )}
    </VStack>
  );
};

const TabOneScreen = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <View style={styles.container}>
      <Section />
    </View>
  );
};

const formatCustomDate = (date: Date) => {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: greys(theme)[950],
      margin: 0,
      flex: 1,
      paddingTop: 64 + 32,
    },
    modalContent: {
      padding: 0,
      paddingTop: 4,
    },
    searchBlurView: {
      marginTop: 64,
      marginLeft: 24,
      marginBottom: 8,
      height: 48,
      overflow: 'hidden',
    },
    searchPressable: {
      flex: 1,
      paddingRight: 30,
      color: greys(theme)[50], // Add text color
      backgroundColor: greys(theme)[800], // Add background color
      borderRadius: 16, // Add border radius for styling
      padding: 16, // Add padding
    },
    searchPlaceholder: {
      position: 'absolute',
      left: 16,
      top: 14,
      fontSize: 16,
      fontFamily: 'OverpassRegular',
      color: greys(theme)[500],
    },
    contactItem: {
      marginBottom: 8,
      marginTop: 8,
    },
    row: {
      flex: 1,
    },
    textContainer: {
      flex: 1,
    },
    profileName: {
      color: greys(theme)[0],
      fontFamily: 'OverpassBold',
      fontSize: 16,
    },
    date: {
      marginLeft: 8,
      color: greys(theme)[200],
      fontFamily: 'OverpassBold',
      fontSize: 16,
    },
    previewText: {
      color: greys(theme)[100],
      fontFamily: 'OverpassRegular',
      fontSize: 16,
      marginTop: 2,
    },
    profilePictureContainer: {
      position: 'relative',
      width: 48,
      height: 48,
      marginRight: 8,
    },
    verifiedIconContainer: {
      position: 'absolute',
      bottom: -4,
      right: -4,
      zIndex: 100,
      borderRadius: 100,
      height: 20,
      width: 20,
      backgroundColor: greys(theme)[800],
    },
    profilePicture: {
      width: 48,
      height: 48,
      borderRadius: 1000,
      borderColor: greys(theme)[600],
      borderWidth: 0.2,
    },
    placeholderCircle: {
      width: 48,
      height: 48,
      borderRadius: 1000,
      borderColor: greys(theme)[950],
      borderWidth: 0.2,
      backgroundColor: greys(theme)[600],
    },
  });

export default TabOneScreen;
