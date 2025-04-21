import { StyleSheet, Pressable, ViewStyle } from 'react-native';
import { Text, View } from 'components/common/Themed';
import { greys } from 'helper/colors';
import TextInput from 'components/common/TextInput';
import { ReactNode } from 'react';

interface SearchableListProps {
  searchText: string;
  onSearchChange: (text: string) => void;
  data: any[];
  renderIcon: (item: any) => ReactNode;
  getLabel: (item: any) => string;
  onItemPress: (item: any) => void;
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
  const styles = createStyles(theme);

  const renderItem = (item: any) => (
    <Pressable
      key={typeof item === 'string' ? item : item.id}
      style={[styles.pressable, itemStyle]}
      onPress={() => onItemPress(item)}>
      {renderIcon(item)}
      <Text weight="heavy" size={16} style={styles.label}>
        {getLabel(item)}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <TextInput placeholder={searchPlaceholder} value={searchText} onChangeText={onSearchChange} />
      <View
        style={{
          height: 16,
          backgroundColor: 'transparent',
        }}></View>
      {data.map(renderItem)}
    </View>
  );
}

const createStyles = (theme: string) =>
  StyleSheet.create({
    container: {
      backgroundColor: greys(theme)[2300],
    },
    pressable: {
      padding: 8,
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
      backgroundColor: greys(theme)[1800],
      borderRadius: 1000,
      borderColor: greys(theme)[1300],
      borderWidth: 0.2,
    },
    label: {
      marginLeft: 8,
      color: greys(theme)[0],
    },
  });
