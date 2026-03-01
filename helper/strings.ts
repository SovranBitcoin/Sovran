/** Keeps `n` chars from start and end, joins with "…". Returns original if already short enough. */
export const truncateMiddle = (str: string, n: number): string => {
  if (!str || typeof str !== 'string' || n < 0) return str;
  if (n * 2 >= str.length) return str;
  return `${str.substring(0, n)}...${str.substring(str.length - n)}`;
};
