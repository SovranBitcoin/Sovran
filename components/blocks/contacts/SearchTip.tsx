import React from 'react';
import { HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';

interface SearchTipProps {
  icon: string;
  text: string;
}

export function SearchTip({ icon, text }: SearchTipProps) {
  return (
    <HStack spacing={0} align="center">
      <Icon name={icon} size={20} className="text-primary-300" />
      <Text className="flex-1 pl-2 text-primary-200" size={14} overpass regular>
        {text}
      </Text>
    </HStack>
  );
}
