import React, { useCallback } from 'react';
import Animated, { Easing, LinearTransition } from 'react-native-reanimated';

import { HistoryEntry, SendHistoryEntry } from '@cashu/coco-core';
import { withAlpha } from '@/shared/lib/color';

import Icon from 'assets/icons';
import { SwipeableRow } from '@/features/transactions/components/SwipeableRow';
import TransactionIcon from '@/features/transactions/components/TransactionIcon';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { isCancellablePendingEcash, isSendTokenCancelled } from 'wallet';
import {
  COLLAPSE_DURATION_MS,
  useIsCollapsing,
  useIsReclaiming,
} from '@/shared/stores/runtime/rollbackStore';
import { UntranslatedText } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { formatAmount } from '@/shared/lib/currency';
import { formatDate } from '@/shared/lib/date';
import { isOutgoingTransaction } from '@/shared/lib/utils';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';
import { navigateToTransactionDetail } from '@/shared/lib/nav/transactionDetailRoutes';
import { log, Log } from '@/shared/lib/logger';
import { useColadaTransactionAnnotation } from 'wallet/react';
import type { DistributionSource, ScanMethod } from 'wallet';
import { getTransactionRowLabel } from '../lib/transactionPresentation';

/**
 * Unified source for the row badge. Combines inbound (scan source) and
 * outbound (distribution) sources into one type so the icon switch and label
 * maps cover every value in one place.
 */
type TransactionSource = ScanMethod | DistributionSource;

/**
 * Icon name for each source value. Every value here MUST be present in the
 * registry at `assets/icons/index.tsx` — adding a brand-new icon also
 * requires running `node scripts/regenerate-icons.js` to refresh
 * `.monicon/icons.js`. The values below are all icons that were already in
 * the registry, so no regeneration is needed.
 *
 * Adding a new source means: extend the union types in `scanHistoryStore.ts`
 * / `transactionDistributionStore.ts`, add an entry here, and add a label in
 * `getSourceLabel` in `Colada.tsx` — three touchpoints, all close
 * together.
 */
const SOURCE_ICONS: Record<TransactionSource, string> = {
  // Inbound (scan history)
  qr: 'stash:qr-code',
  nfc: 'lucide:nfc',
  paste: 'lucide:clipboard-paste',
  deeplink: 'lucide:link',
  ble: 'mdi:bluetooth',
  // Outbound (transaction distribution)
  copy: 'lets-icons:copy',
  share: 'ri:share-fill',
  airdrop: 'feather:wifi',
  displayed: 'stash:qr-code',
};

/**
 * Hook to get the source badge value for a transaction. Chains the scan
 * history store (inbound: qr/nfc/paste/deeplink) and the transaction
 * distribution store (outbound: copy/share/airdrop/displayed). Subscribes
 * to both so the row re-renders when either is linked or updated.
 *
 * The distribution store uses different keys per entry type:
 *  - mint entries: keyed by `quoteId` (deterministic, comes from the
 *    lightning quote, identical no matter which code path resolved it).
 *  - other types: keyed by historyEntry.id (no current writers, but
 *    available if outbound distribution is added for other flows later).
 *
 * Inbound takes precedence — if a transaction has both an inbound scan
 * and an outbound distribution (shouldn't happen in practice), the scan
 * is the more specific signal.
 */
const useTransactionSource = (historyEntry: HistoryEntry): TransactionSource | null => {
  // Pass the full entry so colada resolves the scan (id:) and distribution
  // (quote:) annotations across the entry's candidate keys.
  const annotation = useColadaTransactionAnnotation(historyEntry);
  return annotation.scan?.method ?? annotation.distribution?.source ?? null;
};

/** Returns BIP321 option kinds for a transaction, or null if not BIP321. */
const useBip321Options = (transactionId: string): string[] | null => {
  const annotation = useColadaTransactionAnnotation({ id: transactionId });
  const scan = annotation.scan;
  if (scan?.container !== 'bip321' || !scan.optionKinds?.length) return null;
  return scan.optionKinds;
};

/**
 * Row-UI state for the Transaction component. Renamed from `useHistoryEntry`
 * to avoid colliding with the canonical `useHistoryEntry` exported from
 * `features/transactions/hooks/useHistoryEntry.ts` (different semantics:
 * that one parses route params and subscribes to Colada's bus; this
 * one bundles row-display state + the navigate handler).
 */
const useTransactionRow = (historyEntry: HistoryEntry) => {
  const isSend = isOutgoingTransaction(historyEntry);
  const isReceive = !isSend;

  const isRolledBack = historyEntry.type === 'send' && isSendTokenCancelled(historyEntry);

  const fiatAmount = formatAmount(
    { amount: Math.abs(amountToNumber(historyEntry.amount)), unit: historyEntry.unit },
    { displayAs: 'usd' }
  );

  const handlePress = useCallback((): void => {
    log.debug('transaction.press', { type: historyEntry.type, id: historyEntry.id });
    navigateToTransactionDetail(historyEntry, 'transaction.row');
  }, [historyEntry]);

  return {
    isSend,
    isReceive,
    isRolledBack,
    fiatAmount,
    handlePress,
    displayLabel: getTransactionRowLabel(historyEntry),
  };
};

interface TransactionProps {
  historyEntry: HistoryEntry;
  /** Optional custom press handler - if provided, overrides default navigation */
  onPress?: (historyEntry: HistoryEntry) => void;
  /**
   * Optional swipe-to-cancel handler. When provided AND the entry is a
   * cancellable pending ecash send, the row reveals a red Cancel track on
   * left-swipe and calls this on commit. Otherwise the row is a plain tap
   * target.
   */
  onCancel?: (historyEntry: SendHistoryEntry) => void;
}

export const Transaction = React.memo(({ historyEntry, onPress, onCancel }: TransactionProps) => {
  const [foreground, danger, success] = useThemeColor(['foreground', 'danger', 'success'] as const);

  const {
    isSend,
    isReceive,
    isRolledBack,
    fiatAmount,
    handlePress: defaultHandlePress,
    displayLabel,
  } = useTransactionRow(historyEntry);

  const handlePress = onPress ? () => onPress(historyEntry) : defaultHandlePress;

  // Get the source badge (inbound scan or outbound distribution) and BIP321
  // options — subscribes to both stores for reactivity.
  const transactionSource = useTransactionSource(historyEntry);
  const bip321Options = useBip321Options(historyEntry.id);
  const onchainAddress = getOnchainMintAddress(historyEntry);

  // testID encodes both type and unique id so log-doctor `phone test`
  // can target a row by prefix (`transaction-mint-`, `transaction-send-`,
  // …) without hardcoding session-variable data, AND lets you reference
  // a specific quote/transaction by full id when needed.
  const testID = `transaction-${historyEntry.type}-${historyEntry.id}`;

  // operationId only exists on SendHistoryEntry; empty string is a safe
  // fallback for the rollback-store hooks (`Set.has('')` returns false).
  const sendOperationId =
    historyEntry.type === 'send' ? (historyEntry as SendHistoryEntry).operationId : '';
  const cancellable = isCancellablePendingEcash(historyEntry);
  const isReclaiming = useIsReclaiming(sendOperationId);
  const isCollapsing = useIsCollapsing(sendOperationId);
  const swipeable = !!onCancel && cancellable;

  // Post-success collapse: declarative target style + Reanimated's
  // `layout` transition. When `isCollapsing` flips, React renders the
  // wrapper with `height: 0, opacity: 0`; Reanimated's LinearTransition
  // captures the pre/post layouts and interpolates between them on the
  // UI thread (no per-frame JS re-renders). Yoga commits the new size
  // each frame on the native side, so this row shrinks in real time and
  // the FlashList sections below reflow as the list re-measures.
  const collapsedStyle = isCollapsing ? { height: 0, opacity: 0 } : null;

  const row = (
    <Pressable
      key={historyEntry?.id}
      testID={testID}
      className="flex-row items-center justify-between px-4 py-5"
      style={isRolledBack ? { opacity: 0.33 } : undefined}
      onPress={handlePress}>
      <HStack gap={12} flex={1}>
        <TransactionIcon historyEntry={historyEntry} isLoading={isReclaiming} />

        <VStack gap={0} flex={1}>
          <HStack justify="space-between" align="flex-end">
            <UntranslatedText color={foreground} bold size={14}>
              {displayLabel}
            </UntranslatedText>
            <AmountFormatter
              amount={historyEntry.amount}
              unit={historyEntry.unit}
              size={16}
              weight="heavy"
              color={isSend ? danger : success}
              sign={isSend ? '-' : isReceive ? '+' : null}
            />
          </HStack>

          <HStack justify="space-between" align="center">
            <HStack align="center" gap={4}>
              <UntranslatedText size={10} color={withAlpha(foreground, 0.8)}>
                {historyEntry?.createdAt
                  ? formatDate(historyEntry.createdAt, 'short-date-time')
                  : 'Unconfirmed'}
              </UntranslatedText>
              {transactionSource && (
                <Icon
                  name={SOURCE_ICONS[transactionSource]}
                  size={10}
                  color={withAlpha(foreground, 0.8)}
                />
              )}
              {bip321Options &&
                (() => {
                  const hasLightning = bip321Options.some(
                    (k) => k === 'lightningInvoice' || k === 'lightningAddress' || k === 'lnurlp'
                  );
                  const hasEcash = bip321Options.some(
                    (k) => k === 'paymentRequest' || k === 'ecashToken'
                  );
                  const hasOnchain = bip321Options.some((k) => k === 'onchainAddress');
                  const usedOnchain = !!onchainAddress;
                  const usedLightning = historyEntry.type === 'melt';
                  const usedEcash = !usedLightning && !usedOnchain;
                  // Sort: used method first
                  const items = [
                    hasLightning && { name: 'mdi:lightning-bolt', used: usedLightning },
                    hasEcash && { name: 'majesticons:coins', used: usedEcash },
                    hasOnchain && { name: 'hugeicons:blockchain-01', used: usedOnchain },
                  ].filter(Boolean) as { name: string; used: boolean }[];
                  items.sort((a, b) => (a.used === b.used ? 0 : a.used ? -1 : 1));
                  return items.map((item) => (
                    <Icon
                      key={item.name}
                      name={item.name}
                      size={10}
                      color={withAlpha(foreground, item.used ? 0.8 : 0.4)}
                    />
                  ));
                })()}
            </HStack>
            <UntranslatedText
              overpass
              bold
              size={10}
              color={withAlpha(foreground, 0.8)}
              className="self-end text-right">
              {fiatAmount}
            </UntranslatedText>
          </HStack>
        </VStack>
      </HStack>
    </Pressable>
  );

  return (
    <Animated.View
      style={[{ overflow: 'hidden' }, collapsedStyle]}
      layout={LinearTransition.duration(COLLAPSE_DURATION_MS).easing(Easing.linear)}>
      <Log name="Transaction">
        {swipeable && cancellable && onCancel ? (
          <SwipeableRow
            testID={`${testID}-swipeable`}
            enabled={!isReclaiming && !isCollapsing}
            onCommit={() => onCancel(historyEntry)}>
            {row}
          </SwipeableRow>
        ) : (
          row
        )}
      </Log>
    </Animated.View>
  );
});

Transaction.displayName = 'Transaction';
