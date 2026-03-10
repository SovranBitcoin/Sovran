export function parseFiatInputToMinorUnit(rawInput: string, fallbackAmount: number): number | null {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return Number.isFinite(fallbackAmount) ? Math.round(fallbackAmount * 100) : null;
  }

  const [wholeRaw = '0', decimalRaw = ''] = trimmed.split('.');
  if (!/^\d*$/.test(wholeRaw) || !/^\d*$/.test(decimalRaw)) return null;

  const whole = wholeRaw === '' ? 0 : Number.parseInt(wholeRaw, 10);
  const decimal = Number.parseInt(`${decimalRaw}00`.slice(0, 2), 10);

  if (!Number.isFinite(whole) || !Number.isFinite(decimal)) return null;

  return whole * 100 + decimal;
}

export function formatFiatMinorUnit(minorUnit: number, symbol: string): string {
  return `${symbol}${(minorUnit / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatSatsAmount(amount: number): string {
  return `${amount.toLocaleString('en-US')} sats`;
}

export function formatAmountList(
  amounts: number[],
  formatter: (amount: number) => string,
  limit = 8
): string {
  if (amounts.length === 0) return 'none';

  const visible = amounts.slice(0, limit).map(formatter);
  if (amounts.length <= limit) return visible.join(', ');

  return `${visible.join(', ')}, ...`;
}

export function orderCandidatesByCloseness(candidates: number[], target: number): number[] {
  return [...candidates].sort((a, b) => {
    const diff = Math.abs(a - target) - Math.abs(b - target);
    return diff !== 0 ? diff : a - b;
  });
}
