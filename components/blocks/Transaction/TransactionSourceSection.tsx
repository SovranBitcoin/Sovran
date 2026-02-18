import { useScanHistoryStore, ScanSource } from 'stores/scanHistoryStore';

const SOURCE_LABELS: Record<ScanSource, string> = {
  qr: 'QR Code',
  nfc: 'NFC',
  paste: 'Clipboard',
  deeplink: 'Deep Link',
};

/**
 * Returns the human-readable source label for a transaction, or null if none is linked.
 * Intended for use as a row in DetailsSection.
 */
export function useTransactionSource(transactionId: string | undefined): string | null {
  return useScanHistoryStore((state) => {
    if (!transactionId) return null;
    const entry = state.entries.find((e) => e.transactionId === transactionId);
    return entry?.source ? SOURCE_LABELS[entry.source] : null;
  });
}
