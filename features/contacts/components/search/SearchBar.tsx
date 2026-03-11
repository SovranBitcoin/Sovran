import React, { FC, useState } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

type SearchBarProps = {
  onQueryChange?: (query: string) => void;
};

export const SearchBar: FC<SearchBarProps> = ({ onQueryChange }) => {
  const [query, setQuery] = useState('');
  const [fieldBg, fieldFg, fieldPlaceholder] = useThemeColor([
    'field-background',
    'field-foreground',
    'field-placeholder',
  ] as const);

  const handleChange = (value: string) => {
    setQuery(value);
    onQueryChange?.(value);
  };

  return (
    <View style={[styles.container, { backgroundColor: fieldBg }]}>
      <Feather name="search" size={18} color={fieldPlaceholder} style={styles.searchIcon} />
      <TextInput
        value={query}
        onChangeText={handleChange}
        placeholder="Search contacts"
        placeholderTextColor={fieldPlaceholder}
        style={[styles.input, { color: fieldFg }]}
        autoFocus
        autoCorrect={false}
        autoCapitalize="none"
      />
      {query ? (
        <Pressable
          onPress={() => handleChange('')}
          style={styles.clearIcon}
          hitSlop={8}>
          <Feather name="x-circle" size={18} color={fieldPlaceholder} />
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 16,
    justifyContent: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: 11,
  },
  input: {
    paddingHorizontal: 40,
    height: '100%',
    fontSize: 16,
    lineHeight: 20,
  },
  clearIcon: {
    position: 'absolute',
    right: 13,
  },
});
