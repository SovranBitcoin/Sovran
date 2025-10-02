import React from 'react';
import { View, TextInput as RNTextInput } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { Text } from './Text';
import { HStack, VStack } from './View';
import { ActivityIndicator } from 'react-native';

interface MintSearchInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  validationState: {
    isValid: boolean | null;
    isLoading: boolean;
    error: string | null;
  };
  onAddMint?: () => void;
  canAddMint?: boolean;
}

export function MintSearchInput({
  value,
  onChangeText,
  placeholder = 'Enter mint URL or search mints...',
  validationState,
  onAddMint,
  canAddMint = false,
}: MintSearchInputProps) {
  const theme = useSelector(memoizedGetTheme);
  const g = greys(theme);

  const getStatusColor = () => {
    if (validationState.isLoading) return g[400];
    if (validationState.isValid === true) return '#10B981'; // green-500
    if (validationState.isValid === false) return '#EF4444'; // red-500
    return g[400];
  };

  const getStatusIcon = () => {
    if (validationState.isLoading) {
      return <ActivityIndicator size="small" color={g[400]} />;
    }
    if (validationState.isValid === true) {
      return <Text style={{ color: '#10B981', fontSize: 16 }}>✓</Text>;
    }
    if (validationState.isValid === false) {
      return <Text style={{ color: '#EF4444', fontSize: 16 }}>✗</Text>;
    }
    return null;
  };

  return (
    <VStack spacing={8}>
      <HStack
        align="center"
        className="rounded-lg border px-3 py-2"
        style={{
          backgroundColor: g[800],
          borderColor: getStatusColor(),
          borderWidth: 1,
        }}>
        <RNTextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={g[400]}
          style={{
            flex: 1,
            color: g[0],
            fontSize: 16,
            paddingVertical: 4,
          }}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          keyboardType="url"
          returnKeyType="search"
        />

        <HStack align="center" gap={8}>
          {getStatusIcon()}

          {canAddMint && onAddMint && (
            <Text
              onPress={onAddMint}
              className="rounded px-2 py-1"
              style={{
                backgroundColor: '#10B981',
                color: 'white',
                fontSize: 12,
                fontWeight: '600',
              }}>
              Add
            </Text>
          )}
        </HStack>
      </HStack>

      {validationState.error && (
        <Text style={{ color: '#EF4444', fontSize: 12 }}>{validationState.error}</Text>
      )}

      {validationState.isValid === true && (
        <Text style={{ color: '#10B981', fontSize: 12 }}>Valid mint URL</Text>
      )}
    </VStack>
  );
}
