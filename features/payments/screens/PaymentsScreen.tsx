import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { NoResultsFound } from '@/features/payments';
import { ContactRow, nostrIdentity } from '@/shared/ui/composed/ContactRow';
import { ScrollableGradientOverlay } from '@/shared/ui/composed/BackgroundView';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { useBackgroundConfig } from '@/shared/providers/BackgroundProvider';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { LayoutDebugWrapper } from '@/shared/ui/composed/LayoutDebugWrapper';
import { useMintManagement } from '@/features/mint';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import opacity from 'hex-color-opacity';
import { prefetchImages } from '@/shared/lib/imageCache';
import { Tabs } from '@/shared/ui/composed/Tabs';
import { DraggableContactsList } from '../components/DraggableContactsList';
import { router } from 'expo-router';
import { useContactSearch, type DisplayResult } from '../hooks/useContactSearch';
import { useRecentContacts } from '../hooks/useRecentContacts';
import { useMintContacts } from '../hooks/useMintContacts';
import { Screen, paymentLog, useLifecycleLogger } from '@/shared/lib/logger';

const SearchResultItem = React.memo(
  ({
    result,
    onPress,
  }: {
    result: DisplayResult;
    onPress: (result: DisplayResult) => void;
  }) => {
    const handlePress = useCallback(() => {
      onPress(result);
    }, [result, onPress]);

    // Only placeholder rows (no profile) render as skeletons.
    // `useContactSearch` keeps prior real results visible while a new query
    // is in flight (stale-while-revalidate), so we no longer gate on a
    // coarse `loading` flag — that would re-skeleton real rows on every
    // keystroke.
    return (
      <ContactRow
        identity={nostrIdentity(result.pubkey, result.profile, {
          isLoadingProfile: !result.profile,
        })}
        onPress={handlePress}
        testID={`contact-row:nostr:${result.pubkey}`}
      />
    );
  }
);

SearchResultItem.displayName = 'SearchResultItem';

const TABS = ['Recent activity', 'Mints'];

interface PaymentsScreenProps {
  searchQuery: string;
  isSearching: boolean;
}

export function PaymentsScreen({ searchQuery, isSearching }: PaymentsScreenProps) {
  useLifecycleLogger('PaymentsScreen', paymentLog);
  useBackgroundConfig({ blurMode: 'full', backgroundOpacity: 0.25 });

  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const headerHeight = useHeaderHeight();
  const { height: windowHeight } = useWindowDimensions();
  const [selectedTab, setSelectedTab] = useState('Recent activity');

  const { keys: nostrKeys } = useNostrKeysContext();
  const { mints, getMintInfo } = useMintManagement();

  // Data hooks
  const { displayContacts, contactPubkeys, dmEvents } = useRecentContacts(nostrKeys);
  const { displayMints, mintPubkeys, mintInfoLoading } = useMintContacts(
    nostrKeys,
    mints,
    getMintInfo,
    dmEvents
  );
  const { displayResults, showNoResults } = useContactSearch(searchQuery);

  const handleSearchResultPress = useCallback(
    (result: DisplayResult) => {
      if (!result.profile) return;
      paymentLog.info('payment.search.result.press', { pubkey: result.pubkey });
      router.navigate({
        pathname: '/(user-flow)/profile' as any,
        params: { pubkey: result.pubkey },
      });
    },
    []
  );

  // Profile subscription
  const profileFilters = useMemo(() => {
    const allPubkeys = [...new Set([...contactPubkeys, ...mintPubkeys])];
    if (allPubkeys.length === 0) return null;
    return [{ kinds: [0], authors: allPubkeys }];
  }, [contactPubkeys, mintPubkeys]);

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
    paymentLog.debug('payment.profiles.loaded', { count: profilesMap.size });
    prefetchImages(Array.from(profilesMap.values()).map((p: any) => p?.picture));
  }, [profilesMap]);

  const handleTabPress = useCallback((tab: string, _index: number) => {
    paymentLog.info('payment.tab.change', { tab });
    setSelectedTab(tab);
  }, []);

  const borderColor = useMemo(() => opacity(muted, 0.3), [muted]);

  return (
    <LayoutDebugWrapper scrollable={false}>
      <Screen name="PaymentsScreen">
        <ScrollableGradientOverlay contentHeight={windowHeight * 1.5} />

        <SafeAreaView style={styles.flex1} edges={['bottom']}>
          <View style={[styles.flex1, { paddingTop: headerHeight }]}>
            {isSearching ? (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.searchContainer}>
                <View style={[styles.card, { borderColor }]}>
                  <BlurCardFrame accentColor={muted}>
                    <View style={styles.searchSectionHeader}>
                      <Text bold size={14} style={{ color: opacity(foreground, 0.4) }}>
                        Search results
                      </Text>
                    </View>
                    {showNoResults ? (
                      <NoResultsFound />
                    ) : (
                      displayResults.map((item) => (
                        <SearchResultItem
                          key={item.pubkey}
                          result={item}
                          onPress={handleSearchResultPress}
                        />
                      ))
                    )}
                  </BlurCardFrame>
                </View>
              </ScrollView>
            ) : (
              <View style={styles.flex1}>
                <View style={styles.tabsContainer}>
                  <Tabs
                    tabs={TABS}
                    selectedTab={selectedTab}
                    handleTabPress={handleTabPress}
                    amounts={[String(displayContacts.length), String(displayMints.length)]}
                  />
                </View>
                {selectedTab === 'Recent activity' ? (
                  <DraggableContactsList
                    data={displayContacts}
                    profilesMap={profilesMap}
                    isLoadingProfiles={isLoadingProfiles}
                    emptyMessage="No recent conversations found"
                  />
                ) : (
                  <DraggableContactsList
                    data={displayMints}
                    profilesMap={profilesMap}
                    loading={mintInfoLoading}
                    isLoadingProfiles={isLoadingProfiles}
                    emptyMessage="No mints with nostr contacts found"
                  />
                )}
              </View>
            )}
          </View>
        </SafeAreaView>
      </Screen>
    </LayoutDebugWrapper>
  );
}

const styles = StyleSheet.create({
  flex1: {
    flex: 1,
  },
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
  tabsContainer: {
    paddingHorizontal: 12,
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
  hidden: {
    display: 'none' as const,
  },
});
