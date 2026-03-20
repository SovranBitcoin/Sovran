import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';

import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from '@/assets/icons';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

interface MintBalanceDisplayProps {
  unit: string;
  mintName?: string;
  mintIconUrl?: string;
  balance: number;
  isLoading?: boolean;
  contentWidth?: number;
  contentHeight?: number;
  style?: StyleProp<ViewStyle>;
}

const MintBalanceDisplay: React.FC<MintBalanceDisplayProps> = ({
  unit,
  mintName,
  mintIconUrl,
  balance,
  isLoading = false,
  contentWidth,
  contentHeight,
  style,
}) => {
  const foreground = useThemeColor('foreground');

  const innerHeight = contentHeight ?? 36;
  const innerWidth = contentWidth;

  return (
    <HStack
      align="center"
      justify="space-between"
      style={[{ height: innerHeight, width: innerWidth }, style]}>
      <HStack align="center">
        <View className="mr-1">
          <Avatar
            picture={mintIconUrl}
            size={32}
            name={mintName}
            loading={isLoading}
            alt={`${mintName || 'Mint'} icon`}
          />
        </View>
        <VStack align="flex-start">
          <Text
            loading={isLoading}
            placeholder="Mint Name"
            style={{ color: foreground }}
            size={12}
            bold>
            {isLoading ? undefined : mintName || undefined}
          </Text>
          {isLoading ? (
            <Text loading placeholder="1,000 sats" size={12} bold>
              {undefined}
            </Text>
          ) : (
            <AmountFormatter
              className="ml-1"
              size={12}
              weight="heavy"
              amount={balance}
              unit={unit}
            />
          )}
        </VStack>
      </HStack>

      <View className="mr-2">
        <Icon name="fluent:chevron-down-12-filled" size={12} color={foreground} />
      </View>
    </HStack>
  );
};

export default MintBalanceDisplay;
