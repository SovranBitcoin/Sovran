export function isMintQuotePaymentObserved(
  entry: { state?: unknown; remoteState?: unknown } | null | undefined
): boolean {
  const state = String(entry?.state ?? '');
  return (
    state === 'executing' ||
    state === 'finalized' ||
    state === 'ISSUED' ||
    entry?.remoteState === 'ISSUED' ||
    entry?.remoteState === 'PAID'
  );
}
