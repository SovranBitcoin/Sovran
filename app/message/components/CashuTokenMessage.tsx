import React from 'react';
import { Pressable, ColorValue } from 'react-native';
import { View, HStack, VStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { LinearGradient } from 'expo-linear-gradient';
import { getDecodedToken } from '@cashu/cashu-ts';
import { useTheme } from 'providers/ThemeProvider';
import { Button } from 'components/ui/Button';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { useCashuOperations } from 'hooks/coco';
import { usePaginatedHistory } from 'coco-cashu-react';
import { showMessage } from 'helper/popup/popups';
// Removed useCashu - now using usePaginatedHistory directly
import { router } from 'expo-router';

interface Props {
  token: string;
  isReceived: boolean;
}

const CashuTokenComponent = ({ token, isReceived }: Props) => {
  const { getPrimaryColor, getShadeColor, getRedColor, getGreenColor } = useTheme();
  const { receiveEcash } = useCashuOperations();
  const { history: transactions } = usePaginatedHistory();

  const decoded = getDecodedToken(token);
  const amount = decoded.proofs.reduce((a, p) => a + p.amount, 0);
  const unit = decoded.unit;

  const transaction = transactions.find((t) => t.token === token);
  const isClaimed = Boolean(transaction);

  const handleViewTransaction = () => {
    if (transaction) {
      router.push({
        pathname: '/transaction',
        params: {
          id: transaction.token || transaction.request || '',
          transactionType: transaction.transactionType,
        },
      });
    }
  };

  const handleRedeem = async () => {
    if (!unit) {
      showMessage({ message: 'No unit set', emoji: '🚨', type: 'error' });
      return;
    }

    try {
      await receiveEcash(token);
      showMessage({
        message: 'funds_received',
        params: { amount, unit },
        emoji: '🎉',
        type: 'success',
      });
    } catch (error) {
      showMessage({
        message: error instanceof Error ? error.message : 'Failed to receive ecash',
        emoji: '🚨',
        type: 'error',
      });
    }
  };

  const gradientColors: readonly [ColorValue, ColorValue, ...ColorValue[]] = isReceived
    ? [getPrimaryColor('500'), getPrimaryColor('500')]
    : [getShadeColor('200'), getShadeColor('300')];

  return (
    <View
      className={`relative my-2 w-full ${isReceived ? 'self-start' : 'self-end'}`}
      style={{ minHeight: 120 }} // Ensure minimum height for token messages
    >
      <View
        className="absolute -bottom-1 h-2 w-2"
        style={{
          backgroundColor: isReceived ? getPrimaryColor('500') : getRedColor('300'),
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
            minHeight: 100, // Ensure minimum height for content
          }}>
          <Text className="text-primary-0 text-xs font-bold opacity-75">{decoded.mint}</Text>

          <HStack justify="space-between" className="mt-2">
            <VStack>
              {unit && (
                <AmountFormatter
                  amount={amount}
                  unit={unit}
                  size={24}
                  weight="heavy"
                  color={getPrimaryColor('0')}
                />
              )}
              {decoded.memo && (
                <Text className="text-primary-0 bg-primary-0/10 mt-2 rounded-lg p-4 text-xs">
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
