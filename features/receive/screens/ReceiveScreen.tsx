/**
 * @fileoverview Shared Receive screen component
 *
 * Receive hub UI — entry, copy, and hub actions come from `useScreenActions`;
 * paste / fixed amount / scan / NPC mint change run through colada handlers
 * with the payment machine from ColadaProvider (wallet context binds in
 * usePaymentFlowMachine after entry is available).
 */

import React, { memo, useEffect, useState } from 'react';

import type { GetInfoResponse } from '@cashu/cashu-ts';
import { ListGroup, PressableFeedback } from 'heroui-native';

import { useScreenActions, type UseScreenActionsResult } from 'colada/react';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';

import type { FormattedString } from 'colada';
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
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { UnderlineTabs } from '@/shared/ui/composed/UnderlineTabs';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
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
  const npcAddress = unit === 'sat' ? data.npcAddress : undefined;
  if (!npcAddress) return null;

  return (
    <>
      <PaymentInfo data={npcAddress.toString()} copyTarget="address" unit="sat" />
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

interface ReceiveP2pkTabProps {
  data: ReceiveHubEntry;
  actions: UseScreenActionsResult<'receive'>['actions'];
  muted: string;
}

const ReceiveP2pkTab = memo(function ReceiveP2pkTab({ data, actions, muted }: ReceiveP2pkTabProps) {
  if (!data.p2pkKey) {
    return (
      <View className="mx-4 mt-8">
        <View className="bg-surface-secondary items-center rounded-xl p-6">
          <Icon name="mdi:key-variant" size={48} color={muted} />
          <Text size={14} className="text-muted mt-3 text-center">
            No P2PK keys yet. Generate one in Settings → P2PK Keys.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <PaymentInfo data={data.p2pkKey} copyTarget="p2pk" unit="p2pk" />
      <View className="mx-4">
        <Section title="P2PK PUBLIC KEY">
          <GradientCard>
            <ListGroup variant="transparent">
              <PressableFeedback
                animation={false}
                onPress={async () => {
                  await EnhancedHaptics.copyHaptic();
                  await actions.copy.execute({ source: 'p2pk' });
                }}>
                <PressableFeedback.Scale>
                  <ListGroup.Item disabled>
                    <ListGroup.ItemPrefix>
                      <Icon name="solar:key-bold" size={20} color={muted} />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>{truncateMiddle(data.p2pkKey, 10)}</ListGroup.ItemTitle>
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
    </>
  );
});

interface ReceiveScreenProps {
  receiveEntry?: string | Record<string, unknown>;
  unit: string;
}

export function ReceiveScreen({ receiveEntry, unit }: ReceiveScreenProps) {
  useLifecycleLogger('ReceiveScreen');
  const muted = useThemeColor('muted');
  const [selectedTab, setSelectedTab] = useState('Lightning');

  const { entry, error, actions, mintUrl } = useScreenActions(
    'receive',
    receiveEntry as string | Record<string, unknown> | undefined
  );

  const receiveEntryData = entry as ReceiveHubEntry | null;

  const quickAccessP2PK = useSettingsStore((state) => state.quickAccessP2PK);
  const tabs = quickAccessP2PK ? ['Lightning', 'P2PK'] : ['Lightning'];
  const isNpcMintUpdating = useNpcMintStore((s) => s.isUpdating);
  const mintInfo = useMintInfo(mintUrl);

  // The P2PK tab is gated behind the quickAccessP2PK setting. If the user
  // had it open and then toggled the setting off elsewhere, snap back to
  // Lightning so the now-hidden P2PK content stops rendering.
  useEffect(() => {
    if (!quickAccessP2PK && selectedTab !== 'Lightning') setSelectedTab('Lightning');
  }, [quickAccessP2PK, selectedTab]);

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

  if (!receiveEntryData) {
    return <ScreenLoadingState message="Loading..." />;
  }

  return (
    <ScreenWrapper
      name="ReceiveScreen"
      contentPadding={0}
      footer={
        <BottomButtons>
          <ButtonHandler
            buttons={[
              {
                testID: 'receive-paste',
                text: actions.paste.loading ? 'Pasting...' : 'Paste',
                icon: 'lets-icons:copy',
                variant: 'primary',
                onPress: async () => {
                  await actions.paste.execute();
                },
                loading: actions.paste.loading,
                condition: actions.paste.available,
              },
              {
                testID: 'receive-fixed-amount',
                text: actions.fixedAmount.loading ? 'Opening...' : 'Fixed Amount',
                icon: 'mdi:decimal',
                variant: 'secondary',
                onPress: async () => {
                  await actions.fixedAmount.execute();
                },
                loading: actions.fixedAmount.loading,
                condition: actions.fixedAmount.available,
              },
              {
                testID: 'receive-scan-qr',
                text: actions.scanQr.loading ? 'Opening...' : 'Scan QR',
                icon: 'stash:qr-code',
                variant: 'secondary',
                onPress: async () => {
                  await actions.scanQr.execute();
                },
                loading: actions.scanQr.loading,
                condition: actions.scanQr.available,
              },
            ]}
          />
        </BottomButtons>
      }>
      {quickAccessP2PK && (
        <View className="mx-4 mb-4">
          <UnderlineTabs tabs={tabs} selectedTab={selectedTab} handleTabPress={setSelectedTab} />
        </View>
      )}

      {quickAccessP2PK && selectedTab === 'P2PK' ? (
        <ReceiveP2pkTab data={receiveEntryData} actions={actions} muted={muted} />
      ) : (
        <ReceiveLightningTab
          data={receiveEntryData}
          unit={unit}
          mintInfo={mintInfo}
          selectedMintUrl={mintUrl}
          isNpcMintUpdating={isNpcMintUpdating}
          actions={actions}
          muted={muted}
        />
      )}
    </ScreenWrapper>
  );
}
