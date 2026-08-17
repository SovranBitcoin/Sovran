import React from 'react';
import opacity from 'hex-color-opacity';
import Icon from 'assets/icons';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';
import { useColadaTransactionAnnotation } from 'wallet/react';

function isLightningKind(k: string) {
  return k === 'lightningInvoice' || k === 'lightningAddress' || k === 'lnurlp';
}

function isEcashKind(k: string) {
  return k === 'paymentRequest' || k === 'ecashToken';
}

function isOnchainKind(k: string) {
  return k === 'onchainAddress';
}

/**
 * Returns BIP321 metadata for a transaction's DetailsSection.
 */
export function useBip321Info(transactionId: string | undefined): {
  isBip321: boolean;
  optionKinds: string[] | null;
} {
  const annotation = useColadaTransactionAnnotation(transactionId ? { id: transactionId } : null);
  const scan = annotation.scan;
  const isBip321 = scan?.container === 'bip321';
  const optionKinds = isBip321 && scan?.optionKinds?.length ? scan.optionKinds : null;
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
  /** Which payment category was actually used. */
  usedKind?: 'lightning' | 'ecash' | 'onchain';
}) {
  const foreground = useThemeColor('foreground');
  const hasLightning = optionKinds.some(isLightningKind);
  const hasEcash = optionKinds.some(isEcashKind);
  const hasOnchain = optionKinds.some(isOnchainKind);

  // Sort: used method first
  const items = [
    hasLightning && { name: 'mdi:lightning-bolt', used: usedKind === 'lightning' },
    hasEcash && { name: 'majesticons:coins', used: usedKind === 'ecash' },
    hasOnchain && { name: 'hugeicons:blockchain-01', used: usedKind === 'onchain' },
  ].filter(Boolean) as { name: string; used: boolean }[];
  items.sort((a, b) => (a.used === b.used ? 0 : a.used ? -1 : 1));

  return (
    <Log name="Bip321MethodIcons">
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
    </Log>
  );
}
