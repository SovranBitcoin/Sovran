const KEEP = { compact: 8, detail: 12 } as const;

/**
 * Shorten a long identifier (an npub, an address, an event id) for display by
 * keeping its start and end around one "…": 8 characters each side for
 * `compact`, 12 for `detail`. A value that would not get shorter is returned
 * as it is. For display only: copy and sign the original.
 */
export function truncateMiddle(value: string, profile: keyof typeof KEEP = 'compact'): string {
  const keep = KEEP[profile];
  if (typeof value !== 'string' || value.length <= keep * 2 + 1) return value;
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}
