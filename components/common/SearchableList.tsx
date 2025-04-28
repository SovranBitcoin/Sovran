import React, { useCallback } from 'react';
import { Pressable, ViewStyle } from 'react-native';
import { Text, View } from 'components/common/Themed';
import { greys } from 'helper/colors';
import TextInput from 'components/common/TextInput';
import { ReactNode } from 'react';

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
}: SearchableListProps): JSX.Element {
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
          backgroundColor: greys(theme)[1800],
          borderColor: greys(theme)[1300],
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
    <View style={{ backgroundColor: greys(theme)[2300] }}>
      <TextInput placeholder={searchPlaceholder} value={searchText} onChangeText={onSearchChange} />
      <View className="h-4" style={{ backgroundColor: 'transparent' }} />
      {data.map(renderItem)}
    </View>
  );
}
