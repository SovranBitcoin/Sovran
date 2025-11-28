import React from 'react';
import { VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';

export function EmptyStateView() {
  const { getPrimaryColor } = useTheme();

  return (
    <VStack spacing={8} align="center" className="m-6">
      <VStack justify="center" align="center" className="h-20 w-20 rounded-full bg-primary-800">
        <Icon name="majesticons:search-line" size={40} color={getPrimaryColor('400')} />
      </VStack>

      <Text
        className="text-primary-50"
        overpass
        bold
        size={20}
        style={{ color: getPrimaryColor('400') }}>
        Search for Users
      </Text>

      <Text
        className="text-center text-primary-400"
        size={16}
        overpass
        regular
        style={{ color: getPrimaryColor('500') }}>
        Type a name, public key, or NIP-05 identifier to find users on the network
      </Text>
    </VStack>
  );
}
