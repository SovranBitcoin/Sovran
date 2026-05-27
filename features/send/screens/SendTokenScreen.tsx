/**
 * @fileoverview Send Token screen component
 *
 * Display component for ecash send transactions. Actions (copy, share, NFC,
 * check status, cancel) are handled by the screen-action system; this screen
 * only renders UI and wires buttons.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';

import { Alert, Menu, type MenuTriggerRef } from 'heroui-native';
import type { SendHistoryEntry } from '@cashu/coco-core';
import { useScreenActions } from 'colada/react';
import type { ActionVariant } from 'colada';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
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
import { Screen } from '@/shared/ui/composed/Screen';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { fetchMintInfo } from '@/shared/lib/apiClient';
import Icon from 'assets/icons';
import { MenuScrim } from '@/shared/blocks/popup/MenuScrim';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import {
  useSendReachability,
  useSendReachabilityStore,
} from '@/shared/stores/profile/sendReachabilityStore';
import { spacing } from '@/shared/styles/tokens';
import { getSendTokenReachabilityWarning } from '../lib/sendTokenWarning';

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
  const { isOffline } = useOfflineStatus();
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
          description: 'Copy the token string',
          icon: 'lets-icons:copy',
          available: actions.copy.available,
        },
        {
          id: 'emoji',
          label: 'as Emoji',
          description: 'Copy as an emoji-packed string',
          icon: 'fluent:emoji-24-filled',
          available: actions.copyAsEmoji.available,
        },
      ],
    [actions.copy.variants, actions.copy.available, actions.copyAsEmoji.available]
  );

  const copyMenuTriggerRef = useRef<MenuTriggerRef>(null);
  const handleCopyVariant = useCallback(
    (variantId: string) => {
      void actions.copy.execute({ variantId });
    },
    [actions.copy]
  );
  const openCopyMenu = useCallback(() => {
    // Defer to the next tick so the ButtonHandler's sheet-close / press-in
    // animation doesn't race with the menu's trigger-position measure call.
    setTimeout(() => copyMenuTriggerRef.current?.open(), 0);
  }, []);

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

  const bottomButtons = (
    <BottomButtons>
      {/*
       * Bottom-sheet Menu opened imperatively from the Copy button's onPress
       * via the trigger ref's `.open()`. We keep the Trigger because heroui's
       * imperative API requires one, but its position is irrelevant for
       * bottom-sheet presentation — the sheet slides up from the bottom
       * regardless.
       */}
      <Menu presentation="bottom-sheet">
        <Menu.Trigger
          ref={copyMenuTriggerRef}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}>
          <View style={{ width: 1, height: 1 }} />
        </Menu.Trigger>
        <Menu.Portal>
          <MenuScrim />
          <Menu.Content presentation="bottom-sheet">
            <Menu.Label className="text-foreground -mt-2 mb-2 ml-3 text-lg font-bold">
              Copy token
            </Menu.Label>
            {copyVariants.map((v) => (
              <Menu.Item
                key={v.id}
                testID={`send-token-copy-menu-${v.id}`}
                isDisabled={!v.available}
                onPress={() => handleCopyVariant(v.id)}>
                <HStack align="center" gap={10} style={{ flex: 1 }}>
                  {v.icon ? <Icon name={v.icon} size={18} /> : null}
                  <View style={{ flex: 1 }}>
                    <Menu.ItemTitle>{v.label}</Menu.ItemTitle>
                    {(v.description || (!v.available && v.reason)) && (
                      <Menu.ItemDescription>
                        {!v.available && v.reason ? v.reason : v.description}
                      </Menu.ItemDescription>
                    )}
                  </View>
                </HStack>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu>

      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              testID: 'send-token-copy',
              text: 'Copy',
              icon: 'lets-icons:copy',
              variant: 'primary',
              onPress: () => {
                openCopyMenu();
              },
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
              text: 'Cancel Transaction',
              description: 'Reclaim proofs and void this token',
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
    <Screen name="SendTokenScreen" contentPadding={0} footer={bottomButtons}>
      {/*
       * Id marker wraps the screen body — lets `phone test` capture
       * the entry id of the send currently being viewed via
       * `capture #send-token-id-* suffix`. Same rationale as the
       * LightningReceiveScreen marker: without an in-screen source of the
       * entry id, tests have to guess from the transaction list on
       * the wallet home, where `findByTestIDPrefix` returns the
       * visually-topmost match and can pick up a stale row from a
       * previous run. Wrapping the VStack (rather than a zero-sized
       * sibling) guarantees a non-zero rect so the node appears in
       * the iOS AX tree.
       */}
      <View testID={`send-token-id-${entry.id}`}>
        <VStack gap={12}>
          <HistoryEntryHeader historyEntry={entry} showRecipientAvatar={false} />

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

          {entry.state !== 'finalized' &&
            String(entry.state) !== 'rolledBack' &&
            String(entry.state) !== 'rolled_back' &&
            entry.tokenString && (
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
  );
}

const styles = StyleSheet.create({
  reachabilityWarning: {
    marginHorizontal: spacing.lg,
  },
});
