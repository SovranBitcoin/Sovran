/**
 * @fileoverview Send Token screen component
 *
 * Display component for ecash send transactions. Actions (copy, share, NFC,
 * check status, cancel) are handled by the screen-action system; this screen
 * only renders UI and wires buttons.
 */

import React from 'react';

import { Alert } from 'heroui-native';
import type { SendHistoryEntry } from '@cashu/coco-core';
import { useScreenActions } from 'coco-payment-ux/react';
import { log, useLifecycleLogger, Screen } from '@/shared/lib/logger';
import {
  HistoryEntryHeader,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  TransactionLocationSection,
  useBip321Info,
  Bip321MethodIcons,
} from '@/features/transactions';
import { formatAmount } from '@/shared/lib/currency';
import { truncateMiddle } from '@/shared/lib/strings';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useMintInfo } from '@/shared/hooks/useMintInfo';

interface SendTokenScreenProps {
  sendHistoryEntry?: SendHistoryEntry | string;
  mintWasOffline?: boolean;
  onNavigateBack: () => void;
}

export function SendTokenScreen({
  sendHistoryEntry,
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
    mintWasOffline,
  });

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
              onPress: async (close: any) => {
                await actions.copy.execute();
                close({});
              },
              condition: actions.copy.available,
            },
            {
              testID: 'send-token-share',
              text: 'Share',
              icon: 'mdi:share-variant',
              variant: 'secondary',
              onPress: async (close: any) => {
                close({});
                await actions.share.execute();
              },
              condition: actions.share.available,
            },
            {
              testID: 'send-token-nfc',
              text: 'NFC',
              icon: 'lucide:nfc',
              variant: 'secondary',
              onPress: async (close: any) => {
                close({});
                await new Promise((r) => setTimeout(r, 400));
                await actions.nfc.execute();
              },
              condition: actions.nfc.available,
            },
            {
              testID: 'send-token-copy-emoji',
              text: 'Copy as Emoji',
              icon: 'fluent:emoji-24-filled',
              variant: 'primary',
              onPress: async (close: any) => {
                await actions.copyAsEmoji.execute();
              },
              condition: actions.copyAsEmoji.available,
            },
            {
              testID: 'send-token-check-status',
              text: actions.checkStatus.loading ? 'Checking...' : 'Check Status',
              icon: 'mdi:refresh',
              variant: 'secondary',
              onPress: async (close: any) => {
                await actions.checkStatus.execute();
                close({});
              },
              condition: actions.checkStatus.available,
            },
            {
              testID: 'send-token-cancel-transaction',
              text: 'Cancel Transaction',
              icon: 'mdi:cancel',
              variant: 'dangerous',
              onPress: async (close: any) => {
                await actions.cancel.execute();
                close({});
              },
              condition: actions.cancel.available,
            },
          ]}
        />
      </HStack>
    </BottomButtons>
  );

  return (
    <ModalLayoutWrapper contentPadding={0} bottomContent={bottomButtons}>
      <Screen name="SendTokenScreen">
        {/*
         * Id marker wraps the screen body — lets `phone test` capture
         * the entry id of the send currently being viewed via
         * `capture #send-token-id-* suffix`. Same rationale as the
         * MintQuoteScreen marker: without an in-screen source of the
         * entry id, tests have to guess from the transaction list on
         * the wallet home, where `findByTestIDPrefix` returns the
         * visually-topmost match and can pick up a stale row from a
         * previous run. Wrapping the VStack (rather than a zero-sized
         * sibling) guarantees a non-zero rect so the node appears in
         * the iOS AX tree.
         */}
        <View testID={`send-token-id-${entry.id}`}>
          <VStack gap={12}>
            <HistoryEntryHeader historyEntry={entry} />

            {mintWasOffline && (
              <Alert status="warning" className="bg-surface-secondary">
                <Alert.Content>
                  <Alert.Title>Mint was offline</Alert.Title>
                  <Alert.Description>
                    This token was created offline. The recipient may have trouble redeeming it
                    until the mint is back online.
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            {entry.state !== 'finalized' && entry.state !== 'rolledBack' && entry.tokenString && (
              <PaymentInfo
                copyTarget="token"
                unit={entry.unit}
                data={entry.tokenString.toString()}
                animated={(entry.tokenString.length ?? 0) >= 500}
              />
            )}

            {entry.state === 'finalized' && <TransactionLocationSection transactionId={entry.id} />}

            <HistoryEntryRefresh historyEntry={entry} mintInfo={mintInfo} />

            <HistoryEntryTimeline historyEntry={entry} />

            <DetailsSection
              items={[
                source && { title: 'Source', value: source },
                bip321.isBip321 && { title: 'Format', value: 'BIP 321' },
                bip321.optionKinds && {
                  title: 'Payment Methods',
                  value: <Bip321MethodIcons optionKinds={bip321.optionKinds} usedKind="ecash" />,
                },
                { title: 'Date', value: entry.createdAt.datetime },
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
              ].flatMap((item) => (item ? [item] : []))}
            />
          </VStack>
        </View>
      </Screen>
    </ModalLayoutWrapper>
  );
}
