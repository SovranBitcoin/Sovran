import React from 'react';
import { VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { SearchTip } from './SearchTip';

export function EmptyStateView() {
  return (
    <VStack spacing={24} align="center" className="mt-6">
      <VStack className="bg-primary-800 h-20 w-20 items-center justify-center rounded-full">
        <Icon name="majesticons:search-line" size={40} color="#9ca3af" />
      </VStack>

      <Text className="text-primary-50 text-center" overpass bold size={20}>
        Search for Users
      </Text>

      <Text className="text-primary-400 text-center" size={16} overpass regular>
        Type a name, public key, or NIP-05 identifier to find users on the network
      </Text>

      <VStack className="bg-primary-800 w-full rounded-xl p-4">
        <Text overpass bold size={16} className="text-primary-100">
          Search Tips:
        </Text>
        <VStack spacing={12} className="mt-2">
          <SearchTip icon="ph:user-bold" text="Search by username or display name" />
          <SearchTip icon="solar:key-bold" text="Search by public key" />
          <SearchTip icon="mdi:at" text="Search by NIP-05 identifier" />
        </VStack>
      </VStack>
    </VStack>
  );
}
