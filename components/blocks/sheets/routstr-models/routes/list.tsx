/**
 * @fileoverview ListRoute - Model selection with pricing, filtering, and sorting
 *
 * @module components/blocks/sheets/routstr-models/routes/list
 *
 * @description
 * Displays available Routstr models with pricing, context length, and selection.
 * Features caching, virtual scrolling, filtering (affordable), and sorting.
 *
 * **Navigation:**
 * - From: Initial route (sheet opens here)
 * - Close: `sheetRef.current?.hide({payload: {modelId: selectedModelId}})`
 *
 * **Data:**
 * - Payload: None
 * - Params: None (initial route)
 *
 * **Flow:** Check cache → load models → filter/sort → display → user selects → close
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSheetRef } from 'react-native-actions-sheet';
import { FlatList, ActivityIndicator, RefreshControl, ListRenderItem } from 'react-native';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import Wrapper from '../../wrapper';
import { HStack, VStack, Spacer, View } from 'components/ui/View';
import { useTheme } from '@/providers/ThemeProvider';
import { useRoutstrStore } from 'stores/routstrStore';
import { getModels, RoutstrModel } from 'helper/routstr/api';
import { popup } from '@/helper/popup';

interface ModelItemProps {
  model: RoutstrModel;
  selected: boolean;
  onPress: () => void;
}

const ModelItem: React.FC<ModelItemProps> = ({ model, selected, onPress }) => {
  const { getPrimaryColor } = useTheme();
  const promptPrice = model.sats_pricing.prompt.toFixed(4);
  const completionPrice = model.sats_pricing.completion.toFixed(4);
  const contextLength = model.context_length.toLocaleString();

  return (
    <TouchableOpacity
      onPress={onPress}
      className="mb-3 rounded-lg bg-primary-800 p-4"
      style={{
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? getPrimaryColor('400') : getPrimaryColor('700'),
      }}>
      <HStack align="center" justify="space-between">
        <VStack flex={1} spacing={4}>
          <HStack align="center" spacing={8}>
            <Text weight="heavy" size={16} className="text-primary-0">
              {model.name}
            </Text>
            {selected && <Icon name="mdi:check-circle" size={20} color={getPrimaryColor('400')} />}
          </HStack>
          <Text size={12} className="text-primary-300" numberOfLines={2}>
            {model.description}
          </Text>
          <HStack spacing={16}>
            <VStack spacing={2}>
              <Text size={10} className="text-primary-400">
                Prompt
              </Text>
              <Text size={12} weight="heavy" className="text-primary-200">
                {promptPrice} sats/1K
              </Text>
            </VStack>
            <VStack spacing={2}>
              <Text size={10} className="text-primary-400">
                Completion
              </Text>
              <Text size={12} weight="heavy" className="text-primary-200">
                {completionPrice} sats/1K
              </Text>
            </VStack>
            <VStack spacing={2}>
              <Text size={10} className="text-primary-400">
                Context
              </Text>
              <Text size={12} weight="heavy" className="text-primary-200">
                {contextLength}
              </Text>
            </VStack>
          </HStack>
        </VStack>
      </HStack>
    </TouchableOpacity>
  );
};

type SortBy = 'name' | 'price-asc' | 'price-desc' | 'context-asc' | 'context-desc';

/**
 * ListRoute Component
 *
 * @component
 * @returns {JSX.Element}
 */
const ListRoute = () => {
  const sheetRef = useSheetRef('routstr-models');
  const { getPrimaryColor } = useTheme();
  const {
    apiKey,
    balance,
    selectedModel,
    setSelectedModel,
    getCachedModels,
    setCachedModels,
    isCacheStale,
    clearModelsCache,
  } = useRoutstrStore();

  const [models, setModels] = useState<RoutstrModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [affordableFilter, setAffordableFilter] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('name');

  // Check cache first and load models
  useEffect(() => {
    const loadModels = async () => {
      if (!apiKey) {
        setError('No API key available');
        setLoading(false);
        return;
      }

      // Check cache first
      const cachedModels = getCachedModels();
      if (cachedModels) {
        console.log('Using cached models');
        setModels(cachedModels);
        setLoading(false);
        // If cache is stale, refresh in background
        if (isCacheStale()) {
          console.log('Cache is stale, refreshing in background');
          refreshModels(true);
        }
        return;
      }

      // No cache, fetch fresh
      await refreshModels(false);
    };

    loadModels();
  }, [apiKey]);

  const refreshModels = async (background = false) => {
    if (!apiKey) return;

    try {
      if (!background) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      const availableModels = await getModels();
      // Sort by name initially
      availableModels.sort((a, b) => a.name.localeCompare(b.name));
      setModels(availableModels);
      setCachedModels(availableModels);
    } catch (err: any) {
      console.error('Failed to load models:', err);
      setError(err.error?.message || 'Failed to load models');
      // If we have cached data, keep showing it
      if (models.length === 0) {
        popup({
          message: err.error?.message || 'Failed to load models',
          emoji: '🚨',
          type: 'error',
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = useCallback(() => {
    clearModelsCache();
    refreshModels(false);
  }, [apiKey, clearModelsCache]);

  // Filter and sort models
  const filteredAndSortedModels = useMemo(() => {
    let filtered = [...models];

    // Apply affordable filter
    if (affordableFilter && balance !== null) {
      const balanceSats = balance / 1000; // Convert msats to sats
      filtered = filtered.filter((model) => {
        // Check if max_cost is within balance (convert to sats if needed)
        const maxCost = model.sats_pricing.max_cost;
        return maxCost <= balanceSats;
      });
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'price-asc':
          return a.sats_pricing.max_cost - b.sats_pricing.max_cost;
        case 'price-desc':
          return b.sats_pricing.max_cost - a.sats_pricing.max_cost;
        case 'context-asc':
          return a.context_length - b.context_length;
        case 'context-desc':
          return b.context_length - a.context_length;
        default:
          return 0;
      }
    });

    return filtered;
  }, [models, affordableFilter, balance, sortBy]);

  const handleModelSelect = (modelId: string) => {
    setSelectedModel(modelId);
    sheetRef.current?.hide({ payload: { modelId } });
  };

  const renderFilterButton = useCallback(
    ({
      icon,
      onPress,
      isActive,
      className = '',
    }: {
      icon: string;
      onPress: () => void;
      isActive: boolean;
      className?: string;
    }) => (
      <TouchableOpacity
        onPress={onPress}
        className={`${className} flex-1 rounded-lg border p-2 ${
          isActive ? 'bg-primary-700' : 'bg-primary-950'
        } border-primary-700`}>
        <HStack align="center" justify="center">
          <Icon
            name={icon}
            size={20}
            color={isActive ? getPrimaryColor('0') : getPrimaryColor('500')}
          />
        </HStack>
      </TouchableOpacity>
    ),
    [getPrimaryColor]
  );

  const renderItem: ListRenderItem<RoutstrModel> = useCallback(
    ({ item }) => (
      <ModelItem
        model={item}
        selected={item.id === (selectedModel || 'gpt-3.5-turbo')}
        onPress={() => handleModelSelect(item.id)}
      />
    ),
    [selectedModel]
  );

  const keyExtractor = useCallback((item: RoutstrModel) => item.id, []);

  const getItemLayout = useCallback(
    (_data: any, index: number) => ({
      length: 120, // Estimated item height
      offset: 120 * index,
      index,
    }),
    []
  );

  return (
    <Wrapper>
      <VStack flex={1} className="px-4">
        <Spacer size={16} />
        <Text weight="heavy" size={24} className="text-primary-0">
          Select Model
        </Text>
        <Spacer size={8} />
        <Text size={14} className="text-primary-400">
          Choose an AI model for your chat
        </Text>
        <Spacer size={16} />

        {/* Filter buttons */}
        <HStack justify="space-between" align="center" className="mb-2 w-full">
          {/* Affordable filter */}
          {renderFilterButton({
            icon: 'solar:wallet-bold',
            onPress: () => setAffordableFilter(!affordableFilter),
            isActive: affordableFilter,
            className: 'mr-2',
          })}

          {/* Separator */}
          <View className="mr-2 h-4 w-px" style={{ backgroundColor: getPrimaryColor('700') }} />

          {/* Sort buttons */}
          {renderFilterButton({
            icon: 'mdi:sort-alphabetical',
            onPress: () => setSortBy('name'),
            isActive: sortBy === 'name',
            className: 'mr-2',
          })}

          {renderFilterButton({
            icon:
              sortBy === 'price-desc'
                ? 'mdi:sort-numeric-descending'
                : 'mdi:sort-numeric-ascending',
            onPress: () => setSortBy(sortBy === 'price-asc' ? 'price-desc' : 'price-asc'),
            isActive: sortBy === 'price-asc' || sortBy === 'price-desc',
            className: 'mr-2',
          })}

          {renderFilterButton({
            icon:
              sortBy === 'context-desc'
                ? 'mdi:sort-numeric-descending'
                : 'mdi:sort-numeric-ascending',
            onPress: () => setSortBy(sortBy === 'context-asc' ? 'context-desc' : 'context-asc'),
            isActive: sortBy === 'context-asc' || sortBy === 'context-desc',
          })}
        </HStack>

        <Spacer size={8} />

        {loading && models.length === 0 ? (
          <VStack align="center" justify="center" flex={1}>
            <ActivityIndicator size="large" color={getPrimaryColor('400')} />
            <Spacer size={16} />
            <Text className="text-primary-400">Loading models...</Text>
          </VStack>
        ) : error && models.length === 0 ? (
          <VStack align="center" justify="center" flex={1}>
            <Icon name="mdi:alert-circle" size={48} color={getPrimaryColor('500')} />
            <Spacer size={16} />
            <Text className="text-primary-400" textAlign="center">
              {error}
            </Text>
          </VStack>
        ) : filteredAndSortedModels.length === 0 ? (
          <VStack align="center" justify="center" flex={1}>
            <Icon name="mdi:filter-off" size={48} color={getPrimaryColor('500')} />
            <Spacer size={16} />
            <Text className="text-primary-400" textAlign="center">
              {affordableFilter
                ? 'No affordable models found. Try adjusting your filters.'
                : 'No models available'}
            </Text>
          </VStack>
        ) : (
          <FlatList
            data={filteredAndSortedModels}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            getItemLayout={getItemLayout}
            removeClippedSubviews={true}
            initialNumToRender={10}
            windowSize={10}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={getPrimaryColor('400')}
              />
            }
            contentContainerStyle={{ paddingBottom: 16 }}
          />
        )}
      </VStack>
    </Wrapper>
  );
};

export default ListRoute;
