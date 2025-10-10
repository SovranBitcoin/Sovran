import React from 'react';
import { VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { SearchTip } from './SearchTip';

export function NoResultsFound() {
  return (
    <VStack spacing={24} align="center" className="mt-6 px-6">
      <VStack className="h-20 w-20 items-center justify-center rounded-full bg-primary-800">
        <Icon name="nonicons:error-16" size={40} color="#9ca3af" />
      </VStack>

      <VStack spacing={12}>
        <Text className="text-center text-primary-50" overpass bold size={20}>
          No Results Found
        </Text>

        <Text className="text-center text-primary-400" overpass regular size={16}>
          {"We couldn't find any users matching your search"}
        </Text>
      </VStack>

      <VStack className="w-full rounded-xl bg-primary-800 p-4">
        <Text overpass bold size={16} className="text-primary-100">
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
