import React, { useState } from 'react';
import { Button } from 'components/ui/Button';
import Icon from 'assets/icons';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { TransactionBuilder } from 'helper/redux/cashu';
import { memoizedGetTheme } from 'helper/redux/settings';
import { MintIcon } from 'components/blocks/sheets/mints';
import { Essential } from 'helper/Essential';
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
  const [loading, setLoading] = useState(false);

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
          <MintIcon size={40} mintInfo={mintInfo} />
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
        {!transaction?.paid && handleCheckStatus && (
          <Button
            style={{
              padding: 0,
              width: 40,
              height: 40,
            }}
            variant="secondary"
            disabled={loading}
            onPress={() => {
              setLoading(true);
              handleCheckStatus(() => {
                setLoading(false);
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
