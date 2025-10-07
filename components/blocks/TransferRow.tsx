import React, { useMemo } from 'react';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import Image from 'components/ui/Image';
import Icon from 'assets/icons';
import { memoizedGetMintInfo } from 'redux/cashu/selectors';
import { useTheme } from 'providers/ThemeProvider';
import Svg, { Circle } from 'react-native-svg';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';

type TransferStatus = 'pending' | 'success' | 'error' | undefined;

export interface TransferRowProps {
  fromMint: string;
  toMint: string;
  amount: number;
  unit: string;
  status?: TransferStatus;
  leftCta?: { label: string; onPress: () => void };
  rightCta?: { label: string; onPress: () => void };
}

const MintBadge = React.memo(function MintBadge({
  mintUrl,
  cta,
}: {
  mintUrl: string;
  cta?: { label: string; onPress: () => void };
}) {
  const mintInfo = useSelector(memoizedGetMintInfo(mintUrl));
  const mintName = mintInfo?.name || mintUrl.replace('https://', '').replace('http://', '');
  const iconUrl = mintInfo?.icon_url;

  const containerStyle = useMemo(
    () => ({
      paddingHorizontal: 4,
    }),
    []
  );

  const cardStyle = useMemo(
    () => ({
      backgroundColor: getPrimaryColor('800'),
      borderRadius: 10,
      padding: 10,
      minWidth: 90,
      borderWidth: 1,
      borderColor: getPrimaryColor('600'),
    }),
    [getPrimaryColor]
  );

  const imageStyle = useMemo(
    () => ({
      width: 28,
      height: 28,
      borderRadius: 7,
      backgroundColor: getPrimaryColor('500'),
    }),
    [getPrimaryColor]
  );

  const fallbackStyle = useMemo(
    () => ({
      width: 28,
      height: 28,
      borderRadius: 7,
      backgroundColor: getPrimaryColor('500'),
      borderWidth: 1,
      borderColor: getPrimaryColor('400'),
    }),
    [getPrimaryColor]
  );

  return (
    <VStack align="center" style={containerStyle}>
      <VStack align="center" style={cardStyle} spacing={6}>
        {iconUrl ? (
          <Image source={{ uri: iconUrl }} style={imageStyle} />
        ) : (
          <VStack align="center" justify="center" style={fallbackStyle}>
            <Text size={16} bold className="text-primary-100">
              {mintName.charAt(0).toUpperCase()}
            </Text>
          </VStack>
        )}
        <Text
          size={10}
          semibold
          className="text-primary-200"
          style={{ textAlign: 'center', lineHeight: 12 }}>
          {mintName}
        </Text>
        {cta && (
          <TouchableOpacity
            className="rounded"
            onPress={cta.onPress}
            style={{ paddingVertical: 4, paddingHorizontal: 6 }}>
            <Text size={10} bold className="text-primary-100">
              {cta.label}
            </Text>
          </TouchableOpacity>
        )}
      </VStack>
    </VStack>
  );
});

MintBadge.displayName = 'MintBadge';

export const TransferRow = React.memo(function TransferRow({
  fromMint,
  toMint,
  amount,
  unit,
  status,
  leftCta,
  rightCta,
}: TransferRowProps) {
  const { getPrimaryColor, getShadeColor } = useTheme();

  const size = 36;
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;

  const statusIcon = useMemo(() => {
    if (status === 'success')
      return <Icon name="material-symbols:check-rounded" size={24} color={getShadeColor('300')} />;
    if (status === 'error')
      return <Icon name="material-symbols:close-rounded" size={24} color={getShadeColor('300')} />;
    if (status === 'pending')
      return <Icon name="mdi:clock-time-three-outline" size={22} className="text-primary-300" />;
    return <Icon name="lucide:arrow-right" size={24} className="text-primary-400" />;
  }, [status]);

  return (
    <View className="bg-primary-700 border-primary-600 mb-3 rounded-2xl border px-2.5 py-3">
      <HStack align="center" justify="space-between">
        <MintBadge mintUrl={fromMint} cta={leftCta} />

        <VStack
          align="center"
          style={{
            paddingVertical: 8,
            marginHorizontal: 6,
          }}>
          <View
            style={{
              position: 'relative',
              alignItems: 'center',
              justifyContent: 'center',
              width: size,
              height: size,
            }}>
            <Svg width={size} height={size}>
              <Circle
                stroke="rgb(75 85 99)"
                fill="none"
                cx={size / 2}
                cy={size / 2}
                r={radius}
                strokeWidth={strokeWidth}
              />
            </Svg>
            <View
              style={{
                position: 'absolute',
                alignItems: 'center',
                justifyContent: 'center',
                width: size,
                height: size,
              }}>
              {statusIcon}
            </View>
          </View>
          <Spacer size={3} />
          <Text size={12} bold className="text-primary-0 text-center">
            {amount} {unit.toUpperCase()}
          </Text>
        </VStack>

        <MintBadge mintUrl={toMint} cta={rightCta} />
      </HStack>
    </View>
  );
});

TransferRow.displayName = 'TransferRow';
