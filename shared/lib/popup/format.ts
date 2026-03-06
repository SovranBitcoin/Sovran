import { formatAmount } from '@/shared/lib/currency';

export type AmountSegment = { amount: number; unit: string };
export type PopupTextSegment = string | AmountSegment;

export function isAmountSegment(value: unknown): value is AmountSegment {
  return (
    typeof value === 'object' &&
    value !== null &&
    'amount' in value &&
    'unit' in value &&
    typeof (value as AmountSegment).amount === 'number' &&
    typeof (value as AmountSegment).unit === 'string'
  );
}

/**
 * Tagged template for popup text with inline amount formatting.
 *
 * Objects with `{ amount, unit }` are preserved as AmountSegments for
 * rich rendering via AmountFormatter. Everything else is stringified.
 *
 * @example
 * fmt`${{ amount: 500, unit: 'sat' }} sent`
 * // => [{ amount: 500, unit: 'sat' }, ' sent']
 *
 * fmt`Switched to ${modelName}`
 * // => ['Switched to gpt-4']
 */
export function fmt(strings: TemplateStringsArray, ...values: unknown[]): PopupTextSegment[] {
  const segments: PopupTextSegment[] = [];

  for (let i = 0; i < strings.length; i++) {
    if (strings[i]) {
      segments.push(strings[i]);
    }

    if (i < values.length) {
      const value = values[i];
      if (isAmountSegment(value)) {
        segments.push(value);
      } else {
        segments.push(String(value));
      }
    }
  }

  return mergeAdjacentStrings(segments);
}

function mergeAdjacentStrings(segments: PopupTextSegment[]): PopupTextSegment[] {
  const result: PopupTextSegment[] = [];

  for (const seg of segments) {
    if (typeof seg === 'string' && typeof result[result.length - 1] === 'string') {
      result[result.length - 1] = (result[result.length - 1] as string) + seg;
    } else {
      result.push(seg);
    }
  }

  return result;
}

/** Flattens segments to a plain string (for toasts that only accept strings). */
export function flattenSegments(segments: PopupTextSegment[]): string {
  return segments
    .map((seg) => {
      if (typeof seg === 'string') return seg;
      return formatAmount(seg, { useUserPreference: true });
    })
    .join('');
}
