/**
 * @fileoverview Send Token screen component
 *
 * Display component for ecash send transactions. Actions (copy, share, NFC,
 * check status, cancel) are handled by the screen-action system; this screen
 * only renders UI and wires buttons.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { Alert } from 'heroui-native';
import type { SendHistoryEntry } from '@cashu/coco-core';
import { useScreenActions, useColadaTransactionAnnotation } from 'wallet/react';
import {
  getSendTokenReachabilityWarning,
  isSendTokenCancelled,
  isSendTokenComplete,
  type ActionVariant,
} from 'wallet';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import {
  TransactionDetailShell,
  TransactionLocationSection,
  useBip321Info,
  transactionLeadDetailItems,
} from '@/features/transactions';
import { formatAmount } from '@/shared/lib/currency';
import { truncateMiddle } from '@/shared/lib/strings';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { fetchMintInfo } from '@/shared/lib/apiClient';
import { actionMenuSheet } from '@/shared/lib/popup/popups/actionMenuSheet';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import {
  useSendReachability,
  useSendReachabilityStore,
} from '@/shared/stores/profile/sendReachabilityStore';
import { spacing } from '@/shared/styles/tokens';
import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';
import {
  extractMemoNprofileReferences,
  formatMemoForDisplay,
} from '@/shared/lib/nostr/memoMentions';
import { resolveIdentityName } from '@/shared/lib/identity';
import { hasP2PKLock, P2PKLockIndicator } from '../components/P2PKLockIndicator';

interface SendTokenScreenProps {
  sendHistoryEntry?: SendHistoryEntry | string;
  createdOffline?: boolean;
  mintWasOffline?: boolean;
  onNavigateBack: () => void;
}

export function SendTokenScreen({
  sendHistoryEntry,
  createdOffline,
  mintWasOffline,
  onNavigateBack,
}: SendTokenScreenProps) {
  useLifecycleLogger('SendTokenScreen');
  const { entry, error, actions, source, mintUrl } = useScreenActions(
    'sendToken',
    sendHistoryEntry
  );
  const mintInfo = useMintInfo(entry?.mintUrl);
  const bip321 = useBip321Info(entry?.id);
  // Sends that paid a NUT-18 creq carry a persisted paymentRequest annotation
  // (written at confirm time) — surface it so this isn't read as plain ecash.
  const paymentRequest = useColadaTransactionAnnotation(entry).paymentRequest;
  const { isOffline } = useOfflineStatus();
  const muted = useThemeColor('muted');
  const transactionId = typeof entry?.id === 'string' ? entry.id : undefined;
  const reachability = useSendReachability(transactionId);

  useEffect(() => {
    const shouldTrackReachability = createdOffline === true || !!reachability;
    if (!shouldTrackReachability || !transactionId || !mintUrl) return;

    const store = useSendReachabilityStore.getState();
    const current = store.byTransactionId[transactionId];
    let currentStatus = current?.status;
    if (!current) {
      store.markChecking(transactionId, mintUrl);
      currentStatus = 'checking';
    }

    if (isOffline) {
      if (currentStatus !== 'device-offline') {
        store.markDeviceOffline(transactionId, mintUrl);
      }
      return;
    }

    if (currentStatus === 'mint-reachable' || currentStatus === 'mint-unreachable') {
      return;
    }

    let cancelled = false;
    if (currentStatus !== 'checking') {
      store.markChecking(transactionId, mintUrl);
    }
    void fetchMintInfo(mintUrl, { timeoutMs: 1500 })
      .then((result) => {
        if (cancelled) return;
        if (result.isOk()) {
          store.markMintReachable(transactionId, mintUrl);
        } else {
          store.markMintUnreachable(transactionId, mintUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          store.markMintUnreachable(transactionId, mintUrl);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [createdOffline, isOffline, mintUrl, reachability, transactionId]);

  // NOTE: All hook calls must run on every render. Early returns for
  // error / loading states live below these hooks to respect the Rules of
  // Hooks — before this, `entry` flipping from undefined → defined would
  // add new hook calls mid-lifecycle and trigger "Rendered more hooks than
  // during the previous render".
  const copyVariants: ActionVariant[] = useMemo(
    () =>
      actions.copy.variants ?? [
        {
          id: 'text',
          label: 'as Text',
          description: 'Copy the token as plain text',
          icon: 'lets-icons:copy',
          available: actions.copy.available,
        },
        {
          id: 'emoji',
          label: 'as Emoji',
          description: 'Copy the token as emoji',
          icon: 'fluent:emoji-24-filled',
          available: actions.copy.available,
        },
      ],
    [actions.copy.variants, actions.copy.available]
  );

  const handleCopyVariant = useCallback(
    (variantId: string) => {
      void actions.copy.execute({ variantId });
    },
    [actions.copy]
  );
  if (error) {
    log.warn('send.token.error', { error });
    return <ScreenErrorState message={error} onGoBack={onNavigateBack} />;
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }
  log.debug('send.token.render', {
    state: entry.state,
    amount: entry.amount,
    unit: entry.unit,
    createdOffline,
    mintWasOffline,
    reachabilityStatus: reachability?.status,
  });
  const reachabilityWarning = getSendTokenReachabilityWarning(entry, {
    mintWasOffline,
    reachabilityStatus: reachability?.status,
  });
  const isComplete = isSendTokenComplete(entry);
  const isCancelled = isSendTokenCancelled(entry);
  const p2pkLocked = hasP2PKLock(entry);
  const tokenMemo =
    typeof entry.token?.memo === 'string' && entry.token.memo.trim().length > 0
      ? entry.token.memo.trim()
      : null;

  // Copy lives inside a native route modal, so its variants use the
  // FullWindowOverlay-backed action-menu sheet. The root ActionMenuHost disables
  // FWO and would paint this chooser underneath the transaction flow on iOS.
  const openCopyMenu = () => {
    actionMenuSheet({
      title: 'Copy token',
      buttons: copyVariants.map((v) => ({
        text: v.label,
        icon: v.icon,
        testID: `send-token-copy-menu-${v.id}`,
        disabled: !v.available,
        reason: v.reason,
        description: v.description,
        onPress: () => handleCopyVariant(v.id),
      })),
    });
  };

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              testID: 'send-token-copy',
              text: 'Copy',
              icon: 'lets-icons:copy',
              variant: 'primary',
              onPress: openCopyMenu,
              condition: actions.copy.available,
            },
            {
              testID: 'send-token-share',
              text: 'Share',
              icon: 'mdi:share-variant',
              variant: 'secondary',
              onPress: () => actions.share.execute(),
              condition: actions.share.available,
            },
            {
              testID: 'send-token-nfc',
              text: 'NFC',
              description: 'Transmit to a nearby phone',
              icon: 'lucide:nfc',
              variant: 'secondary',
              onPress: async () => {
                await new Promise((r) => setTimeout(r, 400));
                await actions.nfc.execute();
              },
              condition: actions.nfc.available,
            },
            {
              testID: 'send-token-check-status',
              text: actions.checkStatus.loading ? 'Checking...' : 'Check Status',
              description: 'Refresh the pending state',
              icon: 'mdi:refresh',
              variant: 'secondary',
              onPress: () => actions.checkStatus.execute(),
              condition: actions.checkStatus.available,
            },
            {
              testID: 'send-token-cancel-transaction',
              text: 'Cancel transaction',
              description: 'Return the funds to your balance',
              icon: 'mdi:cancel',
              variant: 'dangerous',
              onPress: () => actions.cancel.execute(),
              condition: actions.cancel.available,
            },
          ]}
        />
      </HStack>
    </BottomButtons>
  );

  return (
    <TransactionDetailShell
      screenName="SendTokenScreen"
      testID={`send-token-id-${entry.id}`}
      entry={entry}
      mintInfo={mintInfo}
      source={source}
      footer={bottomButtons}
      beforeStatus={
        <>
          {p2pkLocked ? <P2PKLockIndicator /> : null}
          {reachabilityWarning && (
            <View style={styles.reachabilityWarning}>
              <Alert status="warning" className="bg-surface-secondary">
                <Alert.Content>
                  <Alert.Title>{reachabilityWarning.title}</Alert.Title>
                  <Alert.Description>{reachabilityWarning.description}</Alert.Description>
                </Alert.Content>
              </Alert>
            </View>
          )}

          {!isComplete && !isCancelled && entry.tokenString && (
            <PaymentInfo
              copyTarget="token"
              unit={entry.unit}
              data={entry.tokenString.toString()}
              animated={(entry.tokenString.length ?? 0) >= 500}
            />
          )}

          {tokenMemo ? (
            <GradientCard
              testID="send-token-memo"
              style={styles.memoCard}
              contentStyle={styles.memoContent}>
              <Text size={12} weight="bold" style={[styles.memoLabel, { color: muted }]}>
                Memo
              </Text>
              <SendTokenMemoText memo={tokenMemo} />
            </GradientCard>
          ) : null}

          {isComplete && <TransactionLocationSection transactionId={entry.id} />}
        </>
      }>
      <DetailsSection
        items={[
          paymentRequest && { title: 'Type', value: 'Payment Request' },
          paymentRequest?.requestId && {
            title: 'Request ID',
            value: truncateMiddle(paymentRequest.requestId, 8),
          },
          ...transactionLeadDetailItems({
            source,
            bip321,
            usedKind: 'ecash',
            createdAt: entry.createdAt.datetime,
          }),
          {
            title: 'Amount',
            value: formatAmount({ amount: entry.amount, unit: entry.unit }),
          },
          { title: 'State', value: entry.state },
          entry.operationId && {
            title: 'Operation ID',
            value: truncateMiddle(entry.operationId, 7),
          },
          mintUrl && { title: 'Mint', value: truncateMiddle(mintUrl, 12) },
          entry.tokenString && {
            title: 'Token',
            value: entry.tokenString.truncate(6),
          },
        ]}
      />
    </TransactionDetailShell>
  );
}

function SendTokenMemoText({ memo }: { memo: string }): React.ReactElement {
  const references = useMemo(() => extractMemoNprofileReferences(memo), [memo]);
  const pubkeys = useMemo(
    () => [...new Set(references.map((reference) => reference.pubkey))],
    [references]
  );
  const { metadata } = useNostrProfileMetadataMany(pubkeys);
  const displayMemo = useMemo(
    () =>
      formatMemoForDisplay(memo, (pubkey) =>
        resolveIdentityName({
          pubkey,
          nostrProfile: metadata.get(pubkey),
        })
      ),
    [memo, metadata]
  );

  return (
    <Text size={15} selectable>
      {displayMemo}
    </Text>
  );
}

const styles = StyleSheet.create({
  reachabilityWarning: {
    marginHorizontal: spacing.lg,
  },
  memoCard: {
    marginHorizontal: spacing.lg,
  },
  memoContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  memoLabel: {
    textTransform: 'uppercase',
  },
});
