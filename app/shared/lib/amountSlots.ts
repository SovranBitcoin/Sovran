/**
 * Splits a formatted amount (`₿ 1,250`, `1,250 sats`, `$12.34`,
 * `0.00012500 BTC`, `+ 42 sats`) into slots whose keys stay put while the
 * value changes, so a rolling display can animate only the digits that moved.
 *
 * Integer digits are keyed from the least significant one (`int-0` is the
 * ones digit, `int-1` the tens…), so `999 → 1,000` keeps `int-0..int-2` and
 * adds `int-3`, rather than shifting every key one place. Fraction digits are
 * keyed from the decimal point (`frac-0` is the first after it). Everything
 * else (sign, grouping separators, spaces, currency and unit glyphs) is a
 * static slot keyed by the nearest digit it sits beside, so it keeps its
 * identity too.
 *
 * Mirrored in Swift by `AmountSlots` in
 * `modules/liquid-glass-text/ios/LiquidGlassTextSwiftUI.swift`.
 */

export type AmountSlot =
  | { kind: 'digit'; key: string; char: string; digit: number }
  | { kind: 'static'; key: string; char: string };

interface AmountSlotOptions {
  /** The decimal separator the formatter emits. The app formats en-US. */
  decimalSeparator?: string;
}

const isDigit = (char: string) => char >= '0' && char <= '9';

const isJoiner = (cp: number) =>
  (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors (the ⚡︎ text form)
  (cp >= 0x0300 && cp <= 0x036f) || // combining marks
  cp === 0x200d; // zero-width joiner

/**
 * Splits into user-visible glyphs the way Swift's `Character` does for the
 * text an amount can hold: code points, with variation selectors, combining
 * marks and joined sequences kept on the glyph they modify. So `⚡︎` is one
 * slot here and in the native tokenizer.
 */
function glyphs(text: string): string[] {
  const out: string[] = [];
  let joinNext = false;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (out.length > 0 && (joinNext || isJoiner(cp))) {
      out[out.length - 1] += char;
    } else {
      out.push(char);
    }
    joinNext = cp === 0x200d;
  }
  return out;
}

export function tokenizeAmount(text: string, options: AmountSlotOptions = {}): AmountSlot[] {
  const decimalSeparator = options.decimalSeparator ?? '.';
  const chars = glyphs(text);

  const firstDigit = chars.findIndex(isDigit);
  if (firstDigit === -1) {
    return chars.map((char, i) => ({ kind: 'static', key: `pre-${chars.length - 1 - i}`, char }));
  }
  let lastDigit = chars.length - 1;
  while (!isDigit(chars[lastDigit])) lastDigit--;

  // The decimal point is the separator that sits inside the number span with
  // only digits (and grouping) after it up to the last digit.
  let point = -1;
  for (let i = lastDigit; i > firstDigit; i--) {
    if (chars[i] === decimalSeparator) {
      point = i;
      break;
    }
  }
  const integerEnd = point === -1 ? lastDigit : point - 1;

  const slots: AmountSlot[] = [];
  // Integer digits to the right of each index, counted once up front.
  let intDigitsRight = 0;
  const intIndexOf = new Map<number, number>();
  const intRightOf = new Map<number, number>();
  for (let i = integerEnd; i >= firstDigit; i--) {
    intRightOf.set(i, intDigitsRight);
    if (isDigit(chars[i])) {
      intIndexOf.set(i, intDigitsRight);
      intDigitsRight++;
    }
  }

  let fracDigitsLeft = 0;
  chars.forEach((char, i) => {
    if (i < firstDigit) {
      slots.push({ kind: 'static', key: `pre-${firstDigit - 1 - i}`, char });
    } else if (i > lastDigit) {
      slots.push({ kind: 'static', key: `suf-${i - lastDigit - 1}`, char });
    } else if (i <= integerEnd) {
      const index = intIndexOf.get(i);
      if (index !== undefined) {
        slots.push({ kind: 'digit', key: `int-${index}`, char, digit: Number(char) });
      } else {
        slots.push({ kind: 'static', key: `isep-${intRightOf.get(i)}`, char });
      }
    } else if (i === point) {
      slots.push({ kind: 'static', key: 'point', char });
    } else if (isDigit(char)) {
      slots.push({ kind: 'digit', key: `frac-${fracDigitsLeft}`, char, digit: Number(char) });
      fracDigitsLeft++;
    } else {
      slots.push({ kind: 'static', key: `fsep-${fracDigitsLeft}`, char });
    }
  });
  return slots;
}

/**
 * Which way a changed digit rolls: `1` up (the new digit enters from below),
 * `-1` down. The value's direction wins, so a carry (`…9 → …0` on an
 * increase) still rolls up; with no comparable value, the digits decide.
 */
export function rollDirection(
  previous: { digit: number; value?: number },
  next: { digit: number; value?: number }
): 1 | -1 {
  if (
    previous.value !== undefined &&
    next.value !== undefined &&
    Number.isFinite(previous.value) &&
    Number.isFinite(next.value) &&
    previous.value !== next.value
  ) {
    return next.value > previous.value ? 1 : -1;
  }
  return next.digit >= previous.digit ? 1 : -1;
}
