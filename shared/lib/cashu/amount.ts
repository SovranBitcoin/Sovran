import { Amount, type AmountLike } from '@cashu/coco-core';

export type AmountValue = AmountLike | null | undefined;

export function toCocoAmount(value: AmountValue): Amount {
  return value == null ? Amount.zero() : Amount.from(value);
}

export function amountToNumber(value: AmountValue): number {
  return toCocoAmount(value).toNumber();
}
