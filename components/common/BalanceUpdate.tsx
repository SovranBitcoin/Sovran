import React, { useMemo } from 'react';
import { Text, View } from 'components/common/Themed';
import Icon from 'assets/icons';
import { useSelector } from 'react-redux';
import { useNostr } from 'helper/redux/nostr';
import { greens, greys, shades } from 'helper/colors';
import opacity from 'hex-color-opacity';
import { useEsims } from 'helper/redux/esim';

import CachedImage from 'components/common/Image';
import { memoizedGetTheme } from 'helper/redux/settings';
import { AmountFormatter } from 'components/common/AmountFormatter';
import { find, get, some } from 'lodash';
import { formatCurrency } from 'helper/currency';

interface BalanceUpdateProps {
  transactionType: 'send' | 'receive' | string;
  amount: number;
  unit: string;
  pubkey?: string;
  request?: string;
  transaction?: { isCancel?: boolean };
  bottomAmount?: string;
}

export function BalanceUpdate({
  transactionType,
  amount,
  unit,
  pubkey,
  request,
  transaction,
  bottomAmount,
}: BalanceUpdateProps): JSX.Element {
  const theme = useSelector(memoizedGetTheme);
  const { search, profiles } = useNostr();
  const { esims } = useEsims();

  const profilePicture = useMemo(() => {
    const getPicture = (arr?: any[]) => {
      const item = find(arr, { pubkey });
      return (
        get(item, 'profile.picture') ||
        get(item, 'picture') ||
        get(item, 'profile.image') ||
        get(item, 'image')
      );
    };

    return getPicture(search) || getPicture(profiles);
  }, [search, profiles, pubkey]);

  const isEsimRequest = useMemo(
    () => some(esims, (e) => e?.request && e.request === request),
    [esims, request]
  );

  const isSend = transactionType === 'send';
  const isReceive = transactionType === 'receive';

  const Sign = () => {
    if (isSend)
      return (
        <Text
          size={32}
          weight="bold"
          className="ml-2"
          style={{ color: shades[300], marginRight: 8 }}>
          -
        </Text>
      );
    if (isReceive)
      return (
        <Text
          weight="bold"
          size={24}
          className="ml-2"
          style={{
            color: greens[300],
            textShadowColor: opacity(greys(theme)[0], 0.5),
            textShadowOffset: { width: 0, height: 0 },
            textShadowRadius: 1,
            marginRight: 8,
          }}>
          +
        </Text>
      );
    return null;
  };

  const ArrowIcon = () => (
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
      {isReceive ? (
        <Icon name="fluent:arrow-download-16-filled" color={greys(theme)[100]} size={10} />
      ) : transaction?.isCancel ? (
        <Icon name="mdi:cancel" color={greys(theme)[100]} size={10} />
      ) : (
        <Icon name="fluent:arrow-upload-16-filled" color={greys(theme)[100]} size={10} />
      )}
    </View>
  );

  const renderRightIcon = () => {
    if (profilePicture) {
      return (
        <View className="relative h-7 w-7 bg-transparent">
          <ArrowIcon />
          <CachedImage
            style={{
              width: 28,
              height: 28,
              borderRadius: 1000,
              borderColor: greys(theme)[1300],
              borderWidth: 0.2,
            }}
            source={{ uri: profilePicture }}
          />
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

    if (isEsimRequest) {
      return (
        <View className="relative h-7 w-7 bg-transparent">
          <ArrowIcon />
          <Icon name="fluent:sim-24-filled" color={greys(theme)[100]} />
        </View>
      );
    }

    return (
      <View className="relative h-7 w-7 bg-transparent">
        {transaction?.isCancel ? (
          <Icon name="mdi:cancel" color={greys(theme)[100]} />
        ) : (
          <Icon name="fluent:arrow-upload-16-filled" color={greys(theme)[100]} />
        )}
      </View>
    );
  };

  return (
    <View className="flex-row items-center justify-between bg-transparent py-4 pl-2 pr-4">
      <View className="bg-transparent">
        <View className="flex-row items-center bg-transparent">
          <Sign />
          <AmountFormatter
            amount={amount}
            unit={unit}
            size={28}
            weight="heavy"
            color={isReceive ? greens[300] : shades[300]}
          />
        </View>
        <Text
          size={18}
          style={{
            color: greys(theme)[100],
            marginLeft: 30,
            fontFamily: 'OverpassBold',
            backgroundColor: 'transparent',
          }}>
          {amount < 0 ? '-' : ''}
          <Text
            size={20}
            style={{
              color: greys(theme)[100],
              fontFamily: 'OverpassBold',
              marginLeft: 18,
              backgroundColor: 'transparent',
            }}>
            {amount < 0 ? '-' : ''}
            {bottomAmount
              ? bottomAmount
              : formatCurrency(
                  {
                    currency: unit === 'sat' ? 'BTC' : unit?.toUpperCase(),
                    value: Math.abs(amount),
                    denomination: unit === 'sat' ? 'sats' : unit,
                  },
                  {
                    locale: 'en-US',
                    precision: 2,
                    currencyDisplay: unit === 'usd' ? 'name' : 'symbol',
                    denomination: unit === 'usd' ? 'sats' : 'usd',
                  }
                )}
          </Text>
        </Text>
      </View>
      <View className="bg-transparent p-4" style={{ transform: [{ scale: 1.25 }] }}>
        {renderRightIcon()}
      </View>
    </View>
  );
}
