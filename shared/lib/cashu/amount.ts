export type AmountLike = number | bigint | string | { toNumber(): number };

export type AmountValue = AmountLike | null | undefined;

export function toCocoAmount(value: AmountValue): number {
  return amountToNumber(value);
}

export function amountToNumber(value: AmountValue): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return value.toNumber();
}
