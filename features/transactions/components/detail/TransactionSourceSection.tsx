import React from 'react';
import opacity from 'hex-color-opacity';
import Icon from 'assets/icons';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useScanHistoryStore, ScanSource } from '@/shared/stores/profile/scanHistoryStore';

const SOURCE_LABELS: Record<ScanSource, string> = {
  qr: 'QR Code',
  nfc: 'NFC',
  paste: 'Clipboard',
  deeplink: 'Deep Link',
};

const OPTION_KIND_LABELS: Record<string, string> = {
  lightningInvoice: 'Lightning',
  lightningAddress: 'Lightning Address',
  lnurlp: 'LNURL-pay',
  paymentRequest: 'Cashu Payment Request',
  ecashToken: 'Cashu Token',
};

function isLightningKind(k: string) {
  return k === 'lightningInvoice' || k === 'lightningAddress' || k === 'lnurlp';
}

function isEcashKind(k: string) {
  return k === 'paymentRequest' || k === 'ecashToken';
}

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

/**
 * Returns BIP321 metadata for a transaction's DetailsSection.
 * Uses primitive selectors to avoid infinite re-render loops.
 */
export function useBip321Info(transactionId: string | undefined): {
  isBip321: boolean;
  optionKinds: string[] | null;
} {
  const isBip321 = useScanHistoryStore((state) => {
    if (!transactionId) return false;
    const entry = state.entries.find((e) => e.transactionId === transactionId);
    return entry?.container === 'bip321';
  });
  const optionKinds = useScanHistoryStore((state) => {
    if (!transactionId) return null;
    const entry = state.entries.find((e) => e.transactionId === transactionId);
    if (entry?.container !== 'bip321' || !entry.optionKinds?.length) return null;
    return entry.optionKinds;
  });
  return { isBip321, optionKinds };
}

/**
 * Renders BIP321 payment method icons with labels for use in DetailsSection.
 * The method matching `usedKind` renders at full opacity; others at 0.5.
 */
export function Bip321MethodIcons({
  optionKinds,
  usedKind,
}: {
  optionKinds: string[];
  /** 'lightning' | 'ecash' — which category was actually used */
  usedKind?: 'lightning' | 'ecash';
}) {
  const foreground = useThemeColor('foreground');
  const hasLightning = optionKinds.some(isLightningKind);
  const hasEcash = optionKinds.some(isEcashKind);

  // Sort: used method first
  const items = [
    hasLightning && { name: 'mdi:lightning-bolt', used: usedKind === 'lightning' },
    hasEcash && { name: 'majesticons:coins', used: usedKind === 'ecash' },
  ].filter(Boolean) as { name: string; used: boolean }[];
  items.sort((a, b) => (a.used === b.used ? 0 : a.used ? -1 : 1));

  return (
    <HStack align="center" gap={6}>
      {items.map((item) => (
        <Icon
          key={item.name}
          name={item.name}
          size={16}
          color={opacity(foreground, item.used ? 0.8 : 0.4)}
        />
      ))}
    </HStack>
  );
}
