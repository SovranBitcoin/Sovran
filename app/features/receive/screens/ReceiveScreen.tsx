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
import { useMints } from '@cashu/coco-react';

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
import { PillTabs, PILL_TABS_HEIGHT } from '@/shared/ui/composed/PillTabs';
import { computeReceiveTabs } from '@/features/receive/lib/receiveTabs';
import { deriveCreqMintSelection } from '@/features/receive/lib/creqMintSelection';
import type { ReceiveQrPayload } from '@/features/receive/lib/qrPayload';
import {
  MAX_ADVERTISED_MINTS,
  standingQuoteIdentityStore,
} from '@/features/receive/lib/standingQuoteIdentityStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { copyPopup } from '@/shared/lib/popup';
import { E2EToastProbe } from '@/shared/lib/popup/E2EToastProbe';
import { CopyRequestCard } from '@/shared/ui/composed/CopyRequestCard';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { HistoryEntryRefresh } from '@/features/transactions';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { Screen as ScreenWrapper, useScreenOptions } from '@/shared/ui/composed/Screen';
import { ScreenErrorState } from '@/shared/ui/composed/ScreenStates';
import { UnderlineTabs } from '@/shared/ui/composed/UnderlineTabs';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { ReceiveRailPlaceholder } from '@/features/receive/components/ReceiveRailPlaceholder';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { View } from '@/shared/ui/primitives/View/View';
import { useNpcMintStore } from '@/shared/stores/profile/npcMintStore';

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
  muted: string;
}

const ReceiveLightningTab = memo(function ReceiveLightningTab({
  data,
  unit,
  mintInfo,
  selectedMintUrl,
  isNpcMintUpdating,
  actions,
  muted,
}: ReceiveLightningTabProps) {
  // The Address/BOLT 12 switcher lives in the pill sub-tab row above the
  // content (contacts-style), so a unit without an npc address renders
  // nothing here and the user can still switch to the offer rail.
  const npcAddress = unit === 'sat' ? data.npcAddress : undefined;
  if (!npcAddress) return null;

  return (
    <>
      <PaymentInfo data={npcAddress.toString()} copyTarget="address" unit="sat" />
      <CopyRequestCard
        title="RECEIVE ADDRESS"
        icon="mingcute:lightning-fill"
        display={npcAddress.truncate(6)}
        muted={muted}
        onPress={async () => {
          await EnhancedHaptics.copyHaptic();
          await actions.copy.execute({ source: 'npc' });
        }}
      />

      <HistoryEntryRefresh
        mintInfo={mintInfo}
        historyEntry={{
          type: 'receive',
          mintUrl: selectedMintUrl || undefined,
        }}
        testID="receive-npc-mint-row"
        accessibilityLabel="Change receive mint"
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

// The Lightning tab's two rails, as pill sub-tabs (contacts-style: top-level
// UnderlineTabs, pill row beneath).
const LIGHTNING_MODE_PILLS = ['Address', 'BOLT 12'] as const;
type LightningModePill = (typeof LIGHTNING_MODE_PILLS)[number];
const LIGHTNING_MODE_BY_PILL: Record<LightningModePill, 'address' | 'offer'> = {
  Address: 'address',
  'BOLT 12': 'offer',
};
const PILL_BY_LIGHTNING_MODE: Record<'address' | 'offer', LightningModePill> = {
  address: 'Address',
  offer: 'BOLT 12',
};

const styles = StyleSheet.create({
  hiddenPane: {
    display: 'none',
  },
  // Contacts-style header bands: full-bleed rows with hairline separators.
  tabBand: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pillBand: {
    height: PILL_TABS_HEIGHT,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: {
    paddingTop: 16,
  },
});

interface ReceiveScreenProps {
  receiveEntry?: string | Record<string, unknown>;
  unit: string;
}

export function ReceiveScreen({ receiveEntry, unit }: ReceiveScreenProps) {
  useLifecycleLogger('ReceiveScreen');
  const [muted, overlay, separator] = useThemeColor([
    'muted',
    'overlay',
    'separator-secondary',
  ] as const);
  const [selectedTab, setSelectedTab] = useState<string>('Unified');
  const [lightningMode, setLightningMode] = useState<'address' | 'offer'>('address');

  // Same canvas as the send modal (which paints `overlay`); the sheet header
  // scrim must fade from the same color or the header band reads as a seam.
  useScreenOptions(() => ({ headerStyle: { backgroundColor: overlay } }), [overlay]);

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
  //
  // The durable op carries the FULL trusted list (a payment from any trusted
  // mint claims); what the QR ADVERTISES is the selection below — the user's
  // Advanced toggles, forced down to NUT-11-capable mints while the P2PK
  // lock is on, capped at MAX_ADVERTISED_MINTS. The lock itself only applies
  // when a capable mint exists (p2pkLockEffective).
  const creqP2pkLock = useMintStore((s) => s.creqP2pkLock);
  const creqExcludedMints = useMintStore((s) => s.creqExcludedMints);
  const { trustedMints: rawTrustedMints } = useMints();
  const creqMintSelection = useMemo(
    () =>
      deriveCreqMintSelection({
        mints: rawTrustedMints,
        excluded: creqExcludedMints,
        p2pkLockActive: creqP2pkLock && !!receiveEntryData?.p2pkKey,
        maxAdvertised: MAX_ADVERTISED_MINTS,
      }),
    [rawTrustedMints, creqExcludedMints, creqP2pkLock, receiveEntryData?.p2pkKey]
  );
  const creqLockPubkey = creqMintSelection.p2pkLockEffective
    ? receiveEntryData?.p2pkKey
    : undefined;
  const creqMints = walletContext.trustedMintUrls;
  const creq = useStandingPaymentRequest(
    creqMints.length > 0
      ? {
          unit,
          mints: creqMints,
          lockP2pkPubkey: creqLockPubkey,
          displayMints: creqMintSelection.displayMints,
        }
      : null,
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
      bgColor={overlay}
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
      {/* This screen is a sheet: iOS modal AX hides the root-layout probe, so
          toast evidence (mint-updated, payment-status) must be mirrored
          in-sheet for the npc receive scenarios. */}
      <E2EToastProbe />
      {/* Contacts-style header: full-bleed top-level tabs, then (Lightning
          only) the pill sub-tab row — hairline separators on each band. */}
      {tabs.length > 1 && (
        <View style={[styles.tabBand, { borderBottomColor: separator }]}>
          <UnderlineTabs tabs={tabs} selectedTab={selectedTab} handleTabPress={setSelectedTab} />
        </View>
      )}
      {selectedTab === 'Lightning' && (
        <View style={[styles.pillBand, { borderBottomColor: separator }]}>
          <PillTabs
            tabs={LIGHTNING_MODE_PILLS}
            activeTab={PILL_BY_LIGHTNING_MODE[lightningMode]}
            onTabChange={(pill) => setLightningMode(LIGHTNING_MODE_BY_PILL[pill])}
            testIDFor={(pill) =>
              pill === 'Address' ? 'receive-lightning-mode-address' : 'receive-lightning-mode-offer'
            }
          />
        </View>
      )}

      <View style={styles.content}>
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
                  {/* Two Lightning rails behind the pill sub-tabs above — the
                    npub.cash address (human-readable, BIP-353-style) and the
                    reusable BOLT 12 offer. Both sub-views stay mounted so
                    switching never stutters. */}
                  <View style={lightningMode === 'address' ? undefined : styles.hiddenPane}>
                    <ReceiveLightningTab
                      data={receiveEntryData}
                      unit={unit}
                      mintInfo={mintInfo}
                      selectedMintUrl={mintUrl}
                      isNpcMintUpdating={isNpcMintUpdating}
                      actions={actions}
                      muted={muted}
                    />
                  </View>
                  <View style={lightningMode === 'offer' ? undefined : styles.hiddenPane}>
                    <ReceiveReusableQuoteTab
                      method="bolt12"
                      unit={unit}
                      walletContext={walletContext}
                      actions={actions}
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
                    mintSelection={creqMintSelection}
                    onQrPayload={onCashuPayload}
                  />
                </TabPane>
              </>
            );
          }}
        />
      </View>
    </ScreenWrapper>
  );
}
