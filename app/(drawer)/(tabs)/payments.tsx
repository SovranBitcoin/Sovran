import React, { useCallback, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { StyleSheet, ScrollView, Dimensions, VirtualizedList } from 'react-native';
import { Text, View } from 'components/common/Themed';
import { useNostr } from 'helper/redux/nostr';
import { useCashu } from 'helper/redux/cashu';
import { formatCurrency } from 'helper/currency';
import Modal from 'components/layout/Modal';
import { VerifiedIcon } from 'assets/icons';
import { greys } from 'helper/colors';
import opacity from 'hex-color-opacity';
import PagerView from 'react-native-pager-view';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import CachedImage from 'components/common/Image';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation } from 'helper/navigation';
import { LNVPN_PUBKEY } from '../../vpnCheckout';
import { sovran } from 'components/layout/sheets/mints';
import { Tabs } from 'components/common/Tabs';

const Section = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useTypedNavigation();
  const { profiles, search, currentProfile, messages, follows } = useNostr();
  const { transactions } = useCashu();
  const [selectedTab, setSelectedTab] = useState('Recent activity');
  const [following, setFollowing] = useState([]);

  const filteredProfiles = profiles.filter((p) => p.pubkey !== currentProfile?.pubkey);
  const filteredSearch = search.filter((s) => s.pubkey !== currentProfile?.pubkey);

  const groupedTransactions = transactions
    .filter((t) => t?.nostr?.pubkey)
    .reduce((acc, transaction) => {
      const { pubkey } = transaction.nostr;
      acc[pubkey] = acc[pubkey] || { pubkey, transactions: [] };
      acc[pubkey].transactions.push(transaction);
      return acc;
    }, {});

  const combinedSearchAndProfiles = [
    ...filteredProfiles,
    ...filteredSearch
      .filter((group) => group.pubkey)
      .map((f) => ({ pubkey: f.pubkey, ...f.profile }))
      .filter(
        (profile) =>
          messages.some((m) => m.pubkey === profile.pubkey) ||
          transactions.some((t) => t.nostr?.pubkey === profile.pubkey) ||
          profile.pubkey === '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2' ||
          profile.pubkey === LNVPN_PUBKEY
      )
      .filter(
        (profile, index, self) => index === self.findIndex((t) => t.pubkey === profile.pubkey)
      ),
    ...following.map((f) => ({ pubkey: f.pubkey, ...f.profile })),
  ];

  const groupedMessages = messages.reduce((acc, message) => {
    const { pubkey: pk, sender } = message;
    const pubkey = pk || sender;
    acc[pubkey] = acc[pubkey] || { pubkey, messages: [] };
    acc[pubkey].messages.push(message);
    return acc;
  }, {});

  const enrichedContacts = Object.values({
    ...groupedTransactions,
    ...groupedMessages,
  })
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

  const pagerRef = useRef(null);

  const onPageSelected = useCallback((event) => {
    const pageIndex = event.nativeEvent.position;
    const tabNames = ['Recent activity', 'Following'];
    setSelectedTab(tabNames[pageIndex]);
  }, []);

  const handleTabPress = (tab, index) => {
    setSelectedTab(tab);
    pagerRef.current?.setPage(index);
  };

  const tabs = ['Recent activity', 'Following'].filter(Boolean);

  const getItem = (data, index) => data[index];

  const getItemCount = (data) => data.length;

  const renderContactItem = ({ item }) => (
    <ContactItem
      isVerified={
        profiles.some((profile) => profile.pubkey === item.pubkey) ||
        item.pubkey === '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2' ||
        item.pubkey === LNVPN_PUBKEY
      }
      contact={item}
      theme={theme}
      navigation={navigation}
    />
  );

  return (
    <Modal showBack={false} showHeader={false} buttons={null} childrenStyles={styles.modalContent}>
      <View
        style={{
          paddingHorizontal: 16,
        }}>
        <Tabs tabs={tabs} selectedTab={selectedTab} handleTabPress={handleTabPress} />
      </View>
      <View
        style={{
          flex: 1,
          paddingLeft: 16,
          paddingRight: 16,
          backgroundColor: 'transparent',
        }}>
        <PagerView
          ref={pagerRef}
          onPageSelected={onPageSelected}
          style={{
            height: Dimensions.get('window').height - 265,
            backgroundColor: 'transparent',
            marginHorizontal: -16,
          }}
          initialPage={0}
          scrollEnabled={follows.length > 0}>
          <ScrollView
            key="1"
            style={{
              flex: 1,
              backgroundColor: greys(theme)[2300],
              padding: 16,
              height: '100%',
              overflow: 'hidden',
            }}>
            <VirtualizedList
              data={enrichedContacts}
              initialNumToRender={10}
              renderItem={renderContactItem}
              keyExtractor={(item) => item.pubkey}
              getItemCount={getItemCount}
              getItem={getItem}
              style={{
                backgroundColor: greys(theme)[2300],
              }}
            />
          </ScrollView>
          <ScrollView
            key="2"
            style={{
              flex: 1,
              backgroundColor: greys(theme)[2300],
              padding: 16,
              height: '100%',
              overflow: 'hidden',
            }}>
            <VirtualizedList
              data={follows}
              initialNumToRender={1}
              renderItem={renderContactItem}
              keyExtractor={(item) => item.pubkey}
              getItemCount={getItemCount}
              getItem={getItem}
              style={{
                backgroundColor: greys(theme)[2300],
              }}
            />
          </ScrollView>
        </PagerView>
      </View>
    </Modal>
  );
};

export const SearchBar = ({ theme, navigation }) => {
  const styles = createStyles(theme);
  return (
    <View style={styles.searchContainer}>
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

const ContactList = ({ enrichedContacts, filteredProfiles, theme, navigation }) => {
  const styles = createStyles(theme);
  return (
    <View style={styles.contactsContainer}>
      {enrichedContacts.map((p) => (
        <ContactItem
          key={p.pubkey}
          contact={p}
          isVerified={filteredProfiles.some((profile) => profile.pubkey === p.pubkey)}
          theme={theme}
          navigation={navigation}
        />
      ))}
    </View>
  );
};

const ContactItem = ({ contact, isVerified, theme, navigation }) => {
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
          navigation.navigate('userMessages', { pubkey: contact.pubkey, profile: contact.profile });
        } else {
        }
      }}>
      <ProfilePicture
        imageUri={contact.profile.picture || contact.profile.image}
        isVerified={isVerified}
        theme={theme}
      />
      <View style={styles.row}>
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
        {formattedDate && <Text style={styles.date}>{formattedDate}</Text>}
      </View>
    </TouchableOpacity>
  );
};

const ProfilePicture = ({ imageUri, isVerified, theme }) => {
  const styles = createStyles(theme);
  return (
    <View style={styles.profilePictureContainer}>
      {isVerified && (
        <View style={styles.verifiedIconContainer}>
          <VerifiedIcon fill={greys(theme)[100]} />
        </View>
      )}
      {imageUri ? (
        <CachedImage style={styles.profilePicture} source={{ uri: imageUri }} />
      ) : (
        <View style={styles.placeholderCircle} />
      )}
    </View>
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

const formatCustomDate = (date) => {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
};

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: 'black',
      flexDirection: 'column',
      margin: 0,
      flex: 1,
    },
    modalContent: {
      padding: 0,
      paddingTop: 4,
    },
    searchContainer: {
      backgroundColor: 'transparent',
    },
    searchBlurView: {
      borderRadius: 86,
      margin: 16,
      marginBottom: 8,
      height: 38,
      overflow: 'hidden',
    },
    searchPressable: {
      backgroundColor: opacity(greys(theme)[1800], 0.75),
      borderWidth: 0.5,
      borderColor: greys(theme)[1300],
      shadowColor: greys(theme)[2300],
      shadowOffset: { width: 1, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      padding: 8,
      paddingLeft: 16,
      width: '100%',
      height: '100%',
      borderRadius: 86,
    },
    searchPlaceholder: {
      position: 'absolute',
      left: 16,
      top: 10,
      fontSize: 14,
      fontFamily: 'OverpassRegular',
      color: greys(theme)[1000],
    },
    tabContainer: {
      flexDirection: 'row',
      backgroundColor: 'transparent',
    },
    tabButton: {
      padding: 10,
      fontFamily: 'OverpassHeavy',
      // paddingLeft: 16,
      // paddingRight: 16,
      // backgroundColor: greys(theme)[2300],
      borderRadius: 24,
      // marginRight: 8,
      // borderWidth: 0.5,
      // borderColor: greys(theme)[1300],
    },
    selectedTabButton: {
      backgroundColor: greys(theme)[1300],
      borderWidth: 0,
      borderRadius: 1000,
      borderColor: greys(theme)[1300],
    },
    tabText: {
      color: greys(theme)[200],
      fontFamily: 'OverpassSemibold',
      fontSize: 14,
      textAlign: 'center',
    },
    selectedTabText: {
      color: greys(theme)[0],
      fontFamily: 'OverpassHeavy',
    },
    contactsContainer: {
      backgroundColor: greys(theme)[1800],
      borderColor: greys(theme)[1300],
      borderWidth: 0.2,
      margin: 16,
      padding: 16,
      marginTop: 8,
      marginBottom: 8,
      borderRadius: 16,
    },
    contactItem: {
      flexDirection: 'row',
      backgroundColor: 'transparent',
      alignItems: 'center',
      marginBottom: 8,
      marginTop: 8,
    },
    row: {
      backgroundColor: 'transparent',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flex: 1,
    },
    textContainer: {
      backgroundColor: 'transparent',
      flex: 1,
    },
    profileName: {
      color: greys(theme)[0],
      fontFamily: 'OverpassBold',
      fontSize: 16,
    },
    transactionInfo: {
      color: greys(theme)[200],
    },
    date: {
      marginLeft: 8,
      color: greys(theme)[400],
      fontFamily: 'OverpassBold',
      fontSize: 16,
    },
    previewText: {
      color: greys(theme)[200],
      fontFamily: 'OverpassRegular',
      fontSize: 16,
      marginTop: 2,
    },
    profilePictureContainer: {
      position: 'relative',
      width: 48,
      height: 48,
      backgroundColor: 'transparent',
      marginRight: 8,
      justifyContent: 'center',
      alignItems: 'center',
    },
    verifiedIconContainer: {
      position: 'absolute',
      bottom: -4,
      right: -4,
      zIndex: 100,
      borderRadius: 100,
      height: 20,
      width: 20,
      backgroundColor: greys(theme)[1800],
    },
    profilePicture: {
      width: 48,
      height: 48,
      borderRadius: 1000,
      borderColor: greys(theme)[1300],
      borderWidth: 0.2,
    },
    placeholderCircle: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderColor: greys(theme)[2300],
      borderWidth: 0.2,
      backgroundColor: greys(theme)[1300],
    },
  });

export default TabOneScreen;
