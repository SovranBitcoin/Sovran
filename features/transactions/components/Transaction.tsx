import React, { useCallback } from 'react';
import Animated, { Easing, LinearTransition } from 'react-native-reanimated';

import {
  HistoryEntry,
  MintHistoryEntry,
  ReceiveHistoryEntry,
  SendHistoryEntry,
} from '@cashu/coco-core';
import opacity from 'hex-color-opacity';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

import Icon from 'assets/icons';
import { SwipeableRow } from '@/features/transactions/components/SwipeableRow';
import TransactionIcon from '@/features/transactions/components/TransactionIcon';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { isCancellablePendingEcash } from '@/shared/lib/cashu/utils';
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
import { log, Log } from '@/shared/lib/logger';
import { useScanEntryForTransactionId, ScanSource } from '@/shared/stores/profile/scanHistoryStore';
import {
  useTransactionDistributionStore,
  DistributionSource,
} from '@/shared/stores/profile/transactionDistributionStore';

/**
 * Unified source for the row badge. Combines inbound (scan history) and
 * outbound (transaction distribution) sources into one type so the icon
 * switch and label maps cover every value in one place.
 */
type TransactionSource = ScanSource | DistributionSource;

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
  const scanEntry = useScanEntryForTransactionId(historyEntry.id);
  const distKey =
    historyEntry.type === 'mint' ? (historyEntry as MintHistoryEntry).quoteId : historyEntry.id;
  const fromDistribution = useTransactionDistributionStore(
    (state) => state.distributions[distKey]?.source ?? null
  );
  return scanEntry?.source ?? fromDistribution;
};

/** Returns BIP321 option kinds for a transaction, or null if not BIP321. */
const useBip321Options = (transactionId: string): string[] | null => {
  const scanEntry = useScanEntryForTransactionId(transactionId);
  if (scanEntry?.container !== 'bip321' || !scanEntry.optionKinds?.length) return null;
  return scanEntry.optionKinds;
};

/**
 * Row-UI state for the Transaction component. Renamed from `useHistoryEntry`
 * to avoid colliding with the canonical `useHistoryEntry` exported from
 * `features/transactions/hooks/useHistoryEntry.ts` (different semantics:
 * that one parses route params and subscribes to `history:updated`; this
 * one bundles row-display state + the navigate handler).
 */
const useTransactionRow = (historyEntry: HistoryEntry) => {
  const isSend = isOutgoingTransaction(historyEntry);
  const isReceive = !isSend;

  // Check if this is a rolled back send transaction
  const isRolledBack =
    historyEntry.type === 'send' && (historyEntry as SendHistoryEntry).state === 'rolledBack';

  const fiatAmount = formatAmount(
    { amount: Math.abs(historyEntry.amount), unit: historyEntry.unit },
    { displayAs: 'usd' }
  );

  const handlePress = useCallback((): void => {
    log.debug('transaction.press', { type: historyEntry.type, id: historyEntry.id });

    switch (historyEntry.type) {
      case 'mint': {
        // Coco uses 'mint' for Lightning-to-ecash (Lightning receive)
        router.navigate({
          pathname: '/mintQuote',
          params: {
            mintHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'melt': {
        // Coco uses 'melt' for ecash-to-Lightning (Lightning send)
        router.navigate({
          pathname: '/meltQuote',
          params: {
            meltHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'send': {
        // Coco uses 'send' for ecash sends
        router.navigate({
          pathname: '/sendToken',
          params: {
            sendHistoryEntry: JSON.stringify(historyEntry),
          },
        });
        return;
      }
      case 'receive': {
        // Coco uses 'receive' for ecash receives
        router.navigate({
          pathname: '/receiveToken',
          params: {
            receiveHistoryEntry: JSON.stringify(historyEntry as ReceiveHistoryEntry),
          },
        });
        return;
      }
    }
  }, [historyEntry]);

  return {
    isSend,
    isReceive,
    isRolledBack,
    fiatAmount,
    handlePress,
    displayLabel: historyEntry.type[0].toUpperCase() + historyEntry.type.slice(1),
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
  // each frame on the native side, so the section's measured height
  // shrinks in real time and AnimatedLegendList's `itemLayoutAnimation`
  // animates sibling sections in lock-step on the same UI-thread pass.
  const collapsedStyle = isCollapsing ? { height: 0, opacity: 0 } : null;

  const row = (
    <Pressable
      key={historyEntry?.id}
      testID={testID}
      className="flex-row items-center justify-between bg-transparent px-4 py-5"
      style={isRolledBack ? { opacity: 0.33 } : undefined}
      onPress={handlePress}>
      <HStack spacing={12} flex={1}>
        <TransactionIcon historyEntry={historyEntry} isLoading={isReclaiming} />

        <VStack spacing={0} flex={1}>
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
            <HStack align="center" spacing={4}>
              <UntranslatedText size={10} color={opacity(foreground, 0.8)}>
                {historyEntry?.createdAt
                  ? formatDate(historyEntry.createdAt, 'short-date-time')
                  : 'Unconfirmed'}
              </UntranslatedText>
              {transactionSource && (
                <Icon
                  name={SOURCE_ICONS[transactionSource]}
                  size={10}
                  color={opacity(foreground, 0.8)}
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
                  const usedLightning = historyEntry.type === 'melt';
                  // Sort: used method first
                  const items = [
                    hasLightning && { name: 'mdi:lightning-bolt', used: usedLightning },
                    hasEcash && { name: 'majesticons:coins', used: !usedLightning },
                  ].filter(Boolean) as { name: string; used: boolean }[];
                  items.sort((a, b) => (a.used === b.used ? 0 : a.used ? -1 : 1));
                  return items.map((item) => (
                    <Icon
                      key={item.name}
                      name={item.name}
                      size={10}
                      color={opacity(foreground, item.used ? 0.8 : 0.4)}
                    />
                  ));
                })()}
            </HStack>
            <UntranslatedText
              overpass
              bold
              size={10}
              color={opacity(foreground, 0.8)}
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
