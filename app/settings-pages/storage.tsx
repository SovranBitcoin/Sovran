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

// Import all stores
import { useAuditMintStore } from 'stores/auditMintStore';
import { useBTCMapStore } from 'stores/btcMapStore';
import { useKYMMintStore } from 'stores/kymMintStore';
import { useMintStore } from 'stores/mintStore';
import { usePricelistStore } from 'stores/pricelistStore';
import { useRoutstrStore } from 'stores/routstrStore';
import { useSettingsStore } from 'stores/settingsStore';

interface StoreSection {
  name: string;
  icon: string;
  data: any;
  onClear?: () => Promise<void> | void;
  storageKey: string;
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

  // Count entries for display
  const entryCount = useMemo(() => {
    if (section.data?.cache) return Object.keys(section.data.cache).length;
    if (section.data?.selectedMints) return Object.keys(section.data.selectedMints).length;
    if (section.data?.placesCache?.data) return section.data.placesCache.data.length;
    return null;
  }, [section.data]);

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
              {entryCount !== null && (
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
              )}
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
      {isExpanded && (
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

              {section.onClear && (
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
              )}
            </HStack>
          </View>
        </>
      )}
    </View>
  );
};

export default function StorageScreen() {
  const { getPrimaryColor, getRedColor: _getRedColor } = useTheme();
  const [expandedStores, setExpandedStores] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  // Get store states
  const auditMintStore = useAuditMintStore();
  const btcMapStore = useBTCMapStore();
  const kymMintStore = useKYMMintStore();
  const mintStore = useMintStore();
  const pricelistStore = usePricelistStore();
  const routstrStore = useRoutstrStore();
  const settingsStore = useSettingsStore();

  // Define store sections with their data
  const storeSections: StoreSection[] = useMemo(
    () => [
      {
        name: 'Audit Mint',
        icon: 'material-symbols:verified',
        storageKey: 'audit-mint-store',
        data: { cache: auditMintStore.cache },
        onClear: auditMintStore.clearAllData,
      },
      {
        name: 'BTC Map',
        icon: 'mdi:map-marker',
        storageKey: 'btcmap-store',
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
        data: { cache: kymMintStore.cache },
        onClear: kymMintStore.clearAllData,
      },
      {
        name: 'Mint Selection',
        icon: 'ph:coins',
        storageKey: 'mint-store',
        data: { selectedMints: mintStore.selectedMints },
        onClear: mintStore.clearAllData,
      },
      {
        name: 'Pricelist',
        icon: 'solar:tag-price-bold',
        storageKey: 'pricelist-store',
        data: {
          pricelist: pricelistStore.pricelist,
          lastUpdated: pricelistStore.lastUpdated,
          isLoading: pricelistStore.isLoading,
          error: pricelistStore.error,
        },
        onClear: pricelistStore.clearAllData,
      },
      {
        name: 'Routstr AI',
        icon: 'mdi:robot',
        storageKey: 'routstr-store',
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
        name: 'Settings',
        icon: 'material-symbols:settings-rounded',
        storageKey: 'settings-store',
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
    ],
    [
      auditMintStore.cache,
      auditMintStore.clearAllData,
      btcMapStore.placesCache,
      btcMapStore.placeDetailsCache,
      btcMapStore.isLoading,
      btcMapStore.error,
      btcMapStore.clearAllData,
      kymMintStore.cache,
      kymMintStore.clearAllData,
      mintStore.selectedMints,
      mintStore.clearAllData,
      pricelistStore.pricelist,
      pricelistStore.lastUpdated,
      pricelistStore.isLoading,
      pricelistStore.error,
      pricelistStore.clearAllData,
      routstrStore.apiKey,
      routstrStore.balance,
      routstrStore.selectedModel,
      routstrStore.sessions.length,
      routstrStore.currentSessionId,
      routstrStore.conversationHistory.length,
      routstrStore.isAnonymousMode,
      routstrStore.clearAllData,
      settingsStore.theme,
      settingsStore.language,
      settingsStore.displayBtc,
      settingsStore.displayCurrency,
      settingsStore.experimental,
      settingsStore.termsAccepted,
      settingsStore.quickAccessP2PK,
      settingsStore.clearAllData,
    ]
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
    setExpandedStores(new Set(storeSections.map((s) => s.name)));
  };

  const collapseAll = () => {
    setExpandedStores(new Set());
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  const _clearAllStores = () => {
    Alert.alert(
      'Clear All Stores',
      'Are you sure you want to clear ALL store data? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              await Promise.all(storeSections.map((section) => section.onClear?.()));
              Alert.alert('Success', 'All stores cleared successfully');
            } catch {
              Alert.alert('Error', 'Failed to clear some stores');
            }
          },
        },
      ]
    );
  };

  const totalSize = useMemo(() => {
    const total = storeSections.reduce((acc, section) => {
      const jsonString = JSON.stringify(section.data, null, 2);
      return acc + new Blob([jsonString]).size;
    }, 0);
    return total < 1024 ? `${total} B` : `${(total / 1024).toFixed(1)} KB`;
  }, [storeSections]);

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
                Total Storage
              </Text>
              <Text size={22} bold style={{ color: getPrimaryColor('50') }}>
                {totalSize}
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

        {/* Store Sections */}
        {storeSections.map((section) => (
          <StoreCard
            key={section.name}
            section={section}
            isExpanded={expandedStores.has(section.name)}
            onToggle={() => toggleStore(section.name)}
          />
        ))}

        {/* Clear All Button */}
        {/* <TouchableOpacity
          onPress={clearAllStores}
          activeOpacity={0.7}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 14,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: getRedColor('800'),
            marginTop: 8,
            gap: 8,
          }}>
          <Icon name="mdi:trash-can-outline" color={getRedColor('400')} size={18} />
          <Text size={15} medium style={{ color: getRedColor('400') }}>
            Clear All Stores
          </Text>
        </TouchableOpacity> */}

        {/* Bottom Padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </Container>
  );
}
