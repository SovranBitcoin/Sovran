import React from 'react';
import { TextInput as RNTextInput, ActivityIndicator } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from './Text';
import { HStack, VStack } from './View';

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
  const { getPrimaryColor } = useTheme();

  const getStatusColor = () => {
    if (validationState.isLoading) return getPrimaryColor('400');
    if (validationState.isValid === true) return '#10B981'; // green-500
    if (validationState.isValid === false) return '#EF4444'; // red-500
    return getPrimaryColor('400');
  };

  const getStatusIcon = () => {
    if (validationState.isLoading) {
      return <ActivityIndicator size="small" color={getPrimaryColor('400')} />;
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
          backgroundColor: getPrimaryColor('800'),
          borderColor: getStatusColor(),
          borderWidth: 1,
        }}>
        <RNTextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={getPrimaryColor('400')}
          style={{
            flex: 1,
            color: getPrimaryColor('0'),
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
