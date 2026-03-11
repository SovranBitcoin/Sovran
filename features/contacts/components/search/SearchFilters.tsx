import React, { useRef, useState } from 'react';
import { FlatList, View, StyleSheet } from 'react-native';
import FilterItem from './SearchFilterItem';
import { SEARCH_FILTERS_HEIGHT } from '../../lib/constants/styles';

const FILTERS = ['All', 'Recent', 'Mints'] as const;

type SearchFiltersProps = {
  onFilterChange?: (filter: string) => void;
};

export const SearchFilters = ({ onFilterChange }: SearchFiltersProps) => {
  const [activeFilterItem, setActiveFilterItem] = useState<string>('All');
  const flatListRef = useRef<FlatList<string>>(null);

  const handleFilterChange = (filter: string) => {
    setActiveFilterItem(filter);
    onFilterChange?.(filter);
  };

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={FILTERS as unknown as string[]}
        keyExtractor={(item) => item}
        renderItem={({ item, index }) => (
          <FilterItem
            item={item}
            index={index}
            flatListRef={flatListRef}
            activeFilterItem={activeFilterItem}
            setActiveFilterItem={handleFilterChange}
          />
        )}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: SEARCH_FILTERS_HEIGHT,
    marginHorizontal: -20,
  },
  content: {
    gap: 4,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
});
