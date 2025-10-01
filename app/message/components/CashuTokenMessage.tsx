import React from 'react';
import { Pressable, ColorValue } from 'react-native';
import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { LinearGradient } from 'expo-linear-gradient';
import { getDecodedToken } from '@cashu/cashu-ts';
import { greys, shades, Theme } from 'helper/colors';
import { Button } from 'components/ui/Button';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { useCashuOperations } from 'hooks/coco';
import { usePaginatedHistory } from 'coco-cashu-react';
import { showMessage } from 'helper/popup/popups';
// Removed useCashu - now using usePaginatedHistory directly
import { useTypedNavigation } from 'helper/navigation';
import opacity from 'hex-color-opacity';

interface Props {
  token: string;
  theme: Theme;
  isReceived: boolean;
}

const CashuTokenComponent = ({ token, theme, isReceived }: Props) => {
  const { receiveEcash } = useCashuOperations();
  const { history: transactions } = usePaginatedHistory();
  const navigation = useTypedNavigation();

  const decoded = getDecodedToken(token);
  const amount = decoded.proofs.reduce((a, p) => a + p.amount, 0);
  const unit = decoded.unit;

  const transaction = transactions.find((t) => t.token === token);
  const isClaimed = Boolean(transaction);

  const handleViewTransaction = () => {
    if (transaction) {
      navigation.navigate('transaction', {
        id: transaction.token || transaction.request || '',
        transactionType: transaction.transactionType,
      });
    }
  };

  const handleRedeem = async () => {
    if (!unit) {
      showMessage('No unit set', {}, { emoji: '🚨' });
      return;
    }

    try {
      await receiveEcash(token);
      showMessage('funds_received', { amount, unit }, { emoji: '🎉' });
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : 'Failed to receive ecash',
        {},
        { emoji: '🚨' }
      );
    }
  };

  const gradientColors: readonly [ColorValue, ColorValue, ...ColorValue[]] = isReceived
    ? [greys(theme)[500], greys(theme)[500]]
    : [shades[200], shades[300]];

  return (
    <View className={`relative my-2 w-full ${isReceived ? 'self-start' : 'self-end'}`}>
      <View
        className="absolute -bottom-1 h-2 w-2"
        style={{
          backgroundColor: isReceived ? greys(theme)[500] : shades[300],
          left: isReceived ? 16 : 'auto',
          right: isReceived ? 'auto' : 16,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <Pressable onLongPress={handleViewTransaction}>
        <LinearGradient
          colors={gradientColors}
          style={{
            borderRadius: 16,
            padding: 16,
            maxWidth: '75%',
          }}>
          <Text className="text-xs font-bold opacity-75" style={{ color: greys(theme)[0] }}>
            {decoded.mint}
          </Text>

          <HStack justify="space-between" className="mt-2">
            <VStack>
              {unit && (
                <AmountFormatter
                  amount={amount}
                  unit={unit}
                  size={24}
                  weight="heavy"
                  color={greys(theme)[0]}
                />
              )}
              {decoded.memo && (
                <Text
                  className="mt-2 rounded-lg p-4 text-xs"
                  style={{
                    color: greys(theme)[0],
                    backgroundColor: opacity(greys(theme)[0], 0.1),
                  }}>
                  {decoded.memo}
                </Text>
              )}
            </VStack>
          </HStack>
          <Button
            text={isClaimed ? 'View Transaction' : 'Redeem'}
            variant="primary"
            onPress={isClaimed ? handleViewTransaction : handleRedeem}
          />
        </LinearGradient>
      </Pressable>
    </View>
  );
};

export default CashuTokenComponent;
