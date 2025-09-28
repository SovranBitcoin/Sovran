import React from 'react';
import { VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { greys, Theme } from 'helper/colors';
import { SearchTip } from './SearchTip';

interface EmptyStateViewProps {
  theme: Theme;
}

export function EmptyStateView({ theme }: EmptyStateViewProps) {
  return (
    <VStack spacing={24} align="center" className="mt-6">
      <VStack
        className="h-20 w-20 items-center justify-center rounded-full"
        style={{ backgroundColor: greys(theme)[800] }}>
        <Icon name="majesticons:search-line" size={40} color={greys(theme)[400]} />
      </VStack>

      <Text
        className="text-center"
        overpass
        bold
        size={20}
        style={{
          color: greys(theme)[50],
        }}>
        Search for Users
      </Text>

      <Text
        className="text-center"
        size={16}
        overpass
        regular
        style={{
          color: greys(theme)[400],
        }}>
        Type a name, public key, or NIP-05 identifier to find users on the network
      </Text>

      <VStack className="w-full rounded-xl p-4" style={{ backgroundColor: greys(theme)[800] }}>
        <Text
          overpass
          bold
          size={16}
          style={{
            color: greys(theme)[100],
          }}>
          Search Tips:
        </Text>
        <VStack spacing={12} className="mt-2">
          <SearchTip icon="ph:user-bold" text="Search by username or display name" theme={theme} />
          <SearchTip icon="solar:key-bold" text="Search by public key" theme={theme} />
          <SearchTip icon="mdi:at" text="Search by NIP-05 identifier" theme={theme} />
        </VStack>
      </VStack>
    </VStack>
  );
}
