/**
 * @fileoverview Shared ReceiveToken screen component
 *
 * Uses the screen-action system for entry tracking, redeem availability, and
 * execution. All redeem logic (mint trust check, payment toast, P2PK rotation,
 * scan history linking) is handled by the receiveToken.redeem handler.
 */

import React, { useEffect } from 'react';

import type { ReceiveHistoryEntry } from '@cashu/coco-core';
import { isReceiveTokenPending, isReceiveTokenRedeemed } from 'wallet';
import { useScreenActions } from 'wallet/react';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import {
  TransactionDetailShell,
  TransactionLocationSection,
  useBip321Info,
  Bip321MethodIcons,
} from '@/features/transactions';
import { formatAmount } from '@/shared/lib/currency';
import { truncateMiddle } from '@/shared/lib/strings';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { useMintInfo } from '@/shared/hooks/useMintInfo';

interface ReceiveTokenScreenProps {
  receiveHistoryEntry?: ReceiveHistoryEntry | string;
}

export function ReceiveTokenScreen({ receiveHistoryEntry }: ReceiveTokenScreenProps) {
  useLifecycleLogger('ReceiveTokenScreen');
  const { entry, error, actions, source, mintUrl } = useScreenActions(
    'receiveToken',
    receiveHistoryEntry
  );
  const mintInfo = useMintInfo(entry?.mintUrl);
  const bip321 = useBip321Info(entry?.id);

  useEffect(() => {
    if (error) paymentLog.warn('receive.token.error', { error });
  }, [error]);

  const isRedeemed = isReceiveTokenRedeemed(entry);
  const isPendingReceive = isReceiveTokenPending(entry);
  const canClose = isRedeemed || isPendingReceive;

  useEffect(() => {
    if (!entry) return;
    paymentLog.debug('receive.token.render', {
      id: entry.id,
      state: entry.state,
      isRedeemed,
      isPendingReceive,
      canClose,
      redeemAvailable: actions.redeem.available,
      redeemLoading: actions.redeem.loading,
      amount: entry.amount,
      unit: entry.unit,
    });
  }, [
    actions.redeem.available,
    actions.redeem.loading,
    canClose,
    entry,
    isRedeemed,
    isPendingReceive,
  ]);

  if (error) {
    return (
      <ScreenErrorState
        message={error}
        onGoBack={() => {
          void actions.back.execute();
        }}
      />
    );
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const bottomButtons = (
    <BottomButtons>
      <ButtonHandler
        buttons={[
          {
            testID: 'receive-token-close',
            text: 'Close',
            icon: 'ri:close-circle-line',
            variant: 'secondary',
            onPress: async () => actions.back.execute(),
            condition: canClose,
          },
          {
            testID: 'receive-token-cancel',
            text: 'Cancel',
            variant: 'secondary',
            onPress: async () => actions.back.execute(),
            // Fallback exit only: while the token is redeemable, Redeem is the
            // sole button (back nav still exits); Close takes over once settled.
            condition: !canClose && !actions.redeem.available,
          },
          {
            testID: 'receive-token-redeem',
            text: actions.redeem.loading ? 'Redeeming...' : 'Redeem Ecash',
            variant: 'primary',
            onPress: async () => {
              await actions.redeem.execute();
            },
            loading: actions.redeem.loading,
            condition: actions.redeem.available,
          },
        ]}
      />
    </BottomButtons>
  );

  return (
    <TransactionDetailShell
      screenName="ReceiveTokenScreen"
      testID={`receive-token-id-${entry.id}`}
      entry={entry}
      mintInfo={mintInfo}
      footer={bottomButtons}
      beforeStatus={isRedeemed ? <TransactionLocationSection transactionId={entry.id} /> : null}>
      <DetailsSection
        items={[
          source && { title: 'Source', value: source },
          bip321.isBip321 && { title: 'Format', value: 'BIP 321' },
          bip321.optionKinds && {
            title: 'Payment Methods',
            value: <Bip321MethodIcons optionKinds={bip321.optionKinds} usedKind="ecash" />,
          },
          { title: 'Date', value: entry.createdAt.datetime },
          { title: 'Amount', value: formatAmount({ amount: entry.amount, unit: entry.unit }) },
          mintUrl && { title: 'Mint', value: truncateMiddle(mintUrl, 12) },
          entry.p2pkPubkey && { title: 'P2PK', value: entry.p2pkPubkey.truncate(8) },
          entry.tokenString && { title: 'Token', value: entry.tokenString.truncate(6) },
        ].flatMap((item) => (item ? [item] : []))}
      />
    </TransactionDetailShell>
  );
}
