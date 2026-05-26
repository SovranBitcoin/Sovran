import { Amount, type AmountLike } from '@cashu/cashu-ts';

export type AmountValue = AmountLike | null | undefined;

export function toCashuAmount(value: AmountValue): Amount {
  return value == null ? Amount.zero() : Amount.from(value);
}

export function amountToNumber(value: AmountValue): number {
  return toCashuAmount(value).toNumber();
}

export function amountToNumberOrUndefined(value: AmountValue): number | undefined {
  return value == null ? undefined : amountToNumber(value);
}

export function sumAmountNumbers(values: Iterable<AmountLike>): number {
  return Amount.sum(values).toNumber();
}
