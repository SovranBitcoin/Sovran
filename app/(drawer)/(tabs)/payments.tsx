import React, { useCallback, useRef, useState, useMemo, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { StyleSheet, ScrollView, Dimensions, VirtualizedList } from 'react-native';
import { View } from 'components/ui/View';
import { useNostr } from 'helper/redux/nostr';
// Removed useCashu - now using usePaginatedHistory directly
import Modal from 'components/blocks/Modal';
import { greys, Theme } from 'helper/colors';
import PagerView from 'react-native-pager-view';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useNavigation } from 'expo-router';
import { Tabs } from 'components/ui/Tabs';
import { useCashuUtilities, useMintManagement } from 'hooks/coco';
import { usePaginatedHistory } from 'coco-cashu-react';
import { nip19 } from 'nostr-tools';
import { ContactItem } from 'components/blocks/payments';

// This function is now defined inside the Section component to use the hook

const RenderContactItem = ({ item }: { item: any }) => {
  const { profiles } = useNostr();
  const theme = useSelector(memoizedGetTheme);
  const navigation = useNavigation();
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
  const { maybeConvertNpub } = useCashuUtilities();
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { profiles, search, currentProfile, messages, contacts } = useNostr();
  const { history: transactions } = usePaginatedHistory();
  const [selectedTab, setSelectedTab] = useState('Recent activity');

  const convertNpub = (pubkey: string) => {
    try {
      const npub = nip19.decode(pubkey);
      if (npub?.type === 'npub') return maybeConvertNpub(pubkey)?.slice(2);
    } catch {
      return pubkey;
    }
    return maybeConvertNpub(pubkey)?.slice(2);
  };

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

  const { getBalances, mints } = useMintManagement();
  const [allBalances, setAllBalances] = useState<any[]>([]);
  const [mintInfo, setMintInfo] = useState<any>({});

  // Load balances and mint info from Coco
  useEffect(() => {
    const loadData = async () => {
      try {
        const balanceData = await getBalances();

        // Convert Coco balance format to the expected format
        const formattedBalances = Object.entries(balanceData).map(([mintUrl, amount]) => ({
          mintUrl,
          amount: amount || 0,
          unit: 'sat', // Default unit
        }));

        setAllBalances(formattedBalances);

        // Convert mints to mintInfo format
        const infoData: any = {};
        mints.forEach((mint) => {
          infoData[mint.mintUrl] = mint.mintInfo || {};
        });
        setMintInfo(infoData);
      } catch (error) {
        console.error('Failed to load balances:', error);
        setAllBalances([]);
        setMintInfo({});
      }
    };

    loadData();
  }, [getBalances, mints]);

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

const TabOneScreen = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <View style={styles.container}>
      <Section />
    </View>
  );
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
  });

export default TabOneScreen;
