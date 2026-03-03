import React from 'react';
import { Pressable, ColorValue } from 'react-native';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { LinearGradient } from 'expo-linear-gradient';
import { getDecodedToken, type Proof } from '@cashu/cashu-ts';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Button } from '@/shared/ui/primitives/Button';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { useReceive } from 'coco-cashu-react';
import { noUnitSetPopup, receiveFailedPopup, receiveSuccessPopup } from '@/shared/lib/popup';

interface Props {
  token: string;
  isReceived: boolean;
}

const CashuTokenComponent = ({ token, isReceived }: Props) => {
  const [accent, foreground, danger] = useThemeColor(['accent', 'foreground', 'danger'] as const);
  const brandGradient = useThemeColor(['shade-200', 'shade-300', 'shade-400'] as const);
  const { receive } = useReceive();

  const decoded = getDecodedToken(token);
  const amount = decoded.proofs.reduce((a: number, p: Proof) => a + p.amount, 0);
  const unit = decoded.unit;

  const handleRedeem = async () => {
    if (!unit) {
      noUnitSetPopup();
      return;
    }

    try {
      await receive(token);
      receiveSuccessPopup({ amount, unit }, { icon: 'emoji:🎉' });
    } catch (error) {
      receiveFailedPopup({ text: error instanceof Error ? error.message : undefined });
    }
  };

  const gradientColors: readonly [ColorValue, ColorValue, ...ColorValue[]] = isReceived
    ? [accent, accent]
    : [brandGradient[0], brandGradient[1]];

  return (
    <View
      className={`relative my-2 w-full ${isReceived ? 'self-start' : 'self-end'}`}
      style={{ minHeight: 120 }}>
      <View
        className="absolute -bottom-1 h-2 w-2"
        style={{
          backgroundColor: isReceived ? accent : danger,
          left: isReceived ? 16 : 'auto',
          right: isReceived ? 'auto' : 16,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <Pressable>
        <LinearGradient
          colors={gradientColors}
          style={{
            borderRadius: 16,
            padding: 16,
            maxWidth: '75%',
            minHeight: 100,
          }}>
          <Text className="text-foreground text-xs font-bold opacity-75">{decoded.mint}</Text>

          <HStack justify="space-between" className="mt-2">
            <VStack>
              {unit && (
                <AmountFormatter
                  amount={amount}
                  unit={unit}
                  size={24}
                  weight="heavy"
                  color={foreground}
                />
              )}
              {decoded.memo && (
                <Text className="bg-foreground/10 text-foreground mt-2 rounded-lg p-4 text-xs">
                  {decoded.memo}
                </Text>
              )}
            </VStack>
          </HStack>
          <Button text={'Redeem'} variant="primary" onPress={handleRedeem} />
        </LinearGradient>
      </Pressable>
    </View>
  );
};

export default CashuTokenComponent;
