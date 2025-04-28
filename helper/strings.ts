/**
 * Truncates a string in the middle, preserving characters at the beginning and end.
 */
export const truncateMiddle = (str: string, n: number): string => {
  // Check for invalid inputs
  if (!str || typeof str !== 'string' || n < 0) {
    return str;
  }

  // If total preserved characters would exceed string length, return original
  if (n * 2 >= str.length) {
    return str;
  }

  const ellipsis = '...';
  const startChunk = str.substring(0, n);
  const endChunk = str.substring(str.length - n);

  return `${startChunk}${ellipsis}${endChunk}`;
};
