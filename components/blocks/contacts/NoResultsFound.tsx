import React from 'react';
import { VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { greys, Theme } from 'helper/colors';
import { SearchTip } from './SearchTip';

interface NoResultsFoundProps {
  theme: Theme;
}

export function NoResultsFound({ theme }: NoResultsFoundProps) {
  return (
    <VStack spacing={24} align="center" className="mt-6 px-6">
      <VStack
        className="h-20 w-20 items-center justify-center rounded-full"
        style={{ backgroundColor: greys(theme)[800] }}>
        <Icon name="nonicons:error-16" size={40} color={greys(theme)[400]} />
      </VStack>

      <VStack spacing={12}>
        <Text
          className="text-center"
          overpass
          bold
          size={20}
          style={{
            color: greys(theme)[50],
          }}>
          No Results Found
        </Text>

        <Text
          className="text-center"
          overpass
          regular
          size={16}
          style={{
            color: greys(theme)[400],
          }}>
          {"We couldn't find any users matching your search"}
        </Text>
      </VStack>

      <VStack className="w-full rounded-xl p-4" style={{ backgroundColor: greys(theme)[800] }}>
        <Text
          overpass
          bold
          size={16}
          style={{
            color: greys(theme)[100],
          }}>
          Try adjusting your search:
        </Text>
        <VStack spacing={12} className="mt-2">
          <SearchTip icon="lucide:pencil-line" text="Check your spelling" theme={theme} />
          <SearchTip icon="solar:key-bold" text="Try using a complete public key" theme={theme} />
          <SearchTip icon="mdi:at" text="Use a different NIP-05 identifier" theme={theme} />
        </VStack>
      </VStack>
    </VStack>
  );
}
