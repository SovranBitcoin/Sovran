import React, { useCallback, ReactNode } from 'react';
import { Pressable, ViewStyle, ScrollView } from 'react-native';
import { HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { greys, Theme } from 'helper/colors';
import TextInput from 'components/ui/TextInput';

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
        className="rounded-full p-2"
        style={{
          backgroundColor: greys(theme)[800],
          borderColor: greys(theme)[600],
          borderWidth: 0.2,
          marginBottom: 8,
          ...itemStyle,
        }}
        onPress={() => onItemPress(item)}>
        <HStack align="center" spacing={8}>
          {renderIcon(item)}
          <Text weight="heavy" size={16} style={{ color: greys(theme)[0] }}>
            {getLabel(item)}
          </Text>
        </HStack>
      </Pressable>
    ),
    [getKey, renderIcon, getLabel, onItemPress, theme, itemStyle]
  );

  return (
    <VStack style={{ backgroundColor: greys(theme)[950] }}>
      <TextInput placeholder={searchPlaceholder} value={searchText} onChangeText={onSearchChange} />
      <Spacer size={16} />
      <ScrollView>{data.map(renderItem)}</ScrollView>
    </VStack>
  );
}
