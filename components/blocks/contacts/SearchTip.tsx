import React from 'react';
import { HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { greys, Theme } from 'helper/colors';

interface SearchTipProps {
  icon: string;
  text: string;
  theme: Theme;
}

export function SearchTip({ icon, text, theme }: SearchTipProps) {
  return (
    <HStack spacing={0} align="center">
      <Icon name={icon} size={20} color={greys(theme)[300]} />
      <Text className="flex-1 pl-2" size={14} overpass regular style={{ color: greys(theme)[200] }}>
        {text}
      </Text>
    </HStack>
  );
}
