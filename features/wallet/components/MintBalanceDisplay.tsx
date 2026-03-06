import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Link, Href } from 'expo-router';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { supportsLiquidGlass } from '@/shared/lib/version';
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
  isLoadingMint?: boolean;
  contentWidth?: number;
  contentHeight?: number;
  linkHref: Href;
  style?: StyleProp<ViewStyle>;
}

const MintBalanceDisplay: React.FC<MintBalanceDisplayProps> = ({
  unit,
  mintName,
  mintIconUrl,
  balance,
  isLoadingMint = false,
  contentWidth,
  contentHeight,
  linkHref,
  style,
}) => {
  const [foreground, defaultColor, surfaceSecondary] = useThemeColor([
    'foreground',
    'default',
    'surface-secondary',
  ] as const);

  const innerHeight = contentHeight ?? 36;
  const innerWidth = contentWidth;

  const mintInfoContent = (
    <HStack
      align="center"
      justify="space-between"
      style={{ height: innerHeight, width: innerWidth }}>
      <HStack align="center">
        <View className="mr-1">
          <Avatar
            picture={mintIconUrl}
            size={32}
            name={mintName}
            loading={isLoadingMint}
            alt={`${mintName || 'Mint'} icon`}
          />
        </View>
        <VStack align="flex-start">
          <Text
            loading={isLoadingMint}
            placeholder="Mint Name"
            style={{ color: foreground }}
            size={12}
            bold>
            {isLoadingMint ? undefined : mintName || undefined}
          </Text>
          {isLoadingMint ? (
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

  if (supportsLiquidGlass()) {
    return (
      <Link
        href={linkHref}
        style={{ width: contentWidth ?? '100%', height: contentHeight ?? '100%' }}>
        {mintInfoContent}
      </Link>
    );
  }

  return (
    <Link href={linkHref} asChild>
      <TouchableOpacity haptics>
        <HStack
          blur
          align="center"
          justify="space-between"
          className="rounded-2xl"
          style={[
            {
              flexGrow: 0,
              flexShrink: 0,
              width: '100%',
              padding: 8,
              borderWidth: 0.2,
              borderColor: defaultColor,
              alignSelf: 'center',
              backgroundColor: surfaceSecondary,
            },
            style,
          ]}>
          {mintInfoContent}
        </HStack>
      </TouchableOpacity>
    </Link>
  );
};

export default MintBalanceDisplay;
