import React, { useState } from 'react';
import { Button } from 'components/common/Button';
import Icon from 'assets/icons';
import { View, Text } from 'components/common/Themed';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { TransactionData } from 'helper/redux/cashu';
import { memoizedGetTheme } from 'helper/redux/settings';
import { MintIcon } from 'components/layout/sheets/mints';
interface TransactionMintRefreshProps {
  mintInfo: any;
  transaction: TransactionData;
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
    <View
      style={{
        backgroundColor: greys(theme)[1800],
      }}
      className="mx-4 mb-0 mt-4 flex-row items-center justify-between rounded-lg p-4">
      <View className="flex-row items-center">
        <View>
          <MintIcon size={40} mintInfo={mintInfo} />
        </View>
        <View>
          <Text heavy size={16}>
            {transaction?.transactionType === 'send'
              ? transaction?.paid
                ? 'Sent with'
                : 'Sending with'
              : transaction?.paid
                ? 'Received with'
                : 'Receiving with'}
          </Text>
          <Text regular size={16} color={greys(theme)[100]}>
            {mintInfo?.name}
          </Text>
        </View>
      </View>

      <View>
        {!transaction?.paid && handleCheckStatus && (
          <Button
            style={{
              padding: 0,
              width: 40,
              height: 40,
              margin: 0,
              marginBottom: 0,
              marginTop: 0,
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
    </View>
  );
}
