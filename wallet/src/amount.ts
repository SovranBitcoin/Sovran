import { logger } from "./logger";

export type AmountLike =
  | number
  | bigint
  | string
  | {
      toNumber(): number;
    };

export type AmountValue = AmountLike | null | undefined;

function amountValueKind(value: AmountValue): string {
  if (value == null) return "nullish";
  if (typeof value !== "object") return typeof value;
  return typeof value.toNumber === "function" ? "object.toNumber" : "object";
}

function logAmountConversion(
  event: string,
  value: AmountValue,
  result: number | undefined,
): void {
  const kind = amountValueKind(value);
  if (
    kind === "number" &&
    result != null &&
    Number.isFinite(result) &&
    Number.isSafeInteger(result)
  ) {
    return;
  }

  logger.debug(event, {
    valueKind: kind,
    resultKind: typeof result,
    isFinite: typeof result === "number" ? Number.isFinite(result) : false,
    isSafeInteger:
      typeof result === "number" ? Number.isSafeInteger(result) : false,
    isNullish: value == null,
  });
}

export function amountToNumber(value: AmountValue): number {
  let result: number;
  if (value == null) {
    result = 0;
  } else if (typeof value === "number") {
    result = value;
  } else if (typeof value === "bigint") {
    result = Number(value);
  } else if (typeof value === "string") {
    result = Number(value);
  } else {
    result = value.toNumber();
  }
  logAmountConversion("amount.toNumber.result", value, result);
  return result;
}

export function toCashuAmount(value: AmountValue): number {
  const result = amountToNumber(value);
  logAmountConversion("amount.toCashuAmount.result", value, result);
  return result;
}

export function amountToNumberOrUndefined(
  value: AmountValue,
): number | undefined {
  const result = value == null ? undefined : amountToNumber(value);
  logAmountConversion("amount.toNumberOrUndefined.result", value, result);
  return result;
}

export function sumAmountNumbers(values: Iterable<AmountLike>): number {
  let total = 0;
  let count = 0;
  for (const value of values) {
    total += amountToNumber(value);
    count += 1;
  }
  logger.debug("amount.sum.result", {
    count,
    isFinite: Number.isFinite(total),
    isSafeInteger: Number.isSafeInteger(total),
    total,
  });
  return total;
}
