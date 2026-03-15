/**
 * @fileoverview Send Token screen component
 *
 * Display component for ecash send transactions. Actions (copy, share, NFC,
 * check status, cancel) are handled by the screen-action system; this screen
 * only renders UI and wires buttons.
 */

import React from 'react';

import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import type { SendHistoryEntry } from 'coco-cashu-core';

import {
  HistoryEntryHeader,
  useTransactionSource,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
} from '@/features/transactions';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { truncateMiddle } from '@/shared/lib/strings';
import { convertTime } from '@/shared/lib/time';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useScreenActions } from '@/shared/hooks/useScreenActions';

interface SendTokenScreenProps {
  sendHistoryEntry?: SendHistoryEntry | string;
  onNavigateBack: () => void;
}

export function SendTokenScreen({ sendHistoryEntry, onNavigateBack }: SendTokenScreenProps) {
  const { entry, error, actions } = useScreenActions<'sendToken', SendHistoryEntry>(
    'sendToken',
    sendHistoryEntry
  );
  const sourceLabel = useTransactionSource(entry?.id);
  const mintInfo = useMintInfo(entry?.mintUrl);

  if (error) {
    return <ScreenErrorState message={error} onGoBack={onNavigateBack} />;
  }

  if (!entry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const encodedToken = entry.token ? getEncodedTokenV4(entry.token) : '';

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
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
              text: 'Share',
              icon: 'mdi:share-variant',
              variant: 'secondary',
              onPress: async (close: any) => {
                await actions.share.execute();
                close({});
              },
              condition: actions.share.available,
            },
            {
              text: 'NFC',
              icon: 'lucide:nfc',
              variant: 'secondary',
              onPress: async (close: any) => {
                await actions.nfc.execute();
                close({});
              },
              condition: actions.nfc.available,
            },
            {
              text: 'Copy as Emoji',
              icon: 'fluent:emoji-24-filled',
              variant: 'primary',
              pushSheet: {
                sheetId: 'emoji-picker',
                payload: { token: encodedToken },
              },
              condition: actions.copyAsEmoji.available,
            },
            {
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
      <VStack gap={12}>
        <HistoryEntryHeader historyEntry={entry} />

        {entry.state === 'pending' && (
          <PaymentInfo
            copyTarget="ecashToken"
            unit={entry.unit}
            data={encodedToken}
            animated={encodedToken.length >= 500}
          />
        )}

        {mintInfo && <HistoryEntryRefresh historyEntry={entry} mintInfo={mintInfo} />}

        <HistoryEntryTimeline historyEntry={entry} />

        <DetailsSection
          items={[
            sourceLabel && { title: 'Source', value: sourceLabel },
            { title: 'Date', value: convertTime(new Date(entry.createdAt)) },
            entry.token && {
              title: 'Token',
              value: truncateMiddle(getEncodedTokenV4(entry.token), 6),
            },
          ].flatMap((item) => (item ? [item] : []))}
        />
      </VStack>
    </ModalLayoutWrapper>
  );
}
