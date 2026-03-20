/**
 * @fileoverview Shared Receive screen component
 *
 * Receive hub UI — entry, copy, and hub actions come from `useScreenActions`;
 * paste / fixed amount / scan / NPC mint change run through coco-payment-ux handlers
 * with the payment machine from CocoPaymentUXProvider (wallet context binds in
 * usePaymentFlowMachine after entry is available).
 */

import React, { useState } from 'react';

import type { GetInfoResponse } from '@cashu/cashu-ts';
import { router } from 'expo-router';

import { ListGroup, PressableFeedback } from 'heroui-native';

import { useScreenActions, type UseScreenActionsResult } from 'coco-payment-ux/react';

import type { FormattedString } from 'coco-payment-ux';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { Section } from '@/features/settings';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { HistoryEntryRefresh } from '@/features/transactions';
import { truncateMiddle } from '@/shared/lib/strings';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useWalletContextWithOverride } from '@/shared/providers/WalletContextProvider';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { ModalScreenLayout } from '@/shared/ui/composed/ModalScreenLayout';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { Tabs } from '@/shared/ui/composed/Tabs';
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

function ReceiveLightningTab({
  data,
  unit,
  mintInfo,
  selectedMintUrl,
  isNpcMintUpdating,
  actions,
  muted,
}: ReceiveLightningTabProps) {
  const showLightningAddress = Boolean(data.npcAddress && unit === 'sat');

  return (
    <>
      {showLightningAddress && (
        <PaymentInfo data={data.npcAddress!.toString()} copyTarget="lightningAddress" unit="sat" />
      )}
      {showLightningAddress && (
        <View className="mx-4">
          <Section title="RECEIVE ADDRESS">
            <ListGroup variant="secondary">
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
                      <ListGroup.ItemTitle>
                        {data.npcAddress?.truncate(6) ?? ''}
                      </ListGroup.ItemTitle>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      <Icon name="lets-icons:copy" size={20} color={muted} />
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>
                </PressableFeedback.Scale>
                <PressableFeedback.Ripple />
              </PressableFeedback>
            </ListGroup>
          </Section>
        </View>
      )}

      {showLightningAddress && mintInfo && (
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
      )}
    </>
  );
}

interface ReceiveP2pkTabProps {
  data: ReceiveHubEntry;
  actions: UseScreenActionsResult<'receive'>['actions'];
  muted: string;
}

function ReceiveP2pkTab({ data, actions, muted }: ReceiveP2pkTabProps) {
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
          <ListGroup variant="secondary">
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
        </Section>
      </View>
    </>
  );
}

interface ReceiveScreenProps {
  receiveEntry?: string | Record<string, unknown>;
  unit: string;
}

export function ReceiveScreen({ receiveEntry, unit }: ReceiveScreenProps) {
  const muted = useThemeColor('muted');
  const [selectedTab, setSelectedTab] = useState('Lightning');

  const { entry, error, actions } = useScreenActions(
    'receive',
    receiveEntry as string | Record<string, unknown> | undefined
  );

  const receiveEntryData = entry as ReceiveHubEntry | null;
  const selectedMintUrl = receiveEntryData?.selectedMintUrl;
  const walletContext = useWalletContextWithOverride(selectedMintUrl);
  usePaymentFlowMachine({ walletContext, unit });

  const quickAccessP2PK = useSettingsStore((state) => state.quickAccessP2PK);
  const tabs = quickAccessP2PK ? ['Lightning', 'P2PK'] : ['Lightning'];
  const isNpcMintUpdating = useNpcMintStore((s) => s.isUpdating);
  const mintInfo = useMintInfo(selectedMintUrl);

  if (error) {
    return <ScreenErrorState message={error} onGoBack={() => router.back()} />;
  }

  if (!receiveEntryData) {
    return <ScreenLoadingState message="Loading..." />;
  }

  return (
    <ModalScreenLayout
      bottomButtons={
        <ButtonHandler
          buttons={[
            {
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
      }>
      {quickAccessP2PK && (
        <View className="mx-4 mb-4">
          <Tabs
            tabs={tabs}
            selectedTab={selectedTab}
            handleTabPress={(tab) => setSelectedTab(tab)}
          />
        </View>
      )}

      {selectedTab === 'Lightning' ? (
        <ReceiveLightningTab
          data={receiveEntryData}
          unit={unit}
          mintInfo={mintInfo}
          selectedMintUrl={selectedMintUrl}
          isNpcMintUpdating={isNpcMintUpdating}
          actions={actions}
          muted={muted}
        />
      ) : (
        <ReceiveP2pkTab data={receiveEntryData} actions={actions} muted={muted} />
      )}
    </ModalScreenLayout>
  );
}
