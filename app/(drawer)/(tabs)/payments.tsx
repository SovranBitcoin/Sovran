import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { Dimensions } from 'react-native';
import Modal from 'components/blocks/Modal';
import PagerView from 'react-native-pager-view';
import { useTheme } from 'providers/ThemeProvider';
import { Tabs } from 'components/ui/Tabs';
import { ContactItem } from 'components/blocks/payments';
import { Spacer, View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { useMintManagement } from 'hooks/coco';
import { Mint } from 'coco-cashu-core';
import { npubToPubkey } from 'components/blocks/Transaction';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { EncryptedDirectMessage } from 'nostr-tools/kinds';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { LegendList } from '@legendapp/list';

// Memoized ContactItem to prevent unnecessary re-renders
const RenderItem = React.memo(({ item }: { item: any }) => {
  console.log(`[PERF] Rendering ContactItem for ${item.type}:${item.pubkey || item.mint?.mintUrl}`);
  return <ContactItem item={item} />;
});

RenderItem.displayName = 'RenderItem';

const TabOneScreen = () => {
  const { getPrimaryColor } = useTheme();
  const [selectedTab, setSelectedTab] = useState('Recent activity');
  const { mints, loadMints, getMintInfo } = useMintManagement();
  const { keys: nostrKeys } = useNostrKeysContext();

  // State for mint info data
  const [mintsWithInfo, setMintsWithInfo] = useState<{ mint: Mint; mintInfo: any }[]>([]);
  const [mintsLoadingInfo, setMintsLoadingInfo] = useState(false);

  // Get all DM events for the current user (single subscription)
  const dmFilters = useMemo(() => {
    if (!nostrKeys?.pubkey) return null;

    return [
      {
        kinds: [EncryptedDirectMessage],
        authors: [nostrKeys.pubkey],
      },
      {
        kinds: [EncryptedDirectMessage],
        '#p': [nostrKeys.pubkey],
      },
    ];
  }, [nostrKeys?.pubkey]);

  const { events: dmEvents } = useSubscribe({ filters: dmFilters });

  // State for decrypted contacts
  const [decryptedContacts, setDecryptedContacts] = useState<any[]>([]);
  const [isDecrypting, setIsDecrypting] = useState(false);

  // Extract unique pubkeys from DM events and create contact list
  const recentActivityContacts = useMemo(() => {
    console.log('[PERF] Computing recentActivityContacts...');
    const startTime = performance.now();

    if (!dmEvents || !nostrKeys?.pubkey) {
      console.log('[PERF] No dmEvents or nostrKeys, returning empty array');
      return [];
    }

    // Group events by pubkey
    const contactMap = new Map();

    dmEvents.forEach((event) => {
      // Determine the other person's pubkey
      const otherPubkey =
        event.pubkey === nostrKeys.pubkey
          ? event.tags.find((tag) => tag[0] === 'p')?.[1]
          : event.pubkey;

      if (!otherPubkey) return;

      // Keep the most recent event for each contact
      const existing = contactMap.get(otherPubkey);
      if (!existing || (event.created_at && event.created_at > existing.created_at)) {
        contactMap.set(otherPubkey, event);
      }
    });

    // Convert map to array and sort by most recent
    const result = Array.from(contactMap.entries())
      .map(([pubkey, event]) => ({
        type: 'contact',
        pubkey,
        dmEvent: event,
        timestamp: event.created_at || 0,
      }))
      .sort((a, b) => b.timestamp - a.timestamp);

    const endTime = performance.now();
    console.log(
      `[PERF] recentActivityContacts computed in ${endTime - startTime}ms, found ${result.length} contacts`
    );
    return result;
  }, [dmEvents, nostrKeys?.pubkey]);

  // Decrypt DM events for contacts
  useEffect(() => {
    const decryptContacts = async () => {
      if (!recentActivityContacts.length || !nostrKeys?.pubkey) {
        setDecryptedContacts([]);
        return;
      }

      try {
        setIsDecrypting(true);
        console.log('[PERF] Starting contact decryption...');
        const startTime = performance.now();

        const decryptedResults = await Promise.all(
          recentActivityContacts.map(async (contact) => {
            try {
              if (contact.dmEvent) {
                // Decrypt the message content
                await contact.dmEvent.decrypt();
                return {
                  ...contact,
                  dmEvent: {
                    ...contact.dmEvent,
                    content: contact.dmEvent.content, // Now decrypted
                  },
                };
              }
              return contact;
            } catch (error) {
              console.warn(`Failed to decrypt message for contact ${contact.pubkey}:`, error);
              return {
                ...contact,
                dmEvent: {
                  ...contact.dmEvent,
                  content: '[Encrypted message]', // Fallback for failed decryption
                },
              };
            }
          })
        );

        const endTime = performance.now();
        console.log(`[PERF] Contact decryption completed in ${endTime - startTime}ms`);
        setDecryptedContacts(decryptedResults);
      } catch (error) {
        console.error('Error decrypting contacts:', error);
        setDecryptedContacts(recentActivityContacts);
      } finally {
        setIsDecrypting(false);
      }
    };

    decryptContacts();
  }, [recentActivityContacts, nostrKeys?.pubkey]);

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

  // State for decrypted mints
  const [decryptedMints, setDecryptedMints] = useState<any[]>([]);
  const [isDecryptingMints, setIsDecryptingMints] = useState(false);

  // Build mints with most recent DM
  const mintsWithMetadata = useMemo(() => {
    console.log('[PERF] Computing mintsWithMetadata...');
    const startTime = performance.now();

    if (!dmEvents) {
      console.log('[PERF] No dmEvents, returning empty array');
      return [];
    }

    // Create a map of most recent DMs by pubkey
    const dmMap = new Map();
    dmEvents?.forEach((event) => {
      const otherPubkey =
        event.pubkey === nostrKeys?.pubkey
          ? event.tags.find((tag) => tag[0] === 'p')?.[1]
          : event.pubkey;

      if (!otherPubkey) return;

      const existing = dmMap.get(otherPubkey);
      if (!existing || (event.created_at && event.created_at > existing.created_at)) {
        dmMap.set(otherPubkey, event);
      }
    });

    const result = mintsWithInfo.map(({ mint, mintInfo }) => {
      // Get pubkey from mint's nostr contact
      let mintPubkey = null;
      const nostrContact = mintInfo.contact?.find((contact: any) => contact.method === 'nostr');
      if (nostrContact?.info) {
        try {
          mintPubkey = npubToPubkey(nostrContact.info);
        } catch (error) {
          console.warn('Failed to decode nostr contact from mint:', error);
        }
      }

      return {
        type: 'mint',
        pubkey: mintPubkey,
        mint,
        mintInfo,
        dmEvent: mintPubkey ? dmMap.get(mintPubkey) : undefined,
        timestamp: mintPubkey ? dmMap.get(mintPubkey)?.created_at || 0 : 0,
      };
    });

    const endTime = performance.now();
    console.log(
      `[PERF] mintsWithMetadata computed in ${endTime - startTime}ms, found ${result.length} mints`
    );
    return result;
  }, [mintsWithInfo, dmEvents, nostrKeys?.pubkey]);

  // Decrypt DM events for mints
  useEffect(() => {
    const decryptMints = async () => {
      if (!mintsWithMetadata.length || !nostrKeys?.pubkey) {
        setDecryptedMints([]);
        return;
      }

      try {
        setIsDecryptingMints(true);
        console.log('[PERF] Starting mint decryption...');
        const startTime = performance.now();

        const decryptedResults = await Promise.all(
          mintsWithMetadata.map(async (mint) => {
            try {
              if (mint.dmEvent) {
                // Decrypt the message content
                await mint.dmEvent.decrypt();
                return {
                  ...mint,
                  dmEvent: {
                    ...mint.dmEvent,
                    content: mint.dmEvent.content, // Now decrypted
                  },
                };
              }
              return mint;
            } catch (error) {
              console.warn(`Failed to decrypt message for mint ${mint.mint?.mintUrl}:`, error);
              return {
                ...mint,
                dmEvent: {
                  ...mint.dmEvent,
                  content: '[Encrypted message]', // Fallback for failed decryption
                },
              };
            }
          })
        );

        const endTime = performance.now();
        console.log(`[PERF] Mint decryption completed in ${endTime - startTime}ms`);
        setDecryptedMints(decryptedResults);
      } catch (error) {
        console.error('Error decrypting mints:', error);
        setDecryptedMints(mintsWithMetadata);
      } finally {
        setIsDecryptingMints(false);
      }
    };

    decryptMints();
  }, [mintsWithMetadata, nostrKeys?.pubkey]);

  const pagerRef = useRef<PagerView>(null);

  const onPageSelected = useCallback((event: any) => {
    const pageIndex = event.nativeEvent.position;
    const tabNames = ['Recent activity', 'Mints'];
    setSelectedTab(tabNames[pageIndex]);
  }, []);

  const handleTabPress = (tab: string, index: number) => {
    setSelectedTab(tab);
    pagerRef.current?.setPage(index);
  };

  const tabs = ['Recent activity', 'Mints'];

  // Constants for LegendList
  const ITEM_HEIGHT = 80; // Approximate height of ContactItem

  return (
    <View className="flex-1 bg-primary-950">
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
            amounts={[String(decryptedContacts.length), String(decryptedMints.length)]}
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
            scrollEnabled={true}>
            <View key="1" style={{ flex: 1 }}>
              {isDecrypting ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Text style={{ color: getPrimaryColor('400') }}>Decrypting messages...</Text>
                </View>
              ) : decryptedContacts.length === 0 ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Text style={{ color: getPrimaryColor('400') }}>
                    No recent conversations found
                  </Text>
                </View>
              ) : (
                <LegendList
                  data={decryptedContacts}
                  estimatedItemSize={ITEM_HEIGHT}
                  renderItem={({ item }) => <RenderItem item={item} />}
                  keyExtractor={(item) => item.pubkey}
                  style={{
                    backgroundColor: getPrimaryColor('950'),
                    flex: 1,
                  }}
                  contentContainerStyle={{ paddingBottom: 256 }}
                  maintainVisibleContentPosition
                />
              )}
            </View>
            <View key="2" style={{ flex: 1 }}>
              {mintsLoadingInfo || isDecryptingMints ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Text style={{ color: getPrimaryColor('400') }}>
                    {mintsLoadingInfo ? 'Loading mints...' : 'Decrypting messages...'}
                  </Text>
                </View>
              ) : decryptedMints.length === 0 ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Text style={{ color: getPrimaryColor('400') }}>
                    No mints with nostr contacts found
                  </Text>
                </View>
              ) : (
                <LegendList
                  data={decryptedMints}
                  estimatedItemSize={ITEM_HEIGHT}
                  renderItem={({ item }) => <RenderItem item={item} />}
                  keyExtractor={(item) => item.mint.mintUrl}
                  style={{
                    backgroundColor: getPrimaryColor('950'),
                    flex: 1,
                  }}
                  contentContainerStyle={{ paddingBottom: 256 }}
                  maintainVisibleContentPosition
                />
              )}
            </View>
          </PagerView>
        </View>
      </Modal>
    </View>
  );
};

export default TabOneScreen;
