import { NDKEvent, NDKPrivateKeySigner, NDKUser, useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { Mint } from 'coco-cashu-core';
import { SearchResult } from 'components/blocks/contacts';
import { ContactItem } from 'components/blocks/payments';
import { DraggableContactsList } from 'components/blocks/payments/DraggableContactsList';
import { npubToPubkey } from 'components/blocks/Transaction';
import { ScrollableGradientOverlay } from 'components/ui/BackgroundView';
import { Tabs } from 'components/ui/Tabs';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { router } from 'expo-router';
import { searchUsers as apiSearchUsers, getRecommendedUsers, UserProfile } from 'helper/apiClient';
import { EncryptedDirectMessage } from 'nostr-tools/kinds';
import { useBackgroundConfig } from 'providers/BackgroundProvider';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useTheme } from 'providers/ThemeProvider';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View as RNView,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SkeletonContainer } from 'react-native-skeleton-component';
import { usePaymentsSearch } from './_layout';
import { LayoutDebugWrapper } from '../example';
import { NoResultsFound } from '@/components/blocks/contacts/NoResultsFound';
import { useMintManagement } from '@/hooks/coco/useMintManagement';
import { useSearchHistoryStore } from '@/stores/searchHistoryStore';
import { ProfilesCardFrame } from '@/components/blocks/payments/ProfilesCardFrame';
import opacity from 'hex-color-opacity';

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

// Memoized ContactItem to prevent unnecessary re-renders
const RenderItem = React.memo(({ item }: { item: any }) => {
  return <ContactItem item={item} />;
});

RenderItem.displayName = 'RenderItem';

// Memoized SearchResultItem to prevent unnecessary re-renders
const SearchResultItem = React.memo(
  ({
    result,
    loading,
    onPress,
  }: {
    result: DisplayResult;
    loading: boolean;
    onPress: (result: DisplayResult) => void;
  }) => {
    const handlePress = useCallback(() => {
      onPress(result);
    }, [result, onPress]);

    return <SearchResult loading={loading} result={result} onPress={handlePress} />;
  }
);

SearchResultItem.displayName = 'SearchResultItem';

// Default contacts that should always appear in Recent activity
const DEFAULT_CONTACTS = [
  {
    npub: 'npub1ref7jqxrh0z74554y900ufajer2lh52lk0wczrdrqcm8fjmjzweqll64x3',
    label: 'Sovran',
  },
  {
    npub: 'npub1ceel7z6ly287kz4mzqqcsgtc6nzc30zw2ru9w9e4gj64gw69f7qscyf0p8',
    label: 'kelbie',
  },
];

const PaymentsContent = () => {
  // Register this tab's background configuration
  useBackgroundConfig({ blurMode: 'full', backgroundOpacity: 0.25 });

  const { getPrimaryColor } = useTheme();
  const [selectedTab, setSelectedTab] = useState('Recent activity');

  // Convert default contact npubs to pubkeys (memoized for performance)
  const defaultContactPubkeys = useMemo(() => {
    return DEFAULT_CONTACTS.map((contact) => ({
      pubkey: npubToPubkey(contact.npub),
      label: contact.label,
    }));
  }, []);

  // Get search state from layout context
  const { searchQuery, isSearching } = usePaymentsSearch();

  // Search history store
  const addSearchToHistory = useSearchHistoryStore((state) => state.addSearch);

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

  // Recommended users state (currently unused, kept for future RecommendedUsers component)
  const [_recommendedUsers, setRecommendedUsers] = useState<UserProfile[]>([]);
  const [_recommendedLoading, setRecommendedLoading] = useState(false);

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
    if (!dmEvents || !nostrKeys?.pubkey) {
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
    return Array.from(contactMap.entries())
      .map(([pubkey, event]) => ({
        type: 'contact',
        pubkey,
        dmEvent: event,
        timestamp: event.created_at || 0,
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [dmEvents, nostrKeys?.pubkey]);

  // Merge default contacts with recent activity contacts
  const contactsWithDefaults = useMemo(() => {
    // Create a set of existing pubkeys from recent activity
    const existingPubkeys = new Set(recentActivityContacts.map((c) => c.pubkey));

    // Filter out default contacts that already exist in recent activity
    const defaultsToAdd = defaultContactPubkeys
      .filter((dc) => !existingPubkeys.has(dc.pubkey))
      .map((dc) => ({
        type: 'contact' as const,
        pubkey: dc.pubkey,
        dmEvent: null,
        timestamp: 0, // No timestamp for default contacts without messages
        isDefault: true,
      }));

    // Combine: recent activity first (sorted by time), then defaults at the end
    return [...recentActivityContacts, ...defaultsToAdd];
  }, [recentActivityContacts, defaultContactPubkeys]);

  // Decrypt DM events for contacts
  useEffect(() => {
    const decryptContacts = async () => {
      if (!contactsWithDefaults.length || !nostrKeys?.pubkey) {
        setDecryptedContacts([]);
        return;
      }

      try {
        setIsDecrypting(true);

        // Create a single signer instance to reuse
        const signer = new NDKPrivateKeySigner(nostrKeys.privateKey);

        // Decrypt sequentially to avoid race conditions with NDK's decrypt method
        const decryptedResults = [];
        for (const contact of contactsWithDefaults) {
          try {
            // Skip decryption for contacts without DM events (default contacts)
            if (!contact.dmEvent) {
              decryptedResults.push(contact);
              continue;
            }

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
          } catch {
            decryptedResults.push({
              ...contact,
              dmEvent: {
                ...contact.dmEvent,
                content: '[Encrypted message]', // Fallback for failed decryption
              },
            });
          }
        }

        setDecryptedContacts(decryptedResults);
      } catch (err) {
        console.error('Error decrypting contacts:', err);
        setDecryptedContacts(contactsWithDefaults);
      } finally {
        setIsDecrypting(false);
      }
    };

    decryptContacts();
  }, [contactsWithDefaults, nostrKeys?.pubkey, nostrKeys?.privateKey]);

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
    if (!dmEvents) {
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

    return mintsWithInfo.map(({ mint, mintInfo }) => {
      // Get pubkey from mint's nostr contact
      let mintPubkey = null;
      const nostrContact = mintInfo.contact?.find((contact: any) => contact.method === 'nostr');
      if (nostrContact?.info) {
        try {
          mintPubkey = npubToPubkey(nostrContact.info);
        } catch {
          // Failed to decode nostr contact from mint
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
          } catch {
            decryptedResults.push({
              ...mint,
              dmEvent: {
                ...mint.dmEvent,
                content: '[Encrypted message]', // Fallback for failed decryption
              },
            });
          }
        }

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

  // Fetch recommended users
  const fetchRecommendedUsers = useCallback(async () => {
    try {
      setRecommendedLoading(true);
      const result = await getRecommendedUsers({
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
  const searchUsers = useCallback(
    async (query: string) => {
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

            setSearchResults(formattedResults);

            // Save successful searches to history
            if (formattedResults.length > 0) {
              addSearchToHistory(query, 'payments');
            }
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
    },
    [addSearchToHistory]
  );

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

    // Immediately enter "searching" state so the UI doesn't flash recent searches
    // or stale results while we wait for the debounce window.
    setHasSearched(false);
    setSearchResults([]);
    setSearchLoading(true);

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

  // Generate placeholder results for the loading state (reduced from 20 to 6 for performance)
  const placeholderResults = useMemo<PlaceholderResult[]>(
    () =>
      Array(6)
        .fill(null)
        .map((_, index) => ({
          pubkey: `placeholder-${index}`,
        })),
    []
  );

  // Memoized computed values
  const displayResults: DisplayResult[] = useMemo(() => {
    // Keep the card height stable while the debounce/request is in-flight.
    if (searchLoading || !hasSearched) return placeholderResults;
    return searchResults;
  }, [hasSearched, placeholderResults, searchLoading, searchResults]);

  const showNoResults =
    searchQuery.trim().length > 0 && hasSearched && !searchLoading && searchResults.length === 0;

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

  // Match Recent activity / Mints card frame styling
  const primary50 = useMemo(() => getPrimaryColor('50'), [getPrimaryColor]);
  const accentColor = useMemo(() => getPrimaryColor('300'), [getPrimaryColor]);
  const borderColor = useMemo(() => opacity(accentColor, 0.3), [accentColor]);

  const navigateToProfile = useCallback(({ pubkey }: { pubkey: string }) => {
    router.navigate({
      pathname: '/(user-flow)/profile' as any,
      params: {
        pubkey: pubkey,
      },
    });
  }, []);

  // Handler for recommended user press (currently unused, kept for future RecommendedUsers component)
  const _handleRecommendedUserPress = useCallback(
    (user: UserProfile) => {
      navigateToProfile({
        pubkey: user.pubkey,
      });
    },
    [navigateToProfile]
  );

  // Memoized handler for search result press
  const handleSearchResultPress = useCallback(
    (result: DisplayResult) => {
      if (searchLoading || !result.profile) return;

      // Ensure the search header input is blurred before navigating,
      // otherwise iOS can keep/reopen the keyboard on the next screen.
      Keyboard.dismiss();

      // Let the dismiss propagate before route transition.
      requestAnimationFrame(() => {
        navigateToProfile({
          pubkey: result.pubkey,
        });
      });
    },
    [searchLoading, navigateToProfile]
  );

  // Dismiss keyboard when tapping outside
  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);

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

  // Fetch kind 0 (profile) events for all contacts including defaults
  const profileFilters = useMemo(() => {
    // Include default contact pubkeys to always fetch their profiles
    const defaultPubkeys = defaultContactPubkeys.map((dc) => dc.pubkey);

    const allPubkeys = [
      ...defaultPubkeys,
      ...decryptedContacts.map((item: any) => item.pubkey),
      ...decryptedMints.map((item: any) => item.pubkey),
    ].filter((pubkey): pubkey is string => !!pubkey);

    // Deduplicate pubkeys
    const uniquePubkeys = [...new Set(allPubkeys)];

    if (uniquePubkeys.length === 0) return null;

    return [
      {
        kinds: [0],
        authors: uniquePubkeys,
      },
    ];
  }, [decryptedContacts, decryptedMints, defaultContactPubkeys]);

  const { events: profileEvents, eose: profilesEose } = useSubscribe({
    filters: profileFilters,
  });

  // Loading state for profiles: true until we receive EOSE
  const isLoadingProfiles = !profilesEose;

  // Parse and map profile events to a more usable format
  const profilesMap = useMemo(() => {
    const map = new Map();
    profileEvents?.forEach((event) => {
      try {
        const profile = JSON.parse(event.content);
        map.set(event.pubkey, profile);
      } catch {
        // Failed to parse profile
      }
    });
    return map;
  }, [profileEvents]);

  // Use dynamic window dimensions for responsive layout
  const { height: windowHeight } = useWindowDimensions();

  // Get safe area insets for proper header spacing on all devices
  const insets = useSafeAreaInsets();

  // Header height accounts for the transparent header with search bar + safe area
  // Standard iOS nav bar (44px) + small buffer (12px) + top safe area inset
  const HEADER_HEIGHT = 56 + insets.top;

  return (
    <LayoutDebugWrapper scrollable={false}>
      {/* Gradient overlay for the entire page */}
      <ScrollableGradientOverlay contentHeight={windowHeight * 1.5} />

      <SafeAreaView className="flex-1" edges={['bottom']}>
        <SkeletonContainer
          backgroundColor={skeletonConfig.backgroundColor}
          highlightColor={skeletonConfig.highlightColor}
          speed={skeletonConfig.speed}
          animation={skeletonConfig.animation}>
          <View className="relative flex-1" style={{ paddingTop: HEADER_HEIGHT }}>
            {/* Tabs - Always render but hide with height when searching */}
            <View
              style={{
                paddingHorizontal: 12,
                height: isSearching ? 0 : 'auto',
                overflow: 'hidden',
                opacity: isSearching ? 0 : 1,
              }}>
              <Tabs
                tabs={tabs}
                selectedTab={selectedTab}
                handleTabPress={handleTabPress}
                amounts={[String(decryptedContacts.length), String(decryptedMints.length)]}
              />
            </View>

            {/* Search results overlay - positioned absolutely to avoid layout shifts */}
            {isSearching && (
              <Pressable style={{ flex: 1 }} onPress={dismissKeyboard}>
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.searchContainer}>
                  <View style={{ marginTop: 16, marginBottom: 12, paddingHorizontal: 16 }}>
                    <Text overpass bold size={14} style={{ color: getPrimaryColor('400') }}>
                      Search results
                    </Text>
                  </View>

                  <RNView style={[styles.card, { borderColor }]}>
                    <ProfilesCardFrame accentColor={accentColor} highlightColor={primary50}>
                      <View style={styles.cardContent} className="gap-4">
                        {showNoResults ? (
                          <NoResultsFound />
                        ) : (
                          displayResults.map((item) => (
                            <SearchResultItem
                              key={item.pubkey}
                              result={item}
                              loading={searchLoading || !hasSearched}
                              onPress={handleSearchResultPress}
                            />
                          ))
                        )}
                      </View>
                    </ProfilesCardFrame>
                  </RNView>
                </ScrollView>
              </Pressable>
            )}

            {/* Main content - PagerView for tabs - always rendered but hidden when searching */}
            {!isSearching && (
              <View
                style={{
                  flex: 1,
                }}>
                <PagerView
                  ref={pagerRef}
                  onPageSelected={onPageSelected}
                  style={{ flex: 1 }}
                  initialPage={0}
                  scrollEnabled={true}>
                  <View key="1" style={{ flex: 1 }}>
                    <DraggableContactsList
                      data={decryptedContacts}
                      profilesMap={profilesMap}
                      isDecrypting={isDecrypting}
                      isLoadingProfiles={isLoadingProfiles}
                      emptyMessage="No recent conversations found"
                    />
                  </View>
                  <View key="2" style={{ flex: 1 }}>
                    <DraggableContactsList
                      data={decryptedMints}
                      profilesMap={profilesMap}
                      isDecrypting={mintsLoadingInfo || isDecryptingMints}
                      isLoadingProfiles={isLoadingProfiles}
                      emptyMessage="No mints with nostr contacts found"
                    />
                  </View>
                </PagerView>
              </View>
            )}
          </View>
        </SkeletonContainer>
      </SafeAreaView>
    </LayoutDebugWrapper>
  );
};

export default PaymentsContent;

const styles = StyleSheet.create({
  searchContainer: {
    paddingBottom: 24,
  },
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    marginHorizontal: 16,
  },
  cardContent: {
    padding: 16,
    zIndex: 1,
  },
});
