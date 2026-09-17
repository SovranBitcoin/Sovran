/**
 * @fileoverview Onchain (NUT-30) receive screen.
 *
 * Always onchain. Everything shared with the other mint-quote rails lives in
 * `MintQuoteReceiveShell`; what is here is what a bitcoin deposit needs and no
 * other rail does — the mempool watcher, the confirmation timeline, the
 * explorer deep link, and the BIP-321 payment URI built around the address.
 */

import { useCallback, useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { getOnchainConfirmationProgress, isMintQuotePaymentObserved } from 'wallet';

import { HistoryEntryTimeline, mintDetailItem } from '@/features/transactions';
import { useMempoolAddressSummary } from '@/shared/hooks/useMempoolAddressSummary';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import {
  buildOnchainRequiredConfirmationProgress,
  buildSatisfiedOnchainConfirmationProgress,
  getMintQuotePaymentValue,
  getOnchainMintAddress,
  getOnchainMintQuoteRequiredConfirmations,
} from '@/shared/lib/cashu/onchainMint';
import { asHistoryEntry } from '@/shared/lib/cashu/syntheticHistory';
import { paymentLog } from '@/shared/lib/logger';
import { truncateMiddle } from '@/shared/lib/strings';
import { openExternalUrl } from '@/shared/lib/url';
import Icon from 'assets/icons';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';

import { MintQuoteReceiveShell, type MintQuoteScreenProps } from './MintQuoteReceiveShell';

export function OnchainReceiveScreen(props: MintQuoteScreenProps) {
  const { entry, mintUrl, mintInfo } = props;
  const historyEntry = asHistoryEntry(entry);
  const onchainAddress = getOnchainMintAddress(historyEntry);
  const mempool = useMempoolAddressSummary(onchainAddress);
  const isPaid = isMintQuotePaymentObserved(entry);
  const requiredConfirmations = getOnchainMintQuoteRequiredConfirmations(
    historyEntry,
    mintInfo,
    entry.unit ?? 'sat'
  );
  const observedConfirmationProgress = getOnchainConfirmationProgress(
    mempool.summary,
    requiredConfirmations
  );
  // KEPT as a manual memo — identity contract, not an optimization. React
  // Compiler will not preserve it (`observedConfirmationProgress` is a fresh
  // object whenever the helper has a summary to report, so it cannot prove the
  // dependency stable) and this screen therefore stays on the bailout list.
  // Dropping the memo is worse: on the null path the fallback would allocate
  // every render, re-running the shell's logging effect and invalidating the
  // whole timeline model in TimelineCard.
  // ast-grep-ignore: no-manual-memo-tsx
  const onchainConfirmationProgress = useMemo(
    () =>
      observedConfirmationProgress ??
      (isPaid
        ? buildSatisfiedOnchainConfirmationProgress(requiredConfirmations)
        : buildOnchainRequiredConfirmationProgress(requiredConfirmations)),
    [isPaid, observedConfirmationProgress, requiredConfirmations]
  );
  // A bitcoin address is payable as a BIP-321 URI carrying the requested
  // amount, so the QR encodes that rather than the bare address.
  const paymentValue = getMintQuotePaymentValue(historyEntry) ?? entry.paymentRequest;
  // Once the deposit is visible on our own explorer, offer a deep link to the
  // funding transaction (falling back to the address page) so the user can
  // watch confirmations at the source. Gated on an observed payment so the link
  // only appears alongside the on-chain confirmation status.
  const explorerLinkUrl = observedConfirmationProgress
    ? (mempool.summary?.transactionExplorerUrl ?? mempool.summary?.explorerUrl ?? null)
    : null;

  return (
    <MintQuoteReceiveShell
      {...props}
      screenName="OnchainReceiveScreen"
      logScope="receive.onchain"
      payment={{ label: 'Onchain Payment', value: paymentValue, copyTarget: 'address' }}
      usedKind="onchain"
      timeline={
        <>
          <HistoryEntryTimeline
            historyEntry={historyEntry}
            onchainConfirmationProgress={onchainConfirmationProgress}
          />
          {explorerLinkUrl && <OpenInExplorerLink url={explorerLinkUrl} />}
        </>
      }
      detailRows={[
        // Deliberately a plain truncated id, NOT the copyable
        // `quoteIdDetailItem` the Lightning screen uses — see the note on that
        // helper; making these copyable is a product decision, not a cleanup.
        entry.quoteId && { title: 'Quote ID', value: truncateMiddle(entry.quoteId, 7) },
        mintDetailItem(mintUrl),
        { title: 'Network Fee', value: 'Paid by sender' },
        onchainAddress && { title: 'Address', value: truncateMiddle(onchainAddress, 10) },
      ]}
      logFields={{
        hasOnchainAddress: !!onchainAddress,
        onchainAddressLength: onchainAddress?.length ?? 0,
        requiredConfirmations,
        hasObservedConfirmationProgress: !!observedConfirmationProgress,
        confirmationCurrent: onchainConfirmationProgress.currentConfirmations,
        confirmationRequired: onchainConfirmationProgress.requiredConfirmations,
      }}
    />
  );
}

function OpenInExplorerLink({ url }: { url: string }) {
  const linkColor = useThemeColor('link');
  const handlePress = useCallback(() => {
    paymentLog.info('receive.onchain.explorer.open', { urlLength: url.length });
    void openExternalUrl(url).mapErr((error) => {
      paymentLog.warn('receive.onchain.explorer.open_failed', { reason: error.type });
      return error;
    });
  }, [url]);
  return (
    <Pressable
      haptics
      accessibilityRole="link"
      accessibilityLabel="Open in explorer"
      onPress={handlePress}
      style={styles.explorerLink}>
      <Text size={13} color={linkColor}>
        Open in explorer
      </Text>
      <Icon name="lucide:arrow-up-right" size={14} color={linkColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  explorerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
  },
});
