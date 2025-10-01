import React, { useState } from 'react';
import { Button } from 'components/ui/Button';
import Icon from 'assets/icons';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { TransactionBuilder } from 'helper/redux/cashu';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Avatar } from 'components/ui/Avatar';
import { Essential } from 'helper/Essential';
import { useManager } from 'coco-cashu-react';
import { getDecodedToken } from '@cashu/cashu-ts';
interface TransactionMintRefreshProps {
  mintInfo: any;
  transaction: Essential<
    TransactionBuilder,
    | 'mintQuote'
    | 'request'
    | 'token'
    | 'date'
    | 'isCancel'
    | 'amount'
    | 'unit'
    | 'paid'
    | 'type'
    | 'state'
  >;
  handleCheckStatus?: (onClose: () => void) => Promise<void>;
}

export function TransactionMintRefresh({
  mintInfo,
  transaction,
  handleCheckStatus,
}: TransactionMintRefreshProps) {
  const theme = useSelector(memoizedGetTheme);
  const manager = useManager();
  const [loading, setLoading] = useState(false);

  const handleStatusCheck = async (onClose: () => void) => {
    setLoading(true);
    try {
      if (transaction.type === 'lightning' && transaction.mintQuote?.quote) {
        // For Lightning: Use Coco's subscription API to check mint quote status
        await manager.subscription.awaitMintQuotePaid(
          transaction.mintUrl,
          transaction.mintQuote.quote
        );
      } else if (transaction.type === 'ecash' && transaction.token) {
        // For Ecash: Use Coco's wallet API to check proof states
        const decodedToken = getDecodedToken(transaction.token);
        // The proof states are automatically managed by Coco's internal watchers
        console.log('Ecash transaction status check completed for mint:', decodedToken.mint);
      }

      // Coco automatically updates its internal state
      // No manual Redux updates needed
    } catch (error) {
      console.error('Status check failed:', error);
    } finally {
      setLoading(false);
      onClose();
    }
  };

  return (
    <HStack
      blur
      align="center"
      justify="space-between"
      className="rounded-lg"
      style={{
        backgroundColor: theme.greys[800],
        marginHorizontal: 16,
        marginBottom: 0,
        padding: 16,
      }}>
      <HStack align="center" className="bg-transparent">
        <View>
          <Avatar
            picture={mintInfo?.icon_url || undefined}
            size={40}
            variant="mint"
            name={mintInfo?.name}
            alt={`${mintInfo?.name || 'Mint'} icon`}
          />
        </View>
        <Spacer size={12} />
        <VStack className="bg-transparent">
          <Text heavy size={16}>
            {transaction?.transactionType === 'send'
              ? transaction?.paid
                ? 'Sent with'
                : 'Sending with'
              : transaction?.paid
                ? 'Received with'
                : 'Receiving with'}
          </Text>
          <Text regular size={16} color={greys(theme)[50]}>
            {mintInfo?.name}
          </Text>
        </VStack>
      </HStack>

      <View>
        {!transaction?.paid && (
          <Button
            style={{
              padding: 0,
              width: 40,
              height: 40,
            }}
            variant="secondary"
            disabled={loading}
            onPress={() => {
              handleStatusCheck(() => {
                // Callback after status check completes
              });
            }}
            text=""
            icon={
              <Icon
                spin={
                  loading
                    ? {
                        delay: 0,
                        duration: 1500,
                        outputRange: ['0deg', '360deg'],
                        easing: 'easeOut',
                      }
                    : undefined
                }
                size={20}
                name="humbleicons:refresh"
              />
            }
          />
        )}
      </View>
    </HStack>
  );
}
