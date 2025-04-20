import { CurrencyIcon, FlagIcon } from 'assets/icons';
import { Text } from 'components/common/Themed';
import React from 'react';
import { View } from 'react-native';

interface CurrencyIconProps {
  currency: string;
  size?: number;
}

export const Currency: React.FC<CurrencyIconProps> = ({ currency, size = 32 }) => {
  return (
    <>
      {currency === 'usd' || currency === 'eur' || currency === 'gbp' ? (
        <FlagIcon
          country={currency === 'usd' ? 'US' : currency === 'eur' ? 'EU' : 'GB'}
          height={size}
          width={size}
        />
      ) : (
        <CurrencyIcon currency={currency.toLowerCase()} />
      )}
    </>
  );
};
