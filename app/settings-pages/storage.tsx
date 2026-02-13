import React, { useState, useCallback, useMemo } from 'react';
import { ScrollView, RefreshControl, Alert, Share } from 'react-native';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import Container from 'components/blocks/Container';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Global stores
import { useAuditMintStore } from 'stores/auditMintStore';
import { useBTCMapStore } from 'stores/btcMapStore';
import { useKYMMintStore } from 'stores/kymMintStore';
import { usePricelistStore } from 'stores/pricelistStore';
import { useSettingsStore } from 'stores/settingsStore';
import { useProfileStore } from 'stores/profileStore';

// Profile-scoped stores
import { useMintStore } from 'stores/mintStore';
import { useMintDistributionStore } from 'stores/mintDistributionStore';
import { useRoutstrStore } from 'stores/routstrStore';
import { useScanHistoryStore } from 'stores/scanHistoryStore';
import { useSearchHistoryStore } from 'stores/searchHistoryStore';
import { useSwapTransactionsStore } from 'stores/swapTransactionsStore';
import { useTransactionLocationStore } from 'stores/transactionLocationStore';

interface StoreSection {
  name: string;
  icon: string;
  data: any;
  onClear?: () => Promise<void> | void;
  storageKey: string;
  scope: 'global' | 'profile';
}

// Simple JSON display
const JSONDisplay: React.FC<{ data: any }> = ({ data }) => {
  const { getPrimaryColor } = useTheme();
  const jsonString = JSON.stringify(data, null, 2);

  return (
    <Text
      size={12}
      style={{
        color: getPrimaryColor('200'),
        fontFamily: 'monospace',
        lineHeight: 18,
      }}>
      {jsonString}
    </Text>
  );
};

/** Count top-level entries in a data object for the badge. */
function countEntries(data: any): number | null {
  if (data == null || typeof data !== 'object') return null;
  const keys = Object.keys(data);
  if (keys.length === 0) return 0;

  // Try common patterns: look for the first key whose value is an object/array
  for (const key of keys) {
    const val = data[key];
    if (Array.isArray(val)) return val.length;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val).length;
    }
  }
  return null;
}

const StoreCard: React.FC<{
  section: StoreSection;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ section, isExpanded, onToggle }) => {
  const { getPrimaryColor, getRedColor } = useTheme();

  const handleClear = () => {
    Alert.alert('Clear Store', `Are you sure you want to clear all data from ${section.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          try {
            await section.onClear?.();
            Alert.alert('Success', `${section.name} cleared successfully`);
          } catch {
            Alert.alert('Error', `Failed to clear ${section.name}`);
          }
        },
      },
    ]);
  };

  const handleShare = async () => {
    try {
      const jsonString = JSON.stringify(section.data, null, 2);
      await Share.share({
        message: jsonString,
        title: `${section.name} Data`,
      });
    } catch {
      Alert.alert('Error', 'Failed to share data');
    }
  };

  const jsonString = JSON.stringify(section.data, null, 2);
  const dataSize = new Blob([jsonString]).size;
  const formattedSize = dataSize < 1024 ? `${dataSize} B` : `${(dataSize / 1024).toFixed(1)} KB`;

  const entryCount = useMemo(() => countEntries(section.data), [section.data]);

  return (
    <View
      className="mb-3 overflow-hidden rounded-2xl"
      style={{
        backgroundColor: getPrimaryColor('900'),
        borderWidth: 1,
        borderColor: isExpanded ? getPrimaryColor('600') : getPrimaryColor('800'),
      }}>
      {/* Header */}
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7}>
        <HStack className="items-center p-4">
          {/* Icon */}
          <View
            className="mr-3 items-center justify-center rounded-xl"
            style={{
              width: 40,
              height: 40,
              backgroundColor: getPrimaryColor('800'),
            }}>
            <Icon name={section.icon} color={getPrimaryColor('300')} size={20} />
          </View>

          {/* Title & Meta */}
          <VStack spacing={2} style={{ flex: 1 }}>
            <Text size={15} bold style={{ color: getPrimaryColor('50') }}>
              {section.name}
            </Text>
            <HStack spacing={8} className="items-center">
              <Text size={11} style={{ color: getPrimaryColor('500') }}>
                {section.storageKey}
              </Text>
              <View
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: 1.5,
                  backgroundColor: getPrimaryColor('600'),
                }}
              />
              <Text size={11} style={{ color: getPrimaryColor('500') }}>
                {formattedSize}
              </Text>
              {entryCount !== null ? (
                <>
                  <View
                    style={{
                      width: 3,
                      height: 3,
                      borderRadius: 1.5,
                      backgroundColor: getPrimaryColor('600'),
                    }}
                  />
                  <Text size={11} style={{ color: getPrimaryColor('500') }}>
                    {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
                  </Text>
                </>
              ) : null}
            </HStack>
          </VStack>

          {/* Chevron */}
          <Icon
            name={isExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
            color={getPrimaryColor('500')}
            size={22}
          />
        </HStack>
      </TouchableOpacity>

      {/* Expanded Content */}
      {isExpanded ? (
        <>
          {/* Divider */}
          <View
            style={{
              height: 1,
              backgroundColor: getPrimaryColor('800'),
              marginHorizontal: 16,
            }}
          />

          {/* JSON Display */}
          <View className="p-4">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 16 }}>
              <ScrollView
                style={{ maxHeight: 300 }}
                showsVerticalScrollIndicator={true}
                nestedScrollEnabled>
                <View
                  className="rounded-xl p-4"
                  style={{ backgroundColor: getPrimaryColor('950'), minWidth: 280 }}>
                  <JSONDisplay data={section.data} />
                </View>
              </ScrollView>
            </ScrollView>

            {/* Action Buttons */}
            <HStack className="mt-3 justify-end" spacing={10}>
              <TouchableOpacity
                onPress={handleShare}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: getPrimaryColor('800'),
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 8,
                  gap: 6,
                }}>
                <Icon name="ri:share-fill" color={getPrimaryColor('300')} size={14} />
                <Text size={13} medium style={{ color: getPrimaryColor('200') }}>
                  Share
                </Text>
              </TouchableOpacity>

              {section.onClear ? (
                <TouchableOpacity
                  onPress={handleClear}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: 'transparent',
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: getRedColor('800'),
                    gap: 6,
                  }}>
                  <Icon name="mdi:trash-can-outline" color={getRedColor('400')} size={14} />
                  <Text size={13} medium style={{ color: getRedColor('400') }}>
                    Clear
                  </Text>
                </TouchableOpacity>
              ) : null}
            </HStack>
          </View>
        </>
      ) : null}
    </View>
  );
};

/** Section header for "Global" / "Profile-Scoped" groupings. */
const ScopeHeader: React.FC<{ label: string; description: string }> = ({ label, description }) => {
  const { getPrimaryColor } = useTheme();
  return (
    <VStack spacing={2} style={{ marginTop: 12, marginBottom: 8 }}>
      <Text size={13} bold style={{ color: getPrimaryColor('300'), textTransform: 'uppercase' }}>
        {label}
      </Text>
      <Text size={11} style={{ color: getPrimaryColor('600') }}>
        {description}
      </Text>
    </VStack>
  );
};

// ---- Raw AsyncStorage diagnostic ----

/** All known persisted store keys (both global and profile-scoped). */
const ALL_STORE_KEYS = [
  'audit-mint-store',
  'btcmap-store',
  'kym-mint-store',
  'mint-store',
  'mint-distribution-store',
  'pricelist-store',
  'profile-store',
  'routstr-store',
  'scan-history-store',
  'search-history-store',
  'settings-store',
  'swap-transactions-store',
  'transaction-location-store',
];

/** Read raw AsyncStorage for every known key (and profile-suffixed variants). */
async function readRawStorage(maxProfileIndex: number): Promise<Record<string, string | null>> {
  const keysToCheck: string[] = [];
  for (const base of ALL_STORE_KEYS) {
    keysToCheck.push(base); // account 0 / global
    for (let i = 1; i <= maxProfileIndex; i++) {
      keysToCheck.push(`${base}:profile:${i}`);
    }
  }
  const pairs = await AsyncStorage.multiGet(keysToCheck);
  const result: Record<string, string | null> = {};
  for (const [key, value] of pairs) {
    result[key] = value;
  }
  return result;
}

const RawStorageCard: React.FC = () => {
  const { getPrimaryColor, getGreenColor } = useTheme();
  const activeProfile = useProfileStore.getState().activeAccountIndex;
  const profileCount = Object.keys(useProfileStore.getState().profiles ?? {}).length;
  const maxIdx = Math.max(activeProfile, profileCount, 1);

  const [rawData, setRawData] = useState<Record<string, string | null> | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleLoad = async () => {
    setLoading(true);
    try {
      const data = await readRawStorage(maxIdx);
      setRawData(data);
      setExpanded(true);
    } catch (e: any) {
      Alert.alert('Error', `Failed to read AsyncStorage: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    if (!rawData) return;
    // Parse stored JSON for readability, fall back to raw string
    const parsed: Record<string, any> = {};
    for (const [key, value] of Object.entries(rawData)) {
      if (value == null) continue; // skip empty keys
      try {
        parsed[key] = JSON.parse(value);
      } catch {
        parsed[key] = value;
      }
    }
    const jsonString = JSON.stringify(parsed, null, 2);
    await Share.share({ message: jsonString, title: 'Raw AsyncStorage Dump' });
  };

  // Summarise: how many keys have data vs empty
  const summary = useMemo(() => {
    if (!rawData) return null;
    const withData = Object.entries(rawData).filter(([, v]) => v != null);
    const empty = Object.entries(rawData).filter(([, v]) => v == null);
    return { withData, empty };
  }, [rawData]);

  return (
    <View
      className="mb-3 overflow-hidden rounded-2xl"
      style={{
        backgroundColor: getPrimaryColor('900'),
        borderWidth: 1,
        borderColor: expanded ? getGreenColor('700') : getPrimaryColor('800'),
      }}>
      <TouchableOpacity
        onPress={rawData ? () => setExpanded((p) => !p) : handleLoad}
        activeOpacity={0.7}>
        <HStack className="items-center p-4">
          <View
            className="mr-3 items-center justify-center rounded-xl"
            style={{ width: 40, height: 40, backgroundColor: getPrimaryColor('800') }}>
            <Icon name="mdi:database-search" color={getGreenColor('400')} size={20} />
          </View>
          <VStack spacing={2} style={{ flex: 1 }}>
            <Text size={15} bold style={{ color: getPrimaryColor('50') }}>
              Raw AsyncStorage
            </Text>
            <Text size={11} style={{ color: getPrimaryColor('500') }}>
              {loading
                ? 'Reading...'
                : rawData
                  ? `${summary?.withData.length ?? 0} keys with data, ${summary?.empty.length ?? 0} empty`
                  : 'Tap to load raw disk data'}
            </Text>
          </VStack>
          {rawData ? (
            <Icon
              name={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
              color={getPrimaryColor('500')}
              size={22}
            />
          ) : null}
        </HStack>
      </TouchableOpacity>

      {expanded && rawData ? (
        <>
          <View
            style={{ height: 1, backgroundColor: getPrimaryColor('800'), marginHorizontal: 16 }}
          />
          <View className="p-4">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 16 }}>
              <ScrollView
                style={{ maxHeight: 400 }}
                showsVerticalScrollIndicator
                nestedScrollEnabled>
                <View
                  className="rounded-xl p-4"
                  style={{ backgroundColor: getPrimaryColor('950'), minWidth: 280 }}>
                  {summary?.withData.map(([key, value]) => {
                    let parsed: any;
                    try {
                      parsed = JSON.parse(value!);
                    } catch {
                      parsed = value;
                    }
                    // Show a compact summary: key name + size + top-level keys of .state
                    const stateKeys =
                      parsed?.state && typeof parsed.state === 'object'
                        ? Object.keys(parsed.state)
                        : null;
                    const size = value?.length ?? 0;
                    const formattedSize =
                      size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;

                    return (
                      <VStack key={key} spacing={2} style={{ marginBottom: 12 }}>
                        <HStack spacing={8} className="items-center">
                          <Text
                            size={12}
                            bold
                            style={{ color: getGreenColor('300'), fontFamily: 'monospace' }}>
                            {key}
                          </Text>
                          <Text
                            size={10}
                            style={{ color: getPrimaryColor('500'), fontFamily: 'monospace' }}>
                            {formattedSize}
                          </Text>
                        </HStack>
                        {stateKeys ? (
                          <Text
                            size={11}
                            style={{ color: getPrimaryColor('400'), fontFamily: 'monospace' }}>
                            state keys: [{stateKeys.join(', ')}]
                          </Text>
                        ) : null}
                        {/* Show first 200 chars of raw value for quick peek */}
                        <Text
                          size={10}
                          style={{
                            color: getPrimaryColor('600'),
                            fontFamily: 'monospace',
                            lineHeight: 14,
                          }}>
                          {(value ?? '').slice(0, 200)}
                          {(value?.length ?? 0) > 200 ? '…' : ''}
                        </Text>
                      </VStack>
                    );
                  })}
                  {summary?.withData.length === 0 ? (
                    <Text size={12} style={{ color: getPrimaryColor('500') }}>
                      No data found in AsyncStorage
                    </Text>
                  ) : null}
                </View>
              </ScrollView>
            </ScrollView>

            <HStack className="mt-3 justify-end" spacing={10}>
              <TouchableOpacity
                onPress={handleLoad}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: getPrimaryColor('800'),
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 8,
                  gap: 6,
                }}>
                <Icon name="mdi:refresh" color={getPrimaryColor('300')} size={14} />
                <Text size={13} medium style={{ color: getPrimaryColor('200') }}>
                  Reload
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleShare}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: getPrimaryColor('800'),
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 8,
                  gap: 6,
                }}>
                <Icon name="ri:share-fill" color={getPrimaryColor('300')} size={14} />
                <Text size={13} medium style={{ color: getPrimaryColor('200') }}>
                  Share Full Dump
                </Text>
              </TouchableOpacity>
            </HStack>
          </View>
        </>
      ) : null}
    </View>
  );
};

export default function StorageScreen() {
  const { getPrimaryColor } = useTheme();
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  // ---- Global stores ----
  const auditMintStore = useAuditMintStore();
  const btcMapStore = useBTCMapStore();
  const kymMintStore = useKYMMintStore();
  const pricelistStore = usePricelistStore();
  const settingsStore = useSettingsStore();
  const profileStore = useProfileStore();

  // ---- Profile-scoped stores ----
  const mintStore = useMintStore();
  const mintDistributionStore = useMintDistributionStore();
  const routstrStore = useRoutstrStore();
  const scanHistoryStore = useScanHistoryStore();
  const searchHistoryStore = useSearchHistoryStore();
  const swapTransactionsStore = useSwapTransactionsStore();
  const transactionLocationStore = useTransactionLocationStore();

  const globalSections: StoreSection[] = useMemo(
    () => [
      {
        name: 'Profile',
        icon: 'mdi:account-circle',
        storageKey: 'profile-store',
        scope: 'global' as const,
        data: {
          activeAccountIndex: profileStore.activeAccountIndex,
          profiles: profileStore.profiles,
        },
      },
      {
        name: 'Settings',
        icon: 'material-symbols:settings-rounded',
        storageKey: 'settings-store',
        scope: 'global' as const,
        data: {
          theme: settingsStore.theme,
          language: settingsStore.language,
          displayBtc: settingsStore.displayBtc,
          displayCurrency: settingsStore.displayCurrency,
          experimental: settingsStore.experimental,
          termsAccepted: settingsStore.termsAccepted,
          quickAccessP2PK: settingsStore.quickAccessP2PK,
        },
        onClear: settingsStore.clearAllData,
      },
      {
        name: 'Audit Mint',
        icon: 'material-symbols:verified',
        storageKey: 'audit-mint-store',
        scope: 'global' as const,
        data: { cache: auditMintStore.cache },
        onClear: auditMintStore.clearAllData,
      },
      {
        name: 'BTC Map',
        icon: 'mdi:map-marker',
        storageKey: 'btcmap-store',
        scope: 'global' as const,
        data: {
          placesCache: btcMapStore.placesCache,
          placeDetailsCache: btcMapStore.placeDetailsCache,
          isLoading: btcMapStore.isLoading,
          error: btcMapStore.error,
        },
        onClear: btcMapStore.clearAllData,
      },
      {
        name: 'KYM Mint',
        icon: 'mdi:check-circle-outline',
        storageKey: 'kym-mint-store',
        scope: 'global' as const,
        data: { cache: kymMintStore.cache },
        onClear: kymMintStore.clearAllData,
      },
      {
        name: 'Pricelist',
        icon: 'solar:tag-price-bold',
        storageKey: 'pricelist-store',
        scope: 'global' as const,
        data: {
          pricelist: pricelistStore.pricelist,
          lastUpdated: pricelistStore.lastUpdated,
          isLoading: pricelistStore.isLoading,
          error: pricelistStore.error,
        },
        onClear: pricelistStore.clearAllData,
      },
    ],
    [
      profileStore.activeAccountIndex,
      profileStore.profiles,
      settingsStore.theme,
      settingsStore.language,
      settingsStore.displayBtc,
      settingsStore.displayCurrency,
      settingsStore.experimental,
      settingsStore.termsAccepted,
      settingsStore.quickAccessP2PK,
      settingsStore.clearAllData,
      auditMintStore.cache,
      auditMintStore.clearAllData,
      btcMapStore.placesCache,
      btcMapStore.placeDetailsCache,
      btcMapStore.isLoading,
      btcMapStore.error,
      btcMapStore.clearAllData,
      kymMintStore.cache,
      kymMintStore.clearAllData,
      pricelistStore.pricelist,
      pricelistStore.lastUpdated,
      pricelistStore.isLoading,
      pricelistStore.error,
      pricelistStore.clearAllData,
    ]
  );

  const profileSections: StoreSection[] = useMemo(
    () => [
      {
        name: 'Swap Transactions',
        icon: 'mdi:swap-horizontal',
        storageKey: 'swap-transactions-store',
        scope: 'profile' as const,
        data: {
          groups: swapTransactionsStore.groups,
          quoteIdToGroup: swapTransactionsStore.quoteIdToGroup,
        },
        onClear: swapTransactionsStore.clearAllData,
      },
      {
        name: 'Mint Selection',
        icon: 'ph:coins',
        storageKey: 'mint-store',
        scope: 'profile' as const,
        data: { selectedMints: mintStore.selectedMints },
        onClear: mintStore.clearAllData,
      },
      {
        name: 'Mint Distribution',
        icon: 'mdi:chart-pie',
        storageKey: 'mint-distribution-store',
        scope: 'profile' as const,
        data: { distributions: mintDistributionStore.distributions },
        onClear: mintDistributionStore.clearAllData,
      },
      {
        name: 'Routstr AI',
        icon: 'mdi:robot',
        storageKey: 'routstr-store',
        scope: 'profile' as const,
        data: {
          apiKey: routstrStore.apiKey ? '***REDACTED***' : null,
          balance: routstrStore.balance,
          selectedModel: routstrStore.selectedModel,
          sessionsCount: routstrStore.sessions.length,
          currentSessionId: routstrStore.currentSessionId,
          conversationHistoryCount: routstrStore.conversationHistory.length,
          isAnonymousMode: routstrStore.isAnonymousMode,
        },
        onClear: routstrStore.clearAllData,
      },
      {
        name: 'Scan History',
        icon: 'mdi:qrcode-scan',
        storageKey: 'scan-history-store',
        scope: 'profile' as const,
        data: { entries: scanHistoryStore.entries },
        onClear: scanHistoryStore.clearAllData,
      },
      {
        name: 'Search History',
        icon: 'mdi:magnify',
        storageKey: 'search-history-store',
        scope: 'profile' as const,
        data: { recentSearches: searchHistoryStore.recentSearches },
        onClear: searchHistoryStore.clearAllData,
      },
      {
        name: 'Transaction Locations',
        icon: 'mdi:map-marker-radius',
        storageKey: 'transaction-location-store',
        scope: 'profile' as const,
        data: { locations: transactionLocationStore.locations },
        onClear: transactionLocationStore.clearAllData,
      },
    ],
    [
      swapTransactionsStore.groups,
      swapTransactionsStore.quoteIdToGroup,
      swapTransactionsStore.clearAllData,
      mintStore.selectedMints,
      mintStore.clearAllData,
      mintDistributionStore.distributions,
      mintDistributionStore.clearAllData,
      routstrStore.apiKey,
      routstrStore.balance,
      routstrStore.selectedModel,
      routstrStore.sessions.length,
      routstrStore.currentSessionId,
      routstrStore.conversationHistory.length,
      routstrStore.isAnonymousMode,
      routstrStore.clearAllData,
      scanHistoryStore.entries,
      scanHistoryStore.clearAllData,
      searchHistoryStore.recentSearches,
      searchHistoryStore.clearAllData,
      transactionLocationStore.locations,
      transactionLocationStore.clearAllData,
    ]
  );

  const allSections = useMemo(
    () => [...globalSections, ...profileSections],
    [globalSections, profileSections]
  );

  const toggleStore = (storeName: string) => {
    setExpandedStores((prev) => {
      const next = new Set(prev);
      if (next.has(storeName)) {
        next.delete(storeName);
      } else {
        next.add(storeName);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedStores(new Set(allSections.map((s) => s.name)));
  };

  const collapseAll = () => {
    setExpandedStores(new Set());
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  const totalSize = useMemo(() => {
    const total = allSections.reduce((acc, section) => {
      const jsonString = JSON.stringify(section.data, null, 2);
      return acc + new Blob([jsonString]).size;
    }, 0);
    return total < 1024 ? `${total} B` : `${(total / 1024).toFixed(1)} KB`;
  }, [allSections]);

  const activeProfile = profileStore.activeAccountIndex;

  return (
    <Container>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={getPrimaryColor('300')}
          />
        }>
        {/* Header Stats */}
        <View
          className="mb-4 rounded-2xl p-4"
          style={{
            backgroundColor: getPrimaryColor('900'),
            borderWidth: 1,
            borderColor: getPrimaryColor('800'),
          }}>
          <HStack className="items-center justify-between">
            <VStack spacing={2}>
              <Text size={13} style={{ color: getPrimaryColor('500') }}>
                Total Storage ({allSections.length} stores)
              </Text>
              <Text size={22} bold style={{ color: getPrimaryColor('50') }}>
                {totalSize}
              </Text>
              <Text size={11} style={{ color: getPrimaryColor('600') }}>
                Active profile: {activeProfile}
              </Text>
            </VStack>
            <HStack spacing={10}>
              <TouchableOpacity
                onPress={collapseAll}
                activeOpacity={0.7}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 8,
                  backgroundColor: getPrimaryColor('800'),
                }}>
                <Icon name="mdi:minus" color={getPrimaryColor('300')} size={18} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={expandAll}
                activeOpacity={0.7}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 8,
                  backgroundColor: getPrimaryColor('800'),
                }}>
                <Icon name="mdi:plus" color={getPrimaryColor('300')} size={18} />
              </TouchableOpacity>
            </HStack>
          </HStack>
        </View>

        {/* Raw AsyncStorage Diagnostic */}
        <ScopeHeader label="Diagnostics" description="Read raw disk data to debug store issues" />
        <RawStorageCard />

        {/* Global Stores */}
        <ScopeHeader label="Global" description="Shared across all profiles" />
        {globalSections.map((section) => (
          <StoreCard
            key={section.name}
            section={section}
            isExpanded={expandedStores.has(section.name)}
            onToggle={() => toggleStore(section.name)}
          />
        ))}

        {/* Profile-Scoped Stores */}
        <ScopeHeader
          label={`Profile-Scoped (account ${activeProfile})`}
          description="Isolated per profile — resets on profile switch"
        />
        {profileSections.map((section) => (
          <StoreCard
            key={section.name}
            section={section}
            isExpanded={expandedStores.has(section.name)}
            onToggle={() => toggleStore(section.name)}
          />
        ))}

        {/* Bottom Padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </Container>
  );
}
