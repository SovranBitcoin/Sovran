import { logger } from "./logger";

export type AmountLike =
  | number
  | bigint
  | string
  | {
      toNumber(): number;
    };

export type AmountValue = AmountLike | null | undefined;

/** Undefined when the amount is missing or is not a finite number. */
function parseAmount(value: AmountValue): number | undefined {
  if (value == null) return undefined;
  let result: number;
  if (typeof value === "number") {
    result = value;
  } else if (typeof value === "bigint") {
    result = Number(value);
  } else if (typeof value === "string") {
    // `Number("")` is 0, which would turn a blank field into a real amount.
    result = value.trim() === "" ? NaN : Number(value);
  } else if (typeof value.toNumber === "function") {
    try {
      // cashu-ts throws for an amount too large to hold exactly.
      result = value.toNumber();
    } catch {
      result = NaN;
    }
  } else {
    result = NaN;
  }
  if (Number.isFinite(result)) return result;
  // Runs on every rendered amount, so only the anomaly is logged.
  logger.warn("amount.unreadable", { valueKind: typeof value });
  return undefined;
}

/**
 * An amount to show. A missing or unreadable amount shows as 0, so this is for display and
 * read models only: a price, a fee or an amount to pay or accept goes through `requireAmount`.
 */
export function amountToNumber(value: AmountValue): number {
  return parseAmount(value) ?? 0;
}

/** As `amountToNumber`, keeping "not known" apart from zero. */
export function amountToNumberOrUndefined(
  value: AmountValue,
): number | undefined {
  return parseAmount(value);
}

/**
 * An amount that decides what is paid or accepted. Throws instead of inventing a number when
 * the value is missing, unreadable, fractional, negative or too large to hold exactly.
 */
export function requireAmount(value: AmountValue): number {
  // Plain digits only: `Number` would also read "1e3", "0x10" and " 21 ".
  const amount =
    typeof value === "string" && !/^\d+$/.test(value)
      ? undefined
      : parseAmount(value);
  if (amount === undefined || !Number.isSafeInteger(amount) || amount < 0) {
    throw new TypeError("amount is not a whole, non-negative number");
  }
  return amount;
}
