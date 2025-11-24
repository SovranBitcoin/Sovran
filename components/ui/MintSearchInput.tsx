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
}

export function MintSearchInput({
  value,
  onChangeText,
  placeholder = 'Enter mint URL or search mints...',
  validationState,
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
      return (
        <Text size={16} className="text-green-300">
          ✓
        </Text>
      );
    }
    if (validationState.isValid === false) {
      return (
        <Text size={16} className="text-red-300">
          ✗
        </Text>
      );
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
        </HStack>
      </HStack>

      {validationState.error && (
        <Text size={12} className="text-red-300">
          {validationState.error}
        </Text>
      )}

      {validationState.isValid === true && (
        <Text size={12} className="text-green-300">
          Valid mint URL
        </Text>
      )}
    </VStack>
  );
}
