import React from 'react';
import { View } from 'components/ui/View';
import Icon from 'assets/icons';
import CachedImage from 'components/ui/Image';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { memoizedGetNostrProfile } from 'helper/redux/nostr';

export default function TransactionIcon({ transaction }: any): React.ReactNode {
  const theme = useSelector(memoizedGetTheme);
  const nostrData = useSelector(memoizedGetNostrProfile({ nostrPubkey: transaction.nostrPubkey }));

  const isSmall = nostrData?.profile?.picture;
  const iconSize = isSmall ? 10 : 28;
  return (
    <View className="relative h-7 w-7 bg-transparent">
      <View
        blur={Boolean(isSmall)}
        className={isSmall ? 'absolute -bottom-2 -right-2 z-10 rounded-full' : ''}
        style={
          isSmall
            ? {
                backgroundColor: greys(theme)[700],
                borderRadius: 100,
                height: iconSize + 6,
                width: iconSize + 6,
                padding: 3,
                borderColor: greys(theme)[600],
              }
            : {}
        }>
        <Icon
          name={
            transaction?.batchId || transaction?.isVirtual
              ? 'majesticons:percent'
              : transaction.isP2PK
                ? 'solar:key-bold'
                : transaction.fromNIP05
                  ? 'mdi:at'
                  : transaction.isCancel && transaction.isSend
                    ? 'mdi:cancel'
                    : transaction.isReceive
                      ? 'fluent:arrow-download-16-filled'
                      : 'fluent:arrow-upload-16-filled'
          }
          color={greys(theme)[50]}
          size={iconSize}
        />
      </View>
      {nostrData?.profile?.picture && (
        <CachedImage
          style={{
            width: 28,
            height: 28,
            borderRadius: 1000,
            borderColor: greys(theme)[700],
            borderWidth: 1,
          }}
          source={{ uri: nostrData?.profile?.picture }}
        />
      )}
    </View>
  );
}
