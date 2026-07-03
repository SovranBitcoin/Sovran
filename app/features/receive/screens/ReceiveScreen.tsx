/**
 * @fileoverview Receive QR display — the standing receive rails behind the
 * hub's "QR Display" option (Unified / Lightning / Onchain / Cashu tabs).
 *
 * Entry, copy, and mint-change actions come from `useScreenActions('receive')`
 * with the payment machine from ColadaProvider. Paste / Fixed Amount / Scan QR
 * live on the receive hub (ReceiveHubScreen); the footer here is a single
 * Copy of whatever payload the visible tab's QR is showing (each rail
 * reports its value via `onQrPayload`).
 */

import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { setStringAsync } from 'expo-clipboard';

import type { GetInfoResponse } from '@cashu/cashu-ts';
import { ListGroup, PressableFeedback } from 'heroui-native';

import {
  useScreenActions,
  useStandingPaymentRequest,
  type UseScreenActionsResult,
} from 'wallet/react';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';

import type { FormattedString } from 'wallet';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { ReceiveReusableQuoteTab } from '@/features/receive/components/ReceiveReusableQuoteTab';
import { ReceivePaymentRequestTab } from '@/features/receive/components/ReceivePaymentRequestTab';
import { ReceiveUnifiedTab } from '@/features/receive/components/ReceiveUnifiedTab';
import { ActionSegmentsCard } from '@/shared/ui/composed/ActionSegmentsCard';
import { computeReceiveTabs } from '@/features/receive/lib/receiveTabs';
import type { ReceiveQrPayload } from '@/features/receive/lib/qrPayload';
import {
  MAX_ADVERTISED_MINTS,
  standingQuoteIdentityStore,
} from '@/features/receive/lib/standingQuoteIdentityStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { copyPopup } from '@/shared/lib/popup';
import { Section } from '@/shared/ui/composed/Section';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { HistoryEntryRefresh } from '@/features/transactions';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { ScreenErrorState } from '@/shared/ui/composed/ScreenStates';
import { UnderlineTabs } from '@/shared/ui/composed/UnderlineTabs';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { ReceiveRailPlaceholder } from '@/features/receive/components/ReceiveRailPlaceholder';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { View } from '@/shared/ui/primitives/View/View';
import { useNpcMintStore } from '@/shared/stores/profile/npcMintStore';
import Icon from 'assets/icons';

interface ReceiveHubEntry {
  npcAddress?: FormattedString;
  p2pkKey?: string;
  selectedMintUrl?: string;
}

interface ReceiveLightningTabProps {
  data: ReceiveHubEntry;
  unit: string;
  mintInfo: GetInfoResponse | null;
  selectedMintUrl: string | undefined;
  /** NPC mint sync disables the mint row; not on history entry (store-only). */
  isNpcMintUpdating: boolean;
  actions: UseScreenActionsResult<'receive'>['actions'];
  /** Under-QR slot (the Address/BOLT 12 mode switcher) — rendered in every
   *  state so the switcher never disappears. */
  belowQr?: React.ReactNode;
  muted: string;
}

const ReceiveLightningTab = memo(function ReceiveLightningTab({
  data,
  unit,
  mintInfo,
  selectedMintUrl,
  isNpcMintUpdating,
  actions,
  belowQr,
  muted,
}: ReceiveLightningTabProps) {
  const npcAddress = unit === 'sat' ? data.npcAddress : undefined;
  const belowQrSlot = belowQr ? <View style={{ marginTop: 12 }}>{belowQr}</View> : null;
  if (!npcAddress) return belowQrSlot;

  return (
    <>
      <PaymentInfo data={npcAddress.toString()} copyTarget="address" unit="sat" />
      {belowQrSlot}
      <View className="mx-4">
        <Section title="RECEIVE ADDRESS">
          <GradientCard>
            <ListGroup variant="transparent">
              <PressableFeedback
                animation={false}
                onPress={async () => {
                  await EnhancedHaptics.copyHaptic();
                  await actions.copy.execute({ source: 'npc' });
                }}>
                <PressableFeedback.Scale>
                  <ListGroup.Item disabled>
                    <ListGroup.ItemPrefix>
                      <Icon name="mingcute:lightning-fill" size={20} color={muted} />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>{npcAddress.truncate(6)}</ListGroup.ItemTitle>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      <Icon name="lets-icons:copy" size={20} color={muted} />
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>
                </PressableFeedback.Scale>
                <PressableFeedback.Ripple />
              </PressableFeedback>
            </ListGroup>
          </GradientCard>
        </Section>
      </View>

      <HistoryEntryRefresh
        mintInfo={mintInfo}
        historyEntry={{
          type: 'receive',
          mintUrl: selectedMintUrl || undefined,
        }}
        onPress={
          isNpcMintUpdating || !actions.changeNpcMint.available
            ? undefined
            : async () => {
                await EnhancedHaptics.copyHaptic();
                await actions.changeNpcMint.execute();
              }
        }
      />
    </>
  );
});

/**
 * Keeps every receive tab MOUNTED once the hub's entry is ready, showing only
 * the selected one (`display: none` hides without unmounting). The Bolt12
 * offer and Onchain address therefore resolve/preload when the screen opens
 * — switching tabs shows the finished QR instead of flashing the skeleton
 * while the standing quote loads.
 */
function TabPane({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return <View style={visible ? undefined : styles.hiddenPane}>{children}</View>;
}

const styles = StyleSheet.create({
  hiddenPane: {
    display: 'none',
  },
});

interface ReceiveScreenProps {
  receiveEntry?: string | Record<string, unknown>;
  unit: string;
}

export function ReceiveScreen({ receiveEntry, unit }: ReceiveScreenProps) {
  useLifecycleLogger('ReceiveScreen');
  const muted = useThemeColor('muted');
  const [selectedTab, setSelectedTab] = useState<string>('Unified');
  const [lightningMode, setLightningMode] = useState<'address' | 'offer'>('address');

  const lightningModeSwitcher = useMemo(
    () => (
      <ActionSegmentsCard
        segments={[
          {
            label: 'Address',
            active: lightningMode === 'address',
            onPress: () => setLightningMode('address'),
            testID: 'receive-lightning-mode-address',
          },
          {
            label: 'BOLT 12',
            active: lightningMode === 'offer',
            onPress: () => setLightningMode('offer'),
            testID: 'receive-lightning-mode-offer',
          },
        ]}
      />
    ),
    [lightningMode]
  );

  const { entry, error, actions, mintUrl } = useScreenActions(
    'receive',
    receiveEntry as string | Record<string, unknown> | undefined
  );

  const receiveEntryData = entry as ReceiveHubEntry | null;
  const hasReceiveEntryData = Boolean(receiveEntryData);

  // Each rail reports its copyable payload as it resolves; the footer Copy
  // copies whichever rail the visible tab is showing.
  const [qrPayloads, setQrPayloads] = useState<Record<string, ReceiveQrPayload | null>>({});
  const setQrPayload = useCallback((key: string, payload: ReceiveQrPayload | null) => {
    setQrPayloads((prev) => {
      const existing = prev[key];
      if (existing === payload) return prev;
      if (
        existing &&
        payload &&
        existing.value === payload.value &&
        existing.copyTarget === payload.copyTarget
      ) {
        return prev;
      }
      return { ...prev, [key]: payload };
    });
  }, []);
  const onOfferPayload = useCallback(
    (p: ReceiveQrPayload | null) => setQrPayload('lightning-offer', p),
    [setQrPayload]
  );
  const onUnifiedPayload = useCallback(
    (p: ReceiveQrPayload | null) => setQrPayload('unified', p),
    [setQrPayload]
  );
  const onOnchainPayload = useCallback(
    (p: ReceiveQrPayload | null) => setQrPayload('onchain', p),
    [setQrPayload]
  );
  const onCashuPayload = useCallback(
    (p: ReceiveQrPayload | null) => setQrPayload('cashu', p),
    [setQrPayload]
  );

  const npcAddress = unit === 'sat' ? receiveEntryData?.npcAddress : undefined;
  const activePayload: ReceiveQrPayload | null =
    selectedTab === 'Lightning'
      ? lightningMode === 'address'
        ? npcAddress
          ? { value: npcAddress.toString(), copyTarget: 'address' }
          : null
        : (qrPayloads['lightning-offer'] ?? null)
      : selectedTab === 'Unified'
        ? (qrPayloads['unified'] ?? null)
        : selectedTab === 'Onchain'
          ? (qrPayloads['onchain'] ?? null)
          : (qrPayloads['cashu'] ?? null);

  const handleFooterCopy = useCallback(async () => {
    if (!activePayload) return;
    await EnhancedHaptics.copyHaptic();
    await setStringAsync(activePayload.value);
    copyPopup(activePayload.copyTarget);
    paymentLog.info('receive.qr.footer_copied', {
      tab: selectedTab,
      copyTarget: activePayload.copyTarget,
      valueLength: activePayload.value.length,
    });
  }, [activePayload, selectedTab]);

  const isNpcMintUpdating = useNpcMintStore((s) => s.isUpdating);
  const mintInfo = useMintInfo(mintUrl);
  const walletContext = useWalletContext();

  // THE standing creq, owned here and shared by the Cashu + Unified tabs so
  // both always show the SAME request. freshOnMount rotates once per visit;
  // the hook deliberately reports loading (no stale cache seed) until the
  // fresh request lands, so neither tab can flash a retired creq.
  const creqP2pkLock = useMintStore((s) => s.creqP2pkLock);
  const creqLockPubkey =
    creqP2pkLock && receiveEntryData?.p2pkKey ? receiveEntryData.p2pkKey : undefined;
  const creqMints = useMemo(
    () => walletContext.trustedMintUrls.slice(0, MAX_ADVERTISED_MINTS),
    [walletContext.trustedMintUrls]
  );
  const creq = useStandingPaymentRequest(
    creqMints.length > 0 ? { unit, mints: creqMints, lockP2pkPubkey: creqLockPubkey } : null,
    standingQuoteIdentityStore,
    { freshOnMount: true }
  );

  const tabs = useMemo(() => computeReceiveTabs(), []);

  useEffect(() => {
    paymentLog.info('receive.tabs.computed', { tabs: tabs.join(','), unit });
  }, [tabs, unit]);

  // If the open tab disappears (setting toggled off / capability change),
  // snap back to Lightning so hidden content stops rendering.
  useEffect(() => {
    if (!(tabs as readonly string[]).includes(selectedTab)) setSelectedTab('Unified');
  }, [tabs, selectedTab]);

  useEffect(() => {
    if (error) paymentLog.warn('receive.screen.error', { error });
  }, [error]);

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

  return (
    <ScreenWrapper
      name="ReceiveScreen"
      contentPadding={0}
      deferContent={false}
      footer={
        <BottomButtons>
          {/* Paste / Fixed Amount / Scan QR moved to the receive hub — here
              the one relevant action is copying what the QR is showing. */}
          <ButtonHandler
            buttons={[
              {
                testID: 'receive-copy',
                text: 'Copy',
                icon: 'lets-icons:copy',
                variant: 'primary',
                onPress: handleFooterCopy,
                disabled: !hasReceiveEntryData || !activePayload,
                condition: true,
              },
            ]}
          />
        </BottomButtons>
      }>
      {tabs.length > 1 && (
        <View className="mx-4 mb-4">
          <UnderlineTabs tabs={tabs} selectedTab={selectedTab} handleTabPress={setSelectedTab} />
        </View>
      )}

      <SkeletonContentCrossfade
        loading={!receiveEntryData}
        visualKey="receive-hub"
        visualSurface="receive"
        renderSkeleton={() => (
          <ReceiveRailPlaceholder
            sectionTitle="RECEIVE ADDRESS"
            testID="receive-hub-placeholder"
            qrTestID="receive-hub-qr-placeholder"
          />
        )}
        renderContent={() => {
          if (!receiveEntryData) return null;
          return (
            <>
              <TabPane visible={selectedTab === 'Lightning'}>
                {/* Two Lightning rails behind a VISIBLE mode switcher — the
                    npub.cash address (human-readable, BIP-353-style) and the
                    reusable BOLT 12 offer. The switcher rides each sub-view's
                    under-QR slot (rendered in every state, so it can never
                    disappear); both sub-views stay mounted so switching never
                    stutters. */}
                <View style={lightningMode === 'address' ? undefined : styles.hiddenPane}>
                  <ReceiveLightningTab
                    data={receiveEntryData}
                    unit={unit}
                    mintInfo={mintInfo}
                    selectedMintUrl={mintUrl}
                    isNpcMintUpdating={isNpcMintUpdating}
                    actions={actions}
                    belowQr={lightningModeSwitcher}
                    muted={muted}
                  />
                </View>
                <View style={lightningMode === 'offer' ? undefined : styles.hiddenPane}>
                  <ReceiveReusableQuoteTab
                    method="bolt12"
                    unit={unit}
                    walletContext={walletContext}
                    actions={actions}
                    belowQr={lightningModeSwitcher}
                    muted={muted}
                    onQrPayload={onOfferPayload}
                  />
                </View>
              </TabPane>
              <TabPane visible={selectedTab === 'Unified'}>
                <ReceiveUnifiedTab
                  unit={unit}
                  walletContext={walletContext}
                  muted={muted}
                  creq={creq}
                  onQrPayload={onUnifiedPayload}
                />
              </TabPane>
              <TabPane visible={selectedTab === 'Onchain'}>
                <ReceiveReusableQuoteTab
                  method="onchain"
                  unit={unit}
                  walletContext={walletContext}
                  actions={actions}
                  muted={muted}
                  onQrPayload={onOnchainPayload}
                />
              </TabPane>
              <TabPane visible={selectedTab === 'Cashu'}>
                <ReceivePaymentRequestTab
                  unit={unit}
                  walletContext={walletContext}
                  p2pkKey={receiveEntryData.p2pkKey}
                  muted={muted}
                  creq={creq}
                  onQrPayload={onCashuPayload}
                />
              </TabPane>
            </>
          );
        }}
      />
    </ScreenWrapper>
  );
}
