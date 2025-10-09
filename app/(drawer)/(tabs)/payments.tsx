import React, { useCallback, useRef, useState, useEffect } from 'react';
import { ScrollView, Dimensions, VirtualizedList } from 'react-native';
import Modal from 'components/blocks/Modal';
import PagerView from 'react-native-pager-view';
import { useTheme } from 'providers/ThemeProvider';
import { Tabs } from 'components/ui/Tabs';
import { ContactItem } from 'components/blocks/payments';
import { Spacer, View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { useMintManagement } from 'hooks/coco';
import { Mint } from 'coco-cashu-core';
import { useNostr } from 'redux/nostr';
import { usePaginatedHistory } from 'coco-cashu-react';
import { npubToPubkey } from 'components/blocks/Transaction';
import _ from 'lodash';

const RenderItem = ({
  item,
  allMessages = [],
  allTransactions: _allTransactions = [],
}: {
  item: any;
  allMessages?: any[];
  allTransactions?: any[];
}) => {
  // Handle contact items (from search/contacts)
  if (item.pubkey && item.profile) {
    // Filter messages for this specific contact
    const contactMessages = _.filter(allMessages, (message) => {
      return (
        message.pubkey === item.pubkey ||
        message.sender === item.pubkey ||
        message.receiver === item.pubkey
      );
    });

    // Sort by created_at to get the most recent
    const mostRecentMessage = _.maxBy(contactMessages, 'created_at');

    const muted = item.profile?.muted;
    if (muted) return null;

    return <ContactItem mostRecentMessage={mostRecentMessage} nostrInfo={item.profile} />;
  }

  // Handle mint items (from mints)
  if (item.mint && item.mintInfo) {
    // Find the most recent message for this mint
    // First, try to get the nostr pubkey from the mint's nostr contact
    let mintPubkey = null;
    const nostrContact = item.mintInfo.contact?.find((contact: any) => contact.method === 'nostr');
    if (nostrContact?.info) {
      try {
        // Convert npub to pubkey using existing utility
        mintPubkey = npubToPubkey(nostrContact.info);
      } catch (error) {
        console.warn('Failed to decode nostr contact from mint:', error);
      }
    }

    // Find messages for this mint's pubkey
    const mintMessages = mintPubkey
      ? allMessages.filter((message) => {
          return (
            message.pubkey === mintPubkey ||
            message.sender === mintPubkey ||
            message.receiver === mintPubkey
          );
        })
      : [];

    const mostRecentMessage = _.maxBy(mintMessages, 'created_at');

    return (
      <ContactItem
        mostRecentMessage={mostRecentMessage}
        mintInfo={item.mintInfo}
        mintUrl={item.mint.mintUrl}
      />
    );
  }

  // Fallback for unknown item types
  return null;
};

const TabOneScreen = () => {
  const { getPrimaryColor } = useTheme();
  const [selectedTab, setSelectedTab] = useState('Recent activity');
  const { mints, loadMints, getMintInfo } = useMintManagement();
  const { search, contacts, messages: allMessages } = useNostr();
  const { history: allTransactions } = usePaginatedHistory();

  // State for mint info data
  const [mintsWithInfo, setMintsWithInfo] = useState<{ mint: Mint; mintInfo: any }[]>([]);
  const [mintsLoadingInfo, setMintsLoadingInfo] = useState(false);

  // Use only added contacts for Contacts tab
  const allContacts = contacts;

  // Filter contacts with messages for Recent Activity
  const enrichedContacts = search.filter((contact) => {
    const contactMessages = allMessages.filter((message) => {
      return (
        message.pubkey === contact.pubkey ||
        message.sender === contact.pubkey ||
        message.receiver === contact.pubkey
      );
    });
    return !_.isEmpty(contactMessages);
  });

  // Remove duplicates based on pubkey
  const uniqueEnrichedContacts = _.uniqBy(enrichedContacts, 'pubkey');

  // Sort by most recent message (newest first)
  const sortedEnrichedContacts = _.orderBy(
    uniqueEnrichedContacts,
    [
      (contact) => {
        const contactMessages = allMessages.filter((message) => {
          return (
            message.pubkey === contact.pubkey ||
            message.sender === contact.pubkey ||
            message.receiver === contact.pubkey
          );
        });
        return _.maxBy(contactMessages, 'created_at')?.created_at || 0;
      },
    ],
    ['desc']
  );

  // Debug logging
  console.log('Payments Debug:', {
    searchLength: search.length,
    contactsLength: contacts.length,
    enrichedContactsLength: enrichedContacts.length,
    uniqueEnrichedContactsLength: uniqueEnrichedContacts.length,
    sortedEnrichedContactsLength: sortedEnrichedContacts.length,
    allMessagesLength: allMessages.length,
    searchContacts: search.map((s) => ({
      pubkey: s.pubkey,
      name: s.profile?.display_name || s.profile?.name,
    })),
    sampleMessages: allMessages.slice(0, 3).map((m) => ({
      pubkey: m.pubkey,
      sender: m.sender,
      receiver: m.receiver,
      content: m.content?.substring(0, 30),
    })),
  });

  // Load mints and their info on component mount
  useEffect(() => {
    const loadMintsData = async () => {
      try {
        setMintsLoadingInfo(true);
        await loadMints();
      } catch (error) {
        console.error('Failed to load mints:', error);
      } finally {
        setMintsLoadingInfo(false);
      }
    };

    loadMintsData();
  }, [loadMints]);

  // Load mint info for each mint and filter for nostr contacts
  useEffect(() => {
    const loadMintInfo = async () => {
      if (mints.length === 0) return;

      try {
        setMintsLoadingInfo(true);
        const mintsWithInfo = await Promise.all(
          mints.map(async (mint) => {
            try {
              const mintInfo = await getMintInfo(mint.mintUrl);
              return { mint, mintInfo };
            } catch (error) {
              console.error(`Failed to get mint info for ${mint.mintUrl}:`, error);
              return { mint, mintInfo: null };
            }
          })
        );

        // Filter mints that have nostr contact info
        const mintsWithNostr = mintsWithInfo.filter(({ mintInfo }) => {
          if (!mintInfo?.contact) return false;

          const nostrContact = mintInfo.contact.find((contact: any) => contact.method === 'nostr');
          return nostrContact?.info && nostrContact.info.startsWith('npub1');
        });

        setMintsWithInfo(mintsWithNostr);
      } catch (error) {
        console.error('Failed to load mint info:', error);
      } finally {
        setMintsLoadingInfo(false);
      }
    };

    if (mints.length > 0) {
      loadMintInfo();
    }
  }, [mints, getMintInfo]);

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
    <View className="bg-primary-950 flex-1">
      <Spacer size={96} />
      <Modal scrollEnabled={false} showBack={false} showHeader={false} buttons={null}>
        <View
          style={{
            paddingHorizontal: 12,
          }}>
          <Tabs
            tabs={tabs}
            selectedTab={selectedTab}
            handleTabPress={handleTabPress}
            amounts={[
              String(sortedEnrichedContacts.length),
              String(allContacts.length),
              String(mintsWithInfo.length),
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
              backgroundColor: getPrimaryColor('950'),
            }}
            initialPage={0}
            scrollEnabled={contacts.length > 0}>
            <ScrollView key="1">
              <VirtualizedList
                data={sortedEnrichedContacts}
                initialNumToRender={10}
                renderItem={(item) => (
                  <RenderItem
                    {...item}
                    allMessages={allMessages}
                    allTransactions={allTransactions}
                  />
                )}
                keyExtractor={(item) => item.pubkey}
                getItemCount={getItemCount}
                getItem={getItem}
                style={{
                  backgroundColor: getPrimaryColor('950'),
                  paddingBottom: 256,
                }}
              />
            </ScrollView>
            <ScrollView key="2">
              <VirtualizedList
                data={allContacts}
                initialNumToRender={1}
                renderItem={(item) => (
                  <RenderItem
                    {...item}
                    allMessages={allMessages}
                    allTransactions={allTransactions}
                  />
                )}
                keyExtractor={(item) => item.pubkey}
                getItemCount={getItemCount}
                getItem={getItem}
                style={{
                  backgroundColor: getPrimaryColor('950'),
                  paddingBottom: 256,
                }}
              />
            </ScrollView>
            <ScrollView key="3">
              {mintsLoadingInfo ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Text style={{ color: getPrimaryColor('400') }}>Loading mints...</Text>
                </View>
              ) : mintsWithInfo.length === 0 ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Text style={{ color: getPrimaryColor('400') }}>
                    No mints with nostr contacts found
                  </Text>
                </View>
              ) : (
                <VirtualizedList
                  data={mintsWithInfo}
                  initialNumToRender={5}
                  renderItem={(item) => (
                    <RenderItem
                      {...item}
                      allMessages={allMessages}
                      allTransactions={allTransactions}
                    />
                  )}
                  keyExtractor={(item) => item.mint.mintUrl}
                  getItemCount={getItemCount}
                  getItem={getItem}
                  style={{
                    backgroundColor: getPrimaryColor('950'),
                    paddingBottom: 256,
                  }}
                />
              )}
            </ScrollView>
          </PagerView>
        </View>
      </Modal>
    </View>
  );
};

export default TabOneScreen;
