export function truncateMiddle(str: string, n: number) {
  if (n * 2 >= str.length) return str;
  return str.substring(0, n) + '...' + str.substring(str.length - n);
}
