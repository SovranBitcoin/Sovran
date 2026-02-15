import React from 'react';
import { HStack } from 'components/ui/View/HStack';
import { Text } from 'components/ui/Text';
import Icon from 'assets/icons';
import { useTheme } from '@/providers/ThemeProvider';
import opacity from 'hex-color-opacity';

interface SearchTipProps {
  icon: string;
  text: string;
}

export function SearchTip({ icon, text }: SearchTipProps) {
  const { getPrimaryColor } = useTheme();
  return (
    <HStack spacing={0} align="center">
      <Icon name={icon} size={20} color={opacity(getPrimaryColor('0'), 0.5)} />
      <Text
        className="flex-1 pl-2"
        size={14}
        overpass
        regular
        style={{ color: opacity(getPrimaryColor('0'), 0.5) }}>
        {text}
      </Text>
    </HStack>
  );
}
