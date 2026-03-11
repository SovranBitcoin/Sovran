/**
 * BIP-321 bitcoin: URI parsing.
 *
 * @see https://bips.dev/321/
 */

export interface ParsedBip321 {
  creq: string | null;
  lightning: string | null;
  lno: string | null;
  address: string | null;
}

/**
 * Parse a BIP-321 bitcoin: URI into its payment components.
 * Returns null if the string is not a valid bitcoin: URI.
 */
export function parseBip321Uri(input: string): ParsedBip321 | null {
  const trimmed = input.trim();
  if (!trimmed.toLowerCase().startsWith('bitcoin:')) return null;

  try {
    const url = new URL(trimmed.replace(/^bitcoin:/i, 'bitcoin://x/'));
    const creq = url.searchParams.get('creq');
    const lightning = url.searchParams.get('lightning');
    const lno = url.searchParams.get('lno');
    const path = url.pathname.replace(/^\/+/, '');
    const address = path && path !== 'x' ? path : null;

    return { creq, lightning, lno, address };
  } catch {
    const creqMatch = trimmed.match(/[?&]creq=([^&]+)/i);
    const lightningMatch = trimmed.match(/[?&]lightning=([^&]+)/i);
    const lnoMatch = trimmed.match(/[?&]lno=([^&]+)/i);
    return {
      creq: creqMatch?.[1] ?? null,
      lightning: lightningMatch?.[1] ?? null,
      lno: lnoMatch?.[1] ?? null,
      address: null,
    };
  }
}

/** Check if a string looks like a BIP-321 URI */
export function isBip321Uri(input: string): boolean {
  return input.trim().toLowerCase().startsWith('bitcoin:');
}
