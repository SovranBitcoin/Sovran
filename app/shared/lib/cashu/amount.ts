import { cashuLog } from '@/shared/lib/logger';

export type AmountLike = number | bigint | string | { toNumber(): number };

export type AmountValue = AmountLike | null | undefined;

// These converters sit on render-hot paths (every amount display formats
// through them — thousands of calls per session), so they only log anomalies,
// never successful conversions.

export function toCocoAmount(value: AmountValue): number {
  return amountToNumber(value);
}

export function amountToNumber(value: AmountValue): number {
  if (value == null) return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      cashuLog.warn('cashu.amount.to_number.non_finite', { inputType: 'number' });
    }
    return value;
  }
  if (typeof value === 'bigint') {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount)) {
      cashuLog.warn('cashu.amount.to_number.unsafe_bigint', { amount });
    }
    return amount;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      cashuLog.warn('cashu.amount.to_number.unparseable_string', { inputLength: value.length });
      return 0;
    }
    return parsed;
  }
  const amount = value.toNumber();
  if (!Number.isFinite(amount)) {
    cashuLog.warn('cashu.amount.to_number.non_finite', { inputType: 'object' });
  }
  return amount;
}

export function toSafeSatAmount(value: AmountValue): number | null {
  const amount = amountToNumber(value);
  if (!Number.isFinite(amount) || amount < 0) {
    cashuLog.warn('cashu.amount.safe_sat.rejected', {
      amount,
      finite: Number.isFinite(amount),
      negative: amount < 0,
    });
    return null;
  }
  return Math.trunc(amount);
}
