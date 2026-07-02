/**
 * @fileoverview Shared Receive screen component
 *
 * Receive hub UI — entry, copy, and hub actions come from `useScreenActions`;
 * paste / fixed amount / scan / NPC mint change run through colada handlers
 * with the payment machine from ColadaProvider (wallet context binds in
 * usePaymentFlowMachine after entry is available).
 */

import React, { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import type { GetInfoResponse } from '@cashu/cashu-ts';
import { ListGroup, PressableFeedback } from 'heroui-native';

import { useScreenActions, type UseScreenActionsResult } from 'wallet/react';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';

import type { FormattedString } from 'wallet';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { ReceiveReusableQuoteTab } from '@/features/receive/components/ReceiveReusableQuoteTab';
import { ReceivePaymentRequestTab } from '@/features/receive/components/ReceivePaymentRequestTab';
import { ReceiveUnifiedTab } from '@/features/receive/components/ReceiveUnifiedTab';
import { ActionSegmentsCard } from '@/shared/ui/composed/ActionSegmentsCard';
import { computeReceiveTabs } from '@/features/receive/lib/receiveTabs';
import { Section } from '@/shared/ui/composed/Section';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { HistoryEntryRefresh } from '@/features/transactions';
import { truncateMiddle } from '@/shared/lib/strings';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { ScreenErrorState } from '@/shared/ui/composed/ScreenStates';
import { UnderlineTabs } from '@/shared/ui/composed/UnderlineTabs';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Text } from '@/shared/ui/primitives/Text';
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

const QR_PLACEHOLDER_HORIZONTAL_INSET = 32;

function ReceiveHubPlaceholder() {
  const { width } = useWindowDimensions();
  const qrFrameSize = Math.max(0, Math.min(width, 600) - QR_PLACEHOLDER_HORIZONTAL_INSET);
  const qrPlaceholderStyle = useMemo(
    () => [styles.qrPlaceholder, { width: qrFrameSize, height: qrFrameSize }],
    [qrFrameSize]
  );

  return (
    <>
      <View testID="receive-hub-placeholder" style={styles.placeholderContainer}>
        <Skeleton testID="receive-hub-qr-placeholder" style={qrPlaceholderStyle} />
      </View>
      <View className="mx-4">
        <Section title="RECEIVE ADDRESS">
          <GradientCard>
            <ListGroup variant="transparent">
              <ListGroup.Item disabled>
                <ListGroup.ItemPrefix>
                  <Skeleton style={styles.placeholderIcon} />
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <Skeleton style={styles.placeholderLine} />
                </ListGroup.ItemContent>
                <ListGroup.ItemSuffix>
                  <Skeleton style={styles.placeholderIcon} />
                </ListGroup.ItemSuffix>
              </ListGroup.Item>
            </ListGroup>
          </GradientCard>
        </Section>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  hiddenPane: {
    display: 'none',
  },
  placeholderContainer: {
    alignItems: 'center',
  },
  qrPlaceholder: {
    borderRadius: 16,
  },
  placeholderIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  placeholderLine: {
    width: '58%',
    height: 18,
    borderRadius: 9,
  },
});

interface ReceiveScreenProps {
  receiveEntry?: string | Record<string, unknown>;
  unit: string;
}

export function ReceiveScreen({ receiveEntry, unit }: ReceiveScreenProps) {
  useLifecycleLogger('ReceiveScreen');
  const muted = useThemeColor('muted');
  const [selectedTab, setSelectedTab] = useState<string>('Lightning');
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

  const isNpcMintUpdating = useNpcMintStore((s) => s.isUpdating);
  const mintInfo = useMintInfo(mintUrl);
  const walletContext = useWalletContext();

  const tabs = useMemo(() => computeReceiveTabs(), []);

  useEffect(() => {
    paymentLog.info('receive.tabs.computed', { tabs: tabs.join(','), unit });
  }, [tabs, unit]);

  // If the open tab disappears (setting toggled off / capability change),
  // snap back to Lightning so hidden content stops rendering.
  useEffect(() => {
    if (!(tabs as readonly string[]).includes(selectedTab)) setSelectedTab('Lightning');
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
          <ButtonHandler
            buttons={[
              {
                testID: 'receive-paste',
                text: hasReceiveEntryData && actions.paste.loading ? 'Pasting...' : 'Paste',
                icon: 'lets-icons:copy',
                variant: 'primary',
                onPress: async () => {
                  if (!hasReceiveEntryData) return;
                  await actions.paste.execute();
                },
                loading: hasReceiveEntryData && actions.paste.loading,
                disabled: !hasReceiveEntryData,
                condition: hasReceiveEntryData ? actions.paste.available : true,
              },
              {
                testID: 'receive-fixed-amount',
                text:
                  hasReceiveEntryData && actions.fixedAmount.loading
                    ? 'Opening...'
                    : 'Fixed Amount',
                icon: 'mdi:decimal',
                variant: 'secondary',
                onPress: async () => {
                  if (!hasReceiveEntryData) return;
                  await actions.fixedAmount.execute();
                },
                loading: hasReceiveEntryData && actions.fixedAmount.loading,
                disabled: !hasReceiveEntryData,
                condition: hasReceiveEntryData ? actions.fixedAmount.available : true,
              },
              {
                testID: 'receive-scan-qr',
                text: hasReceiveEntryData && actions.scanQr.loading ? 'Opening...' : 'Scan QR',
                icon: 'stash:qr-code',
                variant: 'secondary',
                onPress: async () => {
                  if (!hasReceiveEntryData) return;
                  await actions.scanQr.execute();
                },
                loading: hasReceiveEntryData && actions.scanQr.loading,
                disabled: !hasReceiveEntryData,
                condition: hasReceiveEntryData ? actions.scanQr.available : true,
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
        renderSkeleton={() => <ReceiveHubPlaceholder />}
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
                  />
                </View>
              </TabPane>
              <TabPane visible={selectedTab === 'Unified'}>
                <ReceiveUnifiedTab
                  unit={unit}
                  walletContext={walletContext}
                  p2pkKey={receiveEntryData.p2pkKey}
                  muted={muted}
                />
              </TabPane>
              <TabPane visible={selectedTab === 'Onchain'}>
                <ReceiveReusableQuoteTab
                  method="onchain"
                  unit={unit}
                  walletContext={walletContext}
                  actions={actions}
                  muted={muted}
                />
              </TabPane>
              <TabPane visible={selectedTab === 'Cashu'}>
                <ReceivePaymentRequestTab
                  unit={unit}
                  walletContext={walletContext}
                  p2pkKey={receiveEntryData.p2pkKey}
                  muted={muted}
                />
              </TabPane>
            </>
          );
        }}
      />
    </ScreenWrapper>
  );
}
