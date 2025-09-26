import React from 'react';
import { AmountFormatter } from './AmountFormatter';

type TransactionType = 'send' | 'receive';
type CurrencyUnit = 'sat' | 'usd' | 'eur' | 'gbp' | string;

interface NumberInputProps {
  type?: TransactionType;
  unit?: CurrencyUnit;
  value: number | string;
  size?: number;
}

export function NumberInput({
  type = 'send',
  unit = 'sat',
  value,
  size = 48,
}: NumberInputProps): React.ReactNode {
  const numericValue = typeof value === 'string' ? parseFloat(value) || 0 : value;

  return (
    <AmountFormatter
      amount={numericValue}
      unit={unit}
      size={size}
      weight="heavy"
      animated
      useTypeColors
      transactionType={type}
      centered
    />
  );
}
