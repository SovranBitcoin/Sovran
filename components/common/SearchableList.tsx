import React, { useCallback, ReactNode } from 'react';
import { Pressable, ViewStyle, ScrollView } from 'react-native';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { greys, Theme } from 'helper/colors';
import TextInput from 'components/common/TextInput';

interface SearchableListProps<T> {
  searchText: string;
  onSearchChange: (text: string) => void;
  data: readonly T[];
  renderIcon: (item: T) => ReactNode;
  getLabel: (item: T) => string;
  onItemPress: (item: T) => void;
  searchPlaceholder: string;
  theme: Theme;
  itemStyle?: ViewStyle;
  getItemKey?: (item: T) => string | number;
}

export function SearchableList<T>({
  searchText,
  onSearchChange,
  data,
  renderIcon,
  getLabel,
  onItemPress,
  searchPlaceholder,
  theme,
  itemStyle,
  getItemKey,
}: SearchableListProps<T>) {
  // Extract item key generation logic
  const getKey = useCallback(
    (item: T): string | number => {
      if (getItemKey) return getItemKey(item);
      return typeof item === 'string' ? item : (item as any).id || item;
    },
    [getItemKey]
  );

  // Memoize the item rendering function
  const renderItem = useCallback(
    (item: T) => (
      <Pressable
        key={getKey(item)}
        className="mb-2 flex-row items-center rounded-full p-2"
        style={{
          backgroundColor: greys(theme)[800],
          borderColor: greys(theme)[600],
          borderWidth: 0.2,
          ...itemStyle,
        }}
        onPress={() => onItemPress(item)}>
        {renderIcon(item)}
        <Text weight="heavy" size={16} style={{ marginLeft: 8, color: greys(theme)[0] }}>
          {getLabel(item)}
        </Text>
      </Pressable>
    ),
    [getKey, renderIcon, getLabel, onItemPress, theme, itemStyle]
  );

  return (
    <View style={{ backgroundColor: greys(theme)[950] }}>
      <TextInput placeholder={searchPlaceholder} value={searchText} onChangeText={onSearchChange} />
      <View className="h-4" style={{ backgroundColor: 'transparent' }} />
      <ScrollView>{data.map(renderItem)}</ScrollView>
    </View>
  );
}
