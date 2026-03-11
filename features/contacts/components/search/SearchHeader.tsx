import React, { FC } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SearchBar } from './SearchBar';
import { SearchFilters } from './SearchFilters';
import { SEARCH_BAR_HEIGHT } from '../../lib/constants/styles';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';

type SearchHeaderProps = {
  onClose: () => void;
  onQueryChange?: (query: string) => void;
  onFilterChange?: (filter: string) => void;
};

export const SearchHeader: FC<SearchHeaderProps> = ({
  onClose,
  onQueryChange,
  onFilterChange,
}) => {
  const [foreground, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface-tertiary',
  ] as const);

  return (
    <Animated.View entering={FadeIn.delay(200).duration(150)}>
      <View style={styles.searchBarRow}>
        <Pressable
          onPress={onClose}
          style={[
            styles.closeButton,
            { backgroundColor: opacity(surfaceTertiary, 0.5) },
          ]}>
          <Feather name="x" size={22} color={foreground} />
        </Pressable>
        <SearchBar onQueryChange={onQueryChange} />
      </View>
      <SearchFilters onFilterChange={onFilterChange} />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: SEARCH_BAR_HEIGHT,
  },
  closeButton: {
    height: '100%',
    aspectRatio: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
