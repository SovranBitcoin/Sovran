import { NDKEvent, NDKPrivateKeySigner, NDKUser, useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { unwrapGiftWrap } from 'utils/nip17';
import { Mint } from 'coco-cashu-core';
import { SearchResult } from 'components/blocks/contacts';
import { DraggableContactsList } from 'components/blocks/payments/DraggableContactsList';
import { npubToPubkey } from 'helper/nostrClient';
import { ScrollableGradientOverlay } from 'components/ui/BackgroundView';
import { Tabs } from 'components/ui/Tabs';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { router } from 'expo-router';
import { searchUsers as apiSearchUsers, UserProfile } from 'helper/apiClient';
import { EncryptedDirectMessage } from 'nostr-tools/kinds';
import { useBackgroundConfig } from 'providers/BackgroundProvider';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useThemeColor } from '@/hooks/useThemeColor';
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
import { BlurCardFrame } from 'components/ui/BlurCardFrame';
import opacity from 'hex-color-opacity';
import { prefetchImages } from '@/helper/imageCache';

interface SearchResultData {
  pubkey: string;
  profile: UserProfile;
}

interface PlaceholderResult {
  pubkey: string;
  profile?: undefined;
}

type DisplayResult = SearchResultData | PlaceholderResult;

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

const PLACEHOLDER_RESULTS: PlaceholderResult[] = Array.from({ length: 6 }, (_, i) => ({
  pubkey: `placeholder-${i}`,
}));

const TABS = ['Recent activity', 'Mints'];

/**
 * Decrypt NIP-04 DM events for a list of items sharing { pubkey, dmEvent, nip17Content? }.
 * NIP-17 messages are already decrypted during unwrapping and passed through via nip17Content.
 */
async function decryptNip04Events<
  T extends { pubkey: string | null; dmEvent?: any; nip17Content?: string },
>(items: T[], privateKey: Uint8Array): Promise<T[]> {
  const signer = new NDKPrivateKeySigner(privateKey);
  const results: T[] = [];

  for (const item of items) {
    try {
      if (item.nip17Content !== undefined) {
        results.push({ ...item, dmEvent: { content: item.nip17Content } });
        continue;
      }
      if (!item.dmEvent || !item.pubkey) {
        results.push(item);
        continue;
      }
      if (item.dmEvent instanceof NDKEvent) {
        const counterparty = new NDKUser({ pubkey: item.pubkey });
        await item.dmEvent.decrypt(counterparty, signer);
        results.push({ ...item, dmEvent: { ...item.dmEvent, content: item.dmEvent.content } });
      } else {
        results.push(item);
      }
    } catch {
      results.push({ ...item, dmEvent: { ...item.dmEvent, content: '[Encrypted message]' } });
    }
  }
  return results;
}

const PaymentsContent = () => {
  useBackgroundConfig({ blurMode: 'full', backgroundOpacity: 0.25 });

  const [foreground, muted, defaultColor, surfaceSecondary] = useThemeColor([
    'foreground',
    'muted',
    'default',
    'surface-secondary',
  ] as const);
  const [selectedTab, setSelectedTab] = useState('Recent activity');

  const defaultContactPubkeys = useMemo(
    () =>
      DEFAULT_CONTACTS.map((contact) => ({
        pubkey: npubToPubkey(contact.npub),
        label: contact.label,
      })),
    []
  );

  const { searchQuery, isSearching } = usePaymentsSearch();
  const addSearchToHistory = useSearchHistoryStore((state) => state.addSearch);
  const { mints, getMintInfo } = useMintManagement();
  const { keys: nostrKeys } = useNostrKeysContext();

  const [mintsWithInfo, setMintsWithInfo] = useState<{ mint: Mint; mintInfo: any }[]>([]);
  const [mintInfoLoading, setMintInfoLoading] = useState(false);

  const [searchResults, setSearchResults] = useState<SearchResultData[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // NIP-04 DM subscription
  const dmFilters = useMemo(() => {
    if (!nostrKeys?.pubkey) return null;
    return [
      { kinds: [EncryptedDirectMessage], authors: [nostrKeys.pubkey] },
      { kinds: [EncryptedDirectMessage], '#p': [nostrKeys.pubkey] },
    ];
  }, [nostrKeys?.pubkey]);

  const { events: dmEvents } = useSubscribe({ filters: dmFilters });

  // NIP-17 gift-wrap subscription
  const giftWrapFilters = useMemo(() => {
    if (!nostrKeys?.pubkey) return null;
    return [{ kinds: [1059 as number], '#p': [nostrKeys.pubkey] }];
  }, [nostrKeys?.pubkey]);

  const { events: giftWrapEvents } = useSubscribe({ filters: giftWrapFilters });

  const unwrappedDMs = useMemo(() => {
    if (!giftWrapEvents?.length || !nostrKeys?.privateKey) return [];
    return giftWrapEvents
      .map((event) => {
        const unwrapped = unwrapGiftWrap(
          { content: event.content, pubkey: event.pubkey },
          nostrKeys.privateKey
        );
        if (!unwrapped) return null;
        return { ...unwrapped, wrapId: event.id };
      })
      .filter((dm): dm is NonNullable<typeof dm> => dm !== null);
  }, [giftWrapEvents, nostrKeys?.privateKey]);

  const [decryptedContacts, setDecryptedContacts] = useState<any[]>([]);
  const [isDecrypting, setIsDecrypting] = useState(false);

  // Build recent activity contacts from NIP-04 and NIP-17 events
  const recentActivityContacts = useMemo(() => {
    if (!nostrKeys?.pubkey) return [];

    const contactMap = new Map<
      string,
      { type: string; event?: NDKEvent; dm?: (typeof unwrappedDMs)[number]; timestamp: number }
    >();

    dmEvents?.forEach((event) => {
      const otherPubkey =
        event.pubkey === nostrKeys.pubkey
          ? event.tags.find((tag) => tag[0] === 'p')?.[1]
          : event.pubkey;
      if (!otherPubkey) return;

      const existing = contactMap.get(otherPubkey);
      const ts = event.created_at || 0;
      if (!existing || ts > existing.timestamp) {
        contactMap.set(otherPubkey, { type: 'nip04', event, timestamp: ts });
      }
    });

    unwrappedDMs.forEach((dm) => {
      const otherPubkey =
        dm.senderPubkey === nostrKeys.pubkey ? dm.recipientPubkeys[0] : dm.senderPubkey;
      if (!otherPubkey) return;

      const existing = contactMap.get(otherPubkey);
      if (!existing || dm.created_at > existing.timestamp) {
        contactMap.set(otherPubkey, { type: 'nip17', dm, timestamp: dm.created_at });
      }
    });

    return Array.from(contactMap.entries())
      .map(([pubkey, entry]) => ({
        type: 'contact',
        pubkey,
        dmEvent: entry.type === 'nip04' ? entry.event : null,
        nip17Content: entry.type === 'nip17' ? entry.dm?.content : undefined,
        timestamp: entry.timestamp,
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [dmEvents, unwrappedDMs, nostrKeys?.pubkey]);

  // Merge default contacts with recent activity contacts
  const contactsWithDefaults = useMemo(() => {
    const existingPubkeys = new Set(recentActivityContacts.map((c) => c.pubkey));

    const defaultsToAdd = defaultContactPubkeys
      .filter((dc) => !existingPubkeys.has(dc.pubkey))
      .map((dc) => ({
        type: 'contact' as const,
        pubkey: dc.pubkey,
        dmEvent: null,
        nip17Content: undefined as string | undefined,
        timestamp: 0,
        isDefault: true,
      }));

    return [...recentActivityContacts, ...defaultsToAdd];
  }, [recentActivityContacts, defaultContactPubkeys]);

  // Decrypt contact DM events
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!contactsWithDefaults.length) {
        setDecryptedContacts([]);
        return;
      }

      // Without keys, pass through NIP-17 content unencrypted (defaults stay visible)
      if (!nostrKeys?.pubkey || !nostrKeys?.privateKey) {
        setDecryptedContacts(
          contactsWithDefaults.map((c) =>
            c.nip17Content !== undefined ? { ...c, dmEvent: { content: c.nip17Content } } : c
          )
        );
        setIsDecrypting(false);
        return;
      }

      try {
        setIsDecrypting(true);
        const results = await decryptNip04Events(contactsWithDefaults, nostrKeys.privateKey);
        if (!cancelled) setDecryptedContacts(results);
      } catch {
        if (!cancelled) setDecryptedContacts(contactsWithDefaults);
      } finally {
        if (!cancelled) setIsDecrypting(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [contactsWithDefaults, nostrKeys?.pubkey, nostrKeys?.privateKey]);

  // Load mint info and filter for those with nostr contacts
  useEffect(() => {
    if (mints.length === 0) return;
    let cancelled = false;

    const loadMintInfo = async () => {
      try {
        setMintInfoLoading(true);
        const results = await Promise.all(
          mints.map(async (mint) => {
            try {
              return { mint, mintInfo: await getMintInfo(mint.mintUrl) };
            } catch {
              return { mint, mintInfo: null };
            }
          })
        );
        if (cancelled) return;

        const withNostr = results.filter(({ mintInfo }) => {
          if (!mintInfo?.contact) return false;
          const nostrContact = mintInfo.contact.find((c: any) => c.method === 'nostr');
          return nostrContact?.info?.startsWith('npub1');
        });
        setMintsWithInfo(withNostr);
      } catch {
        // Mint info loading failed silently
      } finally {
        if (!cancelled) setMintInfoLoading(false);
      }
    };

    loadMintInfo();
    return () => {
      cancelled = true;
    };
  }, [mints, getMintInfo]);

  const [decryptedMints, setDecryptedMints] = useState<any[]>([]);
  const [isDecryptingMints, setIsDecryptingMints] = useState(false);

  // Build mints with most recent DM metadata
  const mintsWithMetadata = useMemo(() => {
    if (!dmEvents) return [];

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
      let mintPubkey = null;
      const nostrContact = mintInfo.contact?.find((c: any) => c.method === 'nostr');
      if (nostrContact?.info) {
        try {
          mintPubkey = npubToPubkey(nostrContact.info);
        } catch {
          // ignore decode failure
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

  // Decrypt mint DM events
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!mintsWithMetadata.length || !nostrKeys?.pubkey || !nostrKeys?.privateKey) {
        setDecryptedMints([]);
        return;
      }
      try {
        setIsDecryptingMints(true);
        const results = await decryptNip04Events(mintsWithMetadata, nostrKeys.privateKey);
        if (!cancelled) setDecryptedMints(results);
      } catch {
        if (!cancelled) setDecryptedMints(mintsWithMetadata);
      } finally {
        if (!cancelled) setIsDecryptingMints(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [mintsWithMetadata, nostrKeys?.pubkey, nostrKeys?.privateKey]);

  const pagerRef = useRef<PagerView>(null);

  // Search
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
            const formatted: SearchResultData[] = data.results.map((res) => {
              let profileEventPubkey = res.pubkey;
              if (res.profileEvent) {
                try {
                  const parsed = JSON.parse(res.profileEvent);
                  if (parsed?.pubkey) profileEventPubkey = parsed.pubkey;
                } catch {
                  // Invalid profileEvent JSON
                }
              }
              return {
                pubkey: res.pubkey,
                profile: { ...res, pubkey: profileEventPubkey },
              };
            });
            setSearchResults(formatted);
            if (formatted.length > 0) addSearchToHistory(query, 'payments');
          } else {
            setSearchResults([]);
          }
        } else {
          setSearchResults([]);
        }
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    },
    [addSearchToHistory]
  );

  // Debounced search
  useEffect(() => {
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);

    if (!searchQuery.trim()) {
      setHasSearched(false);
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    // Immediately enter loading state to avoid flashing stale results
    setHasSearched(false);
    setSearchResults([]);
    setSearchLoading(true);

    debounceTimeoutRef.current = setTimeout(() => {
      searchUsers(searchQuery);
    }, 500);

    return () => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    };
  }, [searchQuery, searchUsers]);

  const displayResults: DisplayResult[] = useMemo(() => {
    if (searchLoading || !hasSearched) return PLACEHOLDER_RESULTS;
    return searchResults;
  }, [hasSearched, searchLoading, searchResults]);

  const showNoResults =
    searchQuery.trim().length > 0 && hasSearched && !searchLoading && searchResults.length === 0;

  const borderColor = useMemo(() => opacity(muted, 0.3), [muted]);

  const navigateToProfile = useCallback(({ pubkey }: { pubkey: string }) => {
    router.navigate({
      pathname: '/(user-flow)/profile' as any,
      params: { pubkey },
    });
  }, []);

  const handleSearchResultPress = useCallback(
    (result: DisplayResult) => {
      if (searchLoading || !result.profile) return;
      Keyboard.dismiss();
      requestAnimationFrame(() => {
        navigateToProfile({ pubkey: result.pubkey });
      });
    },
    [searchLoading, navigateToProfile]
  );

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  const onPageSelected = useCallback((event: any) => {
    setSelectedTab(TABS[event.nativeEvent.position]);
  }, []);

  const handleTabPress = useCallback((tab: string, index: number) => {
    setSelectedTab(tab);
    pagerRef.current?.setPage(index);
  }, []);

  // Profile subscription for all visible contacts
  const profileFilters = useMemo(() => {
    const allPubkeys = [
      ...defaultContactPubkeys.map((dc) => dc.pubkey),
      ...decryptedContacts.map((item: any) => item.pubkey),
      ...decryptedMints.map((item: any) => item.pubkey),
    ].filter((pubkey): pubkey is string => !!pubkey);

    const uniquePubkeys = [...new Set(allPubkeys)];
    if (uniquePubkeys.length === 0) return null;
    return [{ kinds: [0], authors: uniquePubkeys }];
  }, [decryptedContacts, decryptedMints, defaultContactPubkeys]);

  const { events: profileEvents, eose: profilesEose } = useSubscribe({ filters: profileFilters });
  const isLoadingProfiles = !profilesEose;

  const profilesMap = useMemo(() => {
    const map = new Map();
    profileEvents?.forEach((event) => {
      try {
        map.set(event.pubkey, JSON.parse(event.content));
      } catch {
        // Skip invalid profile JSON
      }
    });
    return map;
  }, [profileEvents]);

  useEffect(() => {
    prefetchImages(Array.from(profilesMap.values()).map((p: any) => p?.picture));
  }, [profilesMap]);

  useEffect(() => {
    prefetchImages(mintsWithInfo.map(({ mintInfo }) => mintInfo?.icon_url));
  }, [mintsWithInfo]);

  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const HEADER_HEIGHT = 56 + insets.top;

  return (
    <LayoutDebugWrapper scrollable={false}>
      <ScrollableGradientOverlay contentHeight={windowHeight * 1.5} />

      <SafeAreaView style={layoutStyles.flex1} edges={['bottom']}>
        <SkeletonContainer
          backgroundColor={surfaceSecondary}
          highlightColor={defaultColor}
          speed={800}
          animation={searchLoading ? 'pulse' : 'none'}>
          <View style={{ position: 'relative', flex: 1, paddingTop: HEADER_HEIGHT }}>
            {/* Tabs - hidden when searching to avoid layout shift */}
            <View
              style={{
                paddingHorizontal: 12,
                height: isSearching ? 0 : 'auto',
                overflow: 'hidden',
                opacity: isSearching ? 0 : 1,
              }}>
              <Tabs
                tabs={TABS}
                selectedTab={selectedTab}
                handleTabPress={handleTabPress}
                amounts={[String(decryptedContacts.length), String(decryptedMints.length)]}
              />
            </View>

            {/* Search results overlay */}
            {isSearching && (
              <Pressable style={layoutStyles.flex1} onPress={dismissKeyboard}>
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.searchContainer}>
                  <RNView style={[styles.card, { borderColor }]}>
                    <BlurCardFrame accentColor={muted}>
                      <View style={styles.searchSectionHeader}>
                        <Text overpass bold size={14} style={{ color: opacity(foreground, 0.4) }}>
                          Search results
                        </Text>
                      </View>
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
                    </BlurCardFrame>
                  </RNView>
                </ScrollView>
              </Pressable>
            )}

            {/* Tab content */}
            {!isSearching && (
              <View style={layoutStyles.flex1}>
                <PagerView
                  ref={pagerRef}
                  onPageSelected={onPageSelected}
                  style={{ flex: 1, minHeight: 1 }}
                  initialPage={0}
                  scrollEnabled>
                  <View key="1" collapsable={false} style={layoutStyles.flex1}>
                    <DraggableContactsList
                      data={decryptedContacts}
                      profilesMap={profilesMap}
                      isDecrypting={isDecrypting}
                      isLoadingProfiles={isLoadingProfiles}
                      emptyMessage="No recent conversations found"
                    />
                  </View>
                  <View key="2" collapsable={false} style={layoutStyles.flex1}>
                    <DraggableContactsList
                      data={decryptedMints}
                      profilesMap={profilesMap}
                      isDecrypting={mintInfoLoading || isDecryptingMints}
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

const layoutStyles = StyleSheet.create({
  flex1: { flex: 1 },
});

const styles = StyleSheet.create({
  searchContainer: {
    paddingBottom: 24,
  },
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
    marginHorizontal: 16,
  },
  cardContent: {
    padding: 16,
    zIndex: 1,
  },
  searchSectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
    zIndex: 1,
  },
});
