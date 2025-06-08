import React, { useMemo } from 'react';
import { View } from 'components/common/Themed';
import Icon from 'assets/icons';
import CachedImage from 'components/common/Image';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { useNostr } from 'helper/redux/nostr';
import { useEsims } from 'helper/redux/esim';
import { find, get, some } from 'lodash';

export interface TransactionData {
  id?: string;
  txid?: string;
  request?: string;
  token?: string;
  unit: string;
  amount: number;
  date?: string;
  transactionType: 'send' | 'receive' | string;
  type?: string;
  isBuy?: string;
  isSell?: boolean;
  paid?: boolean;
  isCancel?: boolean;
  unifiedRequest?: string;
  paymentRequest?: string;
  from?: string;
  to?: string;
  fromNIP05?: string;
  status?: { block_time: number; [key: string]: any };
  nostr?: { pubkey: string; [key: string]: any };
}

interface TransactionIconProps {
  transaction: TransactionData;
}

export default function TransactionIcon({
  transaction,
}: TransactionIconProps): JSX.Element {
  const theme = useSelector(memoizedGetTheme);
  const { search, profiles } = useNostr();
  const { esims } = useEsims();

  const isSend = transaction.transactionType === 'send';
  const isReceive = transaction.transactionType === 'receive';

  const profilePicture = useMemo(() => {
    const getPicture = (arr?: any[]) => {
      const item = find(arr, {
        pubkey: transaction?.nostr?.pubkey || transaction?.fromNIP05?.split('@')[0],
      });
      return (
        get(item, 'profile.picture') ||
        get(item, 'picture') ||
        get(item, 'profile.image') ||
        get(item, 'image')
      );
    };

    return getPicture(search) || getPicture(profiles);
  }, [search, profiles, transaction?.nostr?.pubkey, transaction?.fromNIP05]);

  const isEsimRequest = useMemo(
    () => some(esims, (e) => e?.request && e.request === transaction.request),
    [esims, transaction.request]
  );

  const StatusIndicator = () => (
    <View
      className="absolute -bottom-2 -right-2 z-10 rounded-full"
      style={{
        backgroundColor: greys(theme)[1800],
        borderRadius: 100,
        height: 16,
        width: 16,
        padding: 3,
        borderColor: greys(theme)[1300],
        borderWidth: 0.2,
      }}>
      {transaction.isCancel ? (
        <Icon name="mdi:cancel" color={greys(theme)[100]} size={10} />
      ) : (
        <Icon
          name={isReceive ? 'fluent:arrow-download-16-filled' : 'fluent:arrow-upload-16-filled'}
          color={greys(theme)[100]}
          size={10}
        />
      )}
    </View>
  );

  if (profilePicture) {
    return (
      <View className="relative h-7 w-7 bg-transparent">
        <StatusIndicator />
        <CachedImage
          style={{
            width: 28,
            height: 28,
            borderRadius: 1000,
            borderColor: greys(theme)[1000],
            borderWidth: 0.5,
          }}
          source={{ uri: profilePicture }}
        />
      </View>
    );
  }

  if (isEsimRequest) {
    return (
      <View className="relative h-7 w-7 bg-transparent">
        <StatusIndicator />
        <Icon name="fluent:sim-24-filled" color={greys(theme)[100]} />
      </View>
    );
  }

  if (transaction.fromNIP05 && isReceive) {
    return (
      <View className="relative h-7 w-7 bg-transparent">
        <Icon name="mdi:at" color={greys(theme)[100]} />
      </View>
    );
  }

  if (isReceive) {
    return (
      <View className="relative h-7 w-7 bg-transparent">
        <Icon name="fluent:arrow-download-16-filled" color={greys(theme)[100]} />
      </View>
    );
  }

  if (transaction.isCancel) {
    return (
      <View className="relative h-7 w-7 bg-transparent">
        <Icon name="mdi:cancel" color={greys(theme)[100]} />
      </View>
    );
  }

  return (
    <View className="relative h-7 w-7 bg-transparent">
      <Icon name="fluent:arrow-upload-16-filled" color={greys(theme)[100]} />
    </View>
  );
}
