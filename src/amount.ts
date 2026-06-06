export type AmountLike =
  | number
  | bigint
  | string
  | {
      toNumber(): number;
    };

export type AmountValue = AmountLike | null | undefined;

export function amountToNumber(value: AmountValue): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  return value.toNumber();
}

export function toCashuAmount(value: AmountValue): number {
  return amountToNumber(value);
}

export function amountToNumberOrUndefined(value: AmountValue): number | undefined {
  return value == null ? undefined : amountToNumber(value);
}

export function sumAmountNumbers(values: Iterable<AmountLike>): number {
  let total = 0;
  for (const value of values) {
    total += amountToNumber(value);
  }
  return total;
}
