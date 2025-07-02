import React, { useCallback, ReactNode } from 'react';
import { Pressable, ViewStyle, ScrollView } from 'react-native';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { greys } from 'helper/colors';
import TextInput from 'components/common/TextInput';

type ItemId = string | number;

interface ListItem {
  id: ItemId;
  [key: string]: any;
}

type DataItem = ListItem | string;

interface SearchableListProps {
  searchText: string;
  onSearchChange: (text: string) => void;
  data: readonly DataItem[];
  renderIcon: (item: DataItem) => ReactNode;
  getLabel: (item: DataItem) => string;
  onItemPress: (item: DataItem) => void;
  searchPlaceholder: string;
  theme: string;
  itemStyle?: ViewStyle;
}

export function SearchableList({
  searchText,
  onSearchChange,
  data,
  renderIcon,
  getLabel,
  onItemPress,
  searchPlaceholder,
  theme,
  itemStyle,
}: SearchableListProps) {
  // Extract item key generation logic
  const getItemKey = useCallback((item: DataItem): ItemId => {
    return typeof item === 'string' ? item : item.id;
  }, []);

  // Memoize the item rendering function
  const renderItem = useCallback(
    (item: DataItem) => (
      <Pressable
        key={getItemKey(item)}
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
    [getItemKey, renderIcon, getLabel, onItemPress, theme, itemStyle]
  );

  return (
    <View style={{ backgroundColor: greys(theme)[950] }}>
      <TextInput placeholder={searchPlaceholder} value={searchText} onChangeText={onSearchChange} />
      <View className="h-4" style={{ backgroundColor: 'transparent' }} />
      <ScrollView>{data.map(renderItem)}</ScrollView>
    </View>
  );
}
