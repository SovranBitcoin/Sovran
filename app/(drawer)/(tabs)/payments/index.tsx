import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import PagerView from 'react-native-pager-view';
import { useTheme } from 'providers/ThemeProvider';
import { Tabs } from 'components/ui/Tabs';
import { ContactItem } from 'components/blocks/payments';
import { View, VStack } from 'components/ui/View';
import { useMintManagement } from 'hooks/coco';
import { Mint } from 'coco-cashu-core';
import { npubToPubkey } from 'components/blocks/Transaction';
import { NDKEvent, NDKPrivateKeySigner, NDKUser, useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { EncryptedDirectMessage } from 'nostr-tools/kinds';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import {
  PaymentsAnimationProvider,
  usePaymentsAnimation,
} from 'providers/PaymentsAnimationProvider';
import { AnimatedSearchBar } from 'components/blocks/payments/AnimatedSearchBar';
import { CancelButton } from 'components/blocks/payments/CancelButton';
import { DraggableContactsList } from 'components/blocks/payments/DraggableContactsList';
import { Dimensions, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AnimatedBlur } from '@/components/blocks/payments/AnimatedBlur';
import { SkeletonContainer } from 'react-native-skeleton-component';
import { store } from 'redux/store';
import { setSearch } from 'redux/nostr';
import { searchUsers as apiSearchUsers, getRecommendedUsers, UserProfile } from 'helper/apiClient';
import { SearchResult } from 'components/blocks/contacts';
import { NoResultsFound } from 'components/blocks/contacts/NoResultsFound';
import { RecommendedUsers } from 'components/blocks/contacts/RecommendedUsers';
import { router } from 'expo-router';
import { Text } from 'components/ui/Text';

// Memoized ContactItem to prevent unnecessary re-renders
const RenderItem = React.memo(({ item }: { item: any }) => {
  console.log(`[PERF] Rendering ContactItem for ${item.type}:${item.pubkey || item.mint?.mintUrl}`);
  return <ContactItem item={item} />;
});

RenderItem.displayName = 'RenderItem';

// Define proper types
interface SearchResultData {
  pubkey: string;
  profile: UserProfile;
}

interface PlaceholderResult {
  pubkey: string;
  profile?: undefined;
}

type DisplayResult = SearchResultData | PlaceholderResult;

const PaymentsContent = () => {
  usePaymentsAnimation();
  const { getPrimaryColor } = useTheme();
  const [selectedTab, setSelectedTab] = useState('Recent activity');
  const { mints, loadMints, getMintInfo } = useMintManagement();
  const { keys: nostrKeys } = useNostrKeysContext();

  // State for mint info data
  const [mintsWithInfo, setMintsWithInfo] = useState<{ mint: Mint; mintInfo: any }[]>([]);
  const [mintsLoadingInfo, setMintsLoadingInfo] = useState(false);

  // Search-related state
  const [searchResults, setSearchResults] = useState<SearchResultData[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Recommended users state
  const [recommendedUsers, setRecommendedUsers] = useState<UserProfile[]>([]);
  const [recommendedLoading, setRecommendedLoading] = useState(false);

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

        // Create a single signer instance to reuse
        const signer = new NDKPrivateKeySigner(nostrKeys.privateKey);

        // Decrypt sequentially to avoid race conditions with NDK's decrypt method
        const decryptedResults = [];
        for (const contact of recentActivityContacts) {
          try {
            if (contact.dmEvent instanceof NDKEvent) {
              // Decrypt the message content
              // Use contact.pubkey (the other party) not dmEvent.pubkey
              // because dmEvent.pubkey could be our own pubkey if we sent it
              const counterparty = new NDKUser({ pubkey: contact.pubkey });
              await contact.dmEvent.decrypt(counterparty, signer);
              decryptedResults.push({
                ...contact,
                dmEvent: {
                  ...contact.dmEvent,
                  content: contact.dmEvent.content, // Now decrypted
                },
              });
            } else {
              decryptedResults.push(contact);
            }
          } catch (error) {
            console.warn(`Failed to decrypt message for contact ${contact.pubkey}:`, error);
            decryptedResults.push({
              ...contact,
              dmEvent: {
                ...contact.dmEvent,
                content: '[Encrypted message]', // Fallback for failed decryption
              },
            });
          }
        }

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
  }, [recentActivityContacts, nostrKeys?.pubkey, nostrKeys?.privateKey]);

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

        // Create a single signer instance to reuse
        const signer = new NDKPrivateKeySigner(nostrKeys.privateKey);

        // Decrypt sequentially to avoid race conditions with NDK's decrypt method
        const decryptedResults = [];
        for (const mint of mintsWithMetadata) {
          try {
            if (mint.dmEvent && mint.pubkey) {
              // Decrypt the message content
              // Use mint.pubkey (the mint's nostr pubkey) not dmEvent.pubkey
              // because dmEvent.pubkey could be our own pubkey if we sent it
              const counterparty = new NDKUser({ pubkey: mint.pubkey });
              await mint.dmEvent.decrypt(counterparty, signer);
              decryptedResults.push({
                ...mint,
                dmEvent: {
                  ...mint.dmEvent,
                  content: mint.dmEvent.content, // Now decrypted
                },
              });
            } else {
              decryptedResults.push(mint);
            }
          } catch (error) {
            console.warn(`Failed to decrypt message for mint ${mint.mint?.mintUrl}:`, error);
            decryptedResults.push({
              ...mint,
              dmEvent: {
                ...mint.dmEvent,
                content: '[Encrypted message]', // Fallback for failed decryption
              },
            });
          }
        }

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
  }, [mintsWithMetadata, nostrKeys?.pubkey, nostrKeys?.privateKey]);

  const pagerRef = useRef<PagerView>(null);
  const { searchQuery, currentView } = usePaymentsAnimation();
  // Fetch recommended users
  const fetchRecommendedUsers = useCallback(async () => {
    try {
      setRecommendedLoading(true);
      const result = await getRecommendedUsers({
        // source: nostrKeys?.pubkey,
        limit: 10,
        sort: 'globalPagerank',
      });

      if (result.isOk()) {
        setRecommendedUsers(result.value.results);
      } else {
        console.error('Error fetching recommended users:', result.error);
        setRecommendedUsers([]);
      }
    } catch (error) {
      console.error('Unexpected error fetching recommended users:', error);
      setRecommendedUsers([]);
    } finally {
      setRecommendedLoading(false);
    }
  }, []);

  // Search functionality
  const searchUsers = useCallback(async (query: string) => {
    if (!query.trim()) return;

    setSearchLoading(true);
    setHasSearched(true);

    try {
      const result = await apiSearchUsers({ query, limit: 10 });

      if (result.isOk()) {
        const data = result.value;

        if (data.results && Array.isArray(data.results)) {
          const formattedResults: SearchResultData[] = data.results.map((res) => {
            const profileEventPubkey = JSON.parse(res.profileEvent).pubkey;

            return {
              pubkey: res.pubkey,
              profile: {
                ...res,
                pubkey: profileEventPubkey,
              },
            };
          });

          // Store all results in Redux
          if (formattedResults.length > 0) {
            formattedResults.forEach((result) => {
              store.dispatch(setSearch({ pubkey: result.pubkey, profile: result.profile }));
            });
          }

          setSearchResults(formattedResults);
        } else {
          setSearchResults([]);
        }
      } else {
        console.error('Error searching users:', result.error);
        setSearchResults([]);
      }
    } catch (error) {
      console.error('Unexpected error during search:', error);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // Debounced search handler
  useEffect(() => {
    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Reset state if search is cleared
    if (!searchQuery.trim()) {
      setHasSearched(false);
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    // Debounce the search
    debounceTimeoutRef.current = setTimeout(() => {
      searchUsers(searchQuery);
    }, 500);

    // Cleanup function
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [searchQuery, searchUsers]);

  // Fetch recommended users on mount
  useEffect(() => {
    fetchRecommendedUsers();
  }, [fetchRecommendedUsers]);

  // Generate placeholder results for the loading state
  const placeholderResults = useMemo<PlaceholderResult[]>(
    () =>
      Array(20)
        .fill(null)
        .map((_, index) => ({
          pubkey: `placeholder-${index}`,
        })),
    []
  );

  // Memoized computed values
  const displayResults: DisplayResult[] = useMemo(
    () => (searchLoading ? placeholderResults : searchResults),
    [searchLoading, placeholderResults, searchResults]
  );

  const showSearchResults =
    searchQuery.trim().length > 0 && (searchLoading || searchResults.length > 0);
  const showNoResults =
    searchQuery.trim().length > 0 && hasSearched && !searchLoading && searchResults.length === 0;
  const isSearchMode = currentView === 'search';

  // Skeleton configuration
  const skeletonConfig = useMemo(
    () => ({
      backgroundColor: getPrimaryColor('800'),
      highlightColor: getPrimaryColor('600'),
      speed: 800,
      animation: searchLoading ? ('pulse' as const) : ('none' as const),
    }),
    [getPrimaryColor, searchLoading]
  );

  const navigateToUserMessages = useCallback(
    ({ pubkey, profile }: { pubkey: string; profile: UserProfile }) => {
      router.push({
        pathname: '/userMessages',
        params: {
          pubkey: pubkey,
          profile: JSON.stringify(profile),
        },
      });
    },
    []
  );

  const handleRecommendedUserPress = useCallback(
    (user: UserProfile) => {
      navigateToUserMessages({
        pubkey: user.pubkey,
        profile: user,
      });
    },
    [navigateToUserMessages]
  );

  // Debug logging
  console.log('PaymentsContent render:', {
    decryptedContactsLength: decryptedContacts?.length || 0,
    decryptedMintsLength: decryptedMints?.length || 0,
    isDecrypting,
    mintsLoadingInfo,
    isDecryptingMints,
    selectedTab,
    searchQuery,
    searchLoading,
    searchResultsLength: searchResults.length,
    currentView,
    isSearchMode,
  });

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

  // Fetch kind 0 (profile) events for all contacts
  const profileFilters = useMemo(() => {
    const allPubkeys = [...decryptedContacts, ...decryptedMints]
      .map((item: any) => item.pubkey)
      .filter((pubkey): pubkey is string => !!pubkey);

    console.log('[DEBUG payments.tsx] Requesting profiles for pubkeys:', allPubkeys.length);
    console.log(
      '[DEBUG payments.tsx] First 5 pubkeys:',
      allPubkeys.slice(0, 5).map((p) => p.slice(0, 8))
    );

    if (allPubkeys.length === 0) return null;

    return [
      {
        kinds: [0],
        authors: allPubkeys,
      },
    ];
  }, [decryptedContacts, decryptedMints]);

  const { events: profileEvents, eose: profilesEose } = useSubscribe({
    filters: profileFilters,
  });

  // Loading state for profiles: true until we receive EOSE
  const isLoadingProfiles = !profilesEose;

  // DEBUG: Log raw profile events
  console.log('[DEBUG payments.tsx] profileEvents count:', profileEvents?.length || 0);
  console.log(
    '[DEBUG payments.tsx] First 3 profile events:',
    profileEvents?.slice(0, 3).map((e) => ({
      pubkey: e.pubkey,
      content: e.content,
      kind: e.kind,
    }))
  );

  // Parse and map profile events to a more usable format
  const profilesMap = useMemo(() => {
    const map = new Map();
    profileEvents?.forEach((event) => {
      try {
        const profile = JSON.parse(event.content);
        map.set(event.pubkey, profile);
        console.log(
          `[DEBUG payments.tsx] Parsed profile for ${event.pubkey.slice(0, 8)}:`,
          profile
        );
      } catch (error) {
        console.warn(`Failed to parse profile for ${event.pubkey}:`, error);
      }
    });
    console.log('[DEBUG payments.tsx] profilesMap size:', map.size);
    console.log(
      '[DEBUG payments.tsx] profilesMap keys:',
      Array.from(map.keys()).map((k) => k.slice(0, 8))
    );
    return map;
  }, [profileEvents]);

  return (
    <SafeAreaView className="flex-1 bg-primary-900">
      <SkeletonContainer
        backgroundColor={skeletonConfig.backgroundColor}
        highlightColor={skeletonConfig.highlightColor}
        speed={skeletonConfig.speed}
        animation={skeletonConfig.animation}>
        <View className="relative flex-1 bg-primary-900">
          {/* Search Bar and Cancel Button */}
          <View
            style={{
              flexDirection: 'row',
              height: 48,
              zIndex: 1001,
            }}>
            <AnimatedSearchBar />
            <CancelButton />
          </View>

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
              }}
              initialPage={0}
              scrollEnabled={true}>
              <View key="1" style={{ flex: 1 }}>
                <DraggableContactsList
                  data={decryptedContacts}
                  profilesMap={profilesMap}
                  isDecrypting={isDecrypting}
                  isLoadingProfiles={isLoadingProfiles}
                  emptyMessage="No recent conversations found"
                  itemHeight={ITEM_HEIGHT}
                />
              </View>
              <View key="2" style={{ flex: 1 }}>
                <DraggableContactsList
                  data={decryptedMints}
                  profilesMap={profilesMap}
                  isDecrypting={mintsLoadingInfo || isDecryptingMints}
                  isLoadingProfiles={isLoadingProfiles}
                  emptyMessage="No mints with nostr contacts found"
                  itemHeight={ITEM_HEIGHT}
                />
              </View>
            </PagerView>
          </View>

          {/* Search results overlay */}
          <View
            style={{
              position: 'absolute',
              top: 48,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 1000,
              paddingVertical: 8,
              pointerEvents: isSearchMode ? 'auto' : 'none',
            }}
            onStartShouldSetResponder={() => {
              console.log('[DEBUG overlay] onStartShouldSetResponder, isSearchMode:', isSearchMode);
              return true;
            }}>
            <ScrollView pointerEvents={isSearchMode ? 'auto' : 'none'}>
              {/* Recommended Users - Always show, but in different layouts */}
              <RecommendedUsers
                users={recommendedUsers}
                onUserPress={handleRecommendedUserPress}
                loading={recommendedLoading}
                isSearching={searchLoading}
              />

              {/* Search Results */}
              {showSearchResults && (
                <View
                  style={{
                    flex: 1,
                    borderRadius: 12,
                    marginTop: 16,
                  }}
                  onStartShouldSetResponder={() => true}
                  onTouchEnd={(e) => e.stopPropagation()}>
                  <View className="mx-4 mb-4">
                    <Text overpass bold size={14} style={{ color: getPrimaryColor('400') }}>
                      Search results
                    </Text>
                  </View>
                  <VStack spacing={12}>
                    {displayResults.map((result) => (
                      <SearchResult
                        key={result.pubkey}
                        loading={searchLoading}
                        result={result}
                        onPress={() => {
                          if (!searchLoading && result.profile) {
                            navigateToUserMessages({
                              pubkey: result.pubkey,
                              profile: result.profile,
                            });
                          }
                        }}
                      />
                    ))}
                  </VStack>
                </View>
              )}

              {/* No Results Found */}
              {showNoResults && <NoResultsFound />}
            </ScrollView>
          </View>
          <AnimatedBlur />
        </View>
      </SkeletonContainer>
    </SafeAreaView>
  );
};

const TabOneScreen = () => {
  return (
    <PaymentsAnimationProvider>
      <PaymentsContent />
    </PaymentsAnimationProvider>
  );
};

export default TabOneScreen;
