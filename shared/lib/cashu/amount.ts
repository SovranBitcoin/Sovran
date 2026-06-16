import { cashuLog } from '@/shared/lib/logger';

export type AmountLike = number | bigint | string | { toNumber(): number };

export type AmountValue = AmountLike | null | undefined;

export function toCocoAmount(value: AmountValue): number {
  const amount = amountToNumber(value);
  cashuLog.debug('cashu.amount.to_coco', {
    inputType: value == null ? 'nullish' : typeof value,
    amount,
  });
  return amount;
}

export function amountToNumber(value: AmountValue): number {
  if (value == null) {
    cashuLog.debug('cashu.amount.to_number.nullish');
    return 0;
  }
  if (typeof value === 'number') {
    cashuLog.debug('cashu.amount.to_number.number', {
      amount: value,
      finite: Number.isFinite(value),
    });
    return value;
  }
  if (typeof value === 'bigint') {
    const amount = Number(value);
    cashuLog.debug('cashu.amount.to_number.bigint', {
      amount,
      safeInteger: Number.isSafeInteger(amount),
    });
    return amount;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    const finite = Number.isFinite(parsed);
    cashuLog.debug('cashu.amount.to_number.string', {
      inputLength: value.length,
      finite,
      amount: finite ? parsed : 0,
    });
    return finite ? parsed : 0;
  }
  const amount = value.toNumber();
  cashuLog.debug('cashu.amount.to_number.object', {
    amount,
    finite: Number.isFinite(amount),
  });
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
  const result = Math.trunc(amount);
  cashuLog.debug('cashu.amount.safe_sat.result', {
    amount,
    result,
    truncated: result !== amount,
  });
  return result;
}
