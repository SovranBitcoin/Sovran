/** Number-formatting utilities. */

/** Short-form abbreviation: `"23"` / `"1.2k"` / `"12k"` / `"1.2m"`.
 *  Tens-cutoff rounds to whole units (`12k`, not `12.0k`). Used for compact
 *  stat pills where a long `toLocaleString()` ("1,234,567") would overflow. */
export function formatCompact(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1_000;
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  const m = n / 1_000_000;
  return m >= 10 ? `${Math.round(m)}m` : `${m.toFixed(1).replace(/\.0$/, '')}m`;
}

/**
 * A share between 0 and 1 as a percentage, to one decimal place and without a
 * trailing `.0`: `1` is `100%`, `0.995` is `99.5%`. One rule for every surface,
 * so a list never reads `100%` beside a detail page that reads `99.5%`.
 */
export function formatRate(rate: number): string {
  return `${Number((rate * 100).toFixed(1))}%`;
}
