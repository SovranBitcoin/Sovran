/**
 * Formats a number with appropriate suffixes (k, m, b) for large numbers
 * @param num - The number to format
 * @returns Formatted string with appropriate suffix
 *
 * @example
 * formatNumber(1500) // "1.5k"
 * formatNumber(1000000) // "1m"
 * formatNumber(1500000000) // "1.5b"
 */
export function formatNumber(num: number): string {
  if (num >= 1000000000) {
    return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + 'b';
  } else if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  } else {
    return num.toString();
  }
}
