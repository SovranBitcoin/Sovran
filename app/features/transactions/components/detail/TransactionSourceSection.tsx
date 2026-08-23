import { withAlpha } from '@/shared/lib/color';
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
function Bip321MethodIcons({
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
            color={withAlpha(foreground, item.used ? 0.8 : 0.4)}
          />
        ))}
      </HStack>
    </Log>
  );
}

/**
 * The leading rows every transaction-detail screen opens its `DetailsSection`
 * with, in the one order they all use: Source → Format → Payment Methods →
 * Date. Each screen was rebuilding this block by hand, so a new row (or a
 * reorder) had to be applied in seven places to stay consistent.
 *
 * Rows are returned including their falsy gaps — `DetailsSection` drops those —
 * so the block spreads straight into a screen's item list:
 * `...transactionLeadDetailItems({ source, bip321, usedKind: 'lightning', createdAt })`.
 */
export function transactionLeadDetailItems({
  source,
  bip321,
  usedKind,
  createdAt,
}: {
  source: string | null | undefined;
  bip321: { isBip321: boolean; optionKinds: string[] | null };
  /** Which payment category this screen actually used. */
  usedKind: 'lightning' | 'ecash' | 'onchain';
  /** Already-formatted datetime (`entry.createdAt.datetime`). */
  createdAt: string;
}) {
  return [
    source ? { title: 'Source', value: source } : null,
    bip321.isBip321 ? { title: 'Format', value: 'BIP 321' } : null,
    bip321.optionKinds
      ? {
          title: 'Payment Methods',
          value: <Bip321MethodIcons optionKinds={bip321.optionKinds} usedKind={usedKind} />,
        }
      : null,
    { title: 'Date', value: createdAt },
  ];
}
