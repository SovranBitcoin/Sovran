import React from 'react';
import { VStack } from 'components/ui/View/VStack';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import Icon from '@/assets/icons';
import { SearchTip } from './SearchTip';

export function NoResultsFound() {
  const { getPrimaryColor } = useTheme();
  return (
    <VStack spacing={24} align="center" className="mt-3 px-4">
      <VStack justify="center" align="center" className="h-20 w-20 rounded-full bg-primary-800">
        <Icon name="nonicons:error-16" size={40} color={getPrimaryColor('400')} />
      </VStack>

      <VStack spacing={12}>
        <Text className="text-center" color={getPrimaryColor('300')} overpass bold size={20}>
          No Results Found
        </Text>

        <Text className="text-center" color={getPrimaryColor('400')} overpass regular size={16}>
          {"We couldn't find any users matching your search"}
        </Text>
      </VStack>

      <VStack className="w-full rounded-xl bg-primary-800 p-4">
        <Text color={getPrimaryColor('200')} overpass bold size={16}>
          Try adjusting your search:
        </Text>
        <VStack spacing={12} className="mt-2">
          <SearchTip icon="lucide:pencil-line" text="Check your spelling" />
          <SearchTip icon="solar:key-bold" text="Try using a complete public key" />
          <SearchTip icon="mdi:at" text="Use a different NIP-05 identifier" />
        </VStack>
      </VStack>
    </VStack>
  );
}
