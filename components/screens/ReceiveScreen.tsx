/**
 * @fileoverview Shared Receive screen component
 *
 * This module provides the core UI and logic for receiving ecash/Lightning.
 * It is used by both standalone and flow-based route wrappers.
 */

import React, { useCallback, useState, useEffect, useRef } from 'react';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { useCameraPermissions } from 'expo-camera';
import { popup } from '@/helper/popup';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { decode, isEncoded } from 'helper/third-party/emoji';
import { HistoryEntryRefresh } from 'components/blocks/Transaction/HistoryEntryRefresh';
import { View } from 'components/ui/View/View';
import { Section } from 'app/settings-pages';
import Icon from 'assets/icons';
import { getDecodedToken, type ReceiveHistoryEntry, type Keypair } from 'coco-cashu-core';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import opacity from 'hex-color-opacity';
import { truncateMiddle } from 'helper/strings';
import { Proof } from '@cashu/cashu-ts';
import { isValidEcashToken } from '@/helper/coco/utils';
import { EnhancedHaptics } from 'components/ui/Haptics';
import { useScanHistoryStore } from 'stores/scanHistoryStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { Tabs } from 'components/ui/Tabs';
import { useSettingsStore } from 'stores/settingsStore';
import { useManager } from 'coco-cashu-react';
import { ModalScreenLayout } from 'components/layouts/ModalScreenLayout';
import { useMintManagement } from '@/hooks/coco/useMintManagement';
import { useMintStore } from 'stores/mintStore';
import { useNpcMintStore } from 'stores/npcMintStore';
import { ListGroup, PressableFeedback } from 'heroui-native';

interface ReceiveScreenProps {
  unit: string;
  onReceiveToken: (receiveHistoryEntry: ReceiveHistoryEntry) => void;
  onCamera: (unit: string) => void;
  onFixedAmount: (unit: string) => void;
}

export function ReceiveScreen({
  unit,
  onReceiveToken,
  onCamera,
  onFixedAmount,
}: ReceiveScreenProps) {
  const { getPrimaryColor } = useTheme();
  const [hasPermission, requestPermission] = useCameraPermissions();
  const { getMintInfo } = useMintManagement();
  const { keys: nostrKeys } = useNostrKeysContext();
  const manager = useManager();

  const [mintInfo, setMintInfo] = useState<any>(null);
  const [selectedTab, setSelectedTab] = useState('Lightning');
  const [latestKeypair, setLatestKeypair] = useState<Keypair | null>(null);

  // NPC mint store — persisted offline-first source of truth
  const npcMintUrl = useNpcMintStore((s) =>
    nostrKeys?.pubkey ? s.getMintUrl(nostrKeys.pubkey) : undefined
  );
  const isUpdatingMint = useNpcMintStore((s) => s.isUpdating);
  const syncFromServer = useNpcMintStore((s) => s.syncFromServer);
  const updateServerMint = useNpcMintStore((s) => s.updateServerMint);

  // Track whether user opened the mint selector (to avoid auto-syncing on mount)
  const hasOpenedMintSelector = useRef(false);
  const previousSelectedMintRef = useRef<string | undefined>(undefined);

  // Watch selected mint from store for detecting changes after mint selector
  const selectedMint = useMintStore((state) =>
    nostrKeys?.pubkey ? state.selectedMints[nostrKeys.pubkey] : undefined
  );

  // Check if P2PK quick access is enabled
  const quickAccessP2PK = useSettingsStore((state) => state.quickAccessP2PK);

  // Build tabs array based on settings
  const tabs = quickAccessP2PK ? ['Lightning', 'P2PK'] : ['Lightning'];

  // Sync NPC mint URL from server on mount (cached value renders instantly)
  useEffect(() => {
    if (!nostrKeys?.pubkey || !manager) return;
    syncFromServer(nostrKeys.pubkey, manager);
  }, [manager, nostrKeys?.pubkey, syncFromServer]);

  // Load cashu mint info whenever the NPC mint URL changes
  useEffect(() => {
    if (!npcMintUrl) return;
    let cancelled = false;
    getMintInfo(npcMintUrl)
      .then((info) => {
        if (!cancelled) setMintInfo(info);
      })
      .catch((err) => console.error('ReceiveScreen: Failed to load mint info:', err));
    return () => {
      cancelled = true;
    };
  }, [npcMintUrl, getMintInfo]);

  // Load latest keypair when P2PK tab is available
  useEffect(() => {
    const loadLatestKeypair = async () => {
      if (!manager || !quickAccessP2PK) return;
      try {
        const latest = await manager.keyring.getLatestKeyPair();
        setLatestKeypair(latest);
      } catch (error) {
        console.error('Failed to load latest keypair:', error);
      }
    };
    loadLatestKeypair();
  }, [manager, quickAccessP2PK]);

  const handleTabPress = useCallback((tab: string) => {
    setSelectedTab(tab);
  }, []);

  const handleEcashToken = ({ token }: { token: string }): void => {
    const decodedToken = getDecodedToken(token);
    const receiveHistoryEntry: ReceiveHistoryEntry = {
      id: `receive-${Date.now()}`,
      type: 'receive',
      amount: decodedToken.proofs.reduce((sum: number, proof: Proof) => sum + proof.amount, 0),
      unit: unit,
      mintUrl: decodedToken.mint,
      createdAt: Date.now(),
      metadata: { rawToken: token },
      token: decodedToken,
    };

    onReceiveToken(receiveHistoryEntry);
  };

  const handleEcashPaste = async (): Promise<void> => {
    const text = await Clipboard.getStringAsync();

    let decodedText;
    if (isEncoded(text)) {
      decodedText = decode(text);
    } else {
      decodedText = text;
    }

    if (!decodedText) {
      popup({ message: 'no_clipboard_address', emoji: '🚨', type: 'error' });
      return;
    }

    if (!isValidEcashToken(decodedText)) {
      popup({
        message: 'invalid_address',
        params: { address: decodedText },
        emoji: '🚨',
        type: 'error',
      });
      return;
    }

    // Log paste to scan history
    useScanHistoryStore.getState().addScan(text, decodedText, 'ecash', 'paste');

    handleEcashToken({ token: decodedText });
  };

  const handleScanQR = async (): Promise<void> => {
    if (!hasPermission?.granted) {
      await requestPermission();
      return;
    }

    onCamera(unit);
  };

  const handleFixedAmount = async (): Promise<void> => {
    onFixedAmount(unit);
  };

  const handleCopyLightningAddress = useCallback(async () => {
    await EnhancedHaptics.copyHaptic();
    await Clipboard.setStringAsync(`${nostrKeys?.npub}@npubx.cash`);
    popup({ message: 'lightning_address_copied', type: 'success' });
  }, [nostrKeys?.npub]);

  // Watch for mint selection changes after returning from the mint selector
  useEffect(() => {
    if (!hasOpenedMintSelector.current) return;
    if (!selectedMint || selectedMint === npcMintUrl) return;
    if (selectedMint === previousSelectedMintRef.current) return;
    if (!nostrKeys?.pubkey || !nostrKeys?.privateKey) return;

    previousSelectedMintRef.current = selectedMint;
    hasOpenedMintSelector.current = false;

    updateServerMint(nostrKeys.pubkey, selectedMint, nostrKeys.privateKey).then((ok) => {
      if (ok) {
        popup({ message: 'Receive mint updated', type: 'success' });
      } else {
        popup({ message: 'Failed to update receive mint', emoji: '🚨', type: 'error' });
      }
    });
  }, [selectedMint, npcMintUrl, nostrKeys?.pubkey, nostrKeys?.privateKey, updateServerMint]);

  // Open the mint selector modal so the user can pick a different receive mint
  const handleOpenMintSelector = useCallback(async () => {
    await EnhancedHaptics.copyHaptic();
    hasOpenedMintSelector.current = true;
    previousSelectedMintRef.current = selectedMint;
    router.navigate({
      pathname: '/list',
      params: {
        onSelectAction: 'goBack',
        showAddMintsButton: 'true',
        showDetailsButton: 'true',
      },
    });
  }, [selectedMint]);

  const showLightningAddress = Boolean(nostrKeys?.npub && unit === 'sat');

  const handleCopyP2PKKey = useCallback(async () => {
    if (!latestKeypair) return;
    await EnhancedHaptics.copyHaptic();
    await Clipboard.setStringAsync(latestKeypair.publicKeyHex);
    popup({ message: 'p2pk_copied', type: 'success' });
  }, [latestKeypair]);

  // Render Lightning content
  const renderLightningContent = () => (
    <>
      {showLightningAddress && (
        <PaymentInfo
          data={`${nostrKeys?.npub}@npubx.cash`}
          popupMessage="lightning_address_copied"
          unit="sat"
        />
      )}
      {showLightningAddress && (
        <View style={{ marginHorizontal: 16 }}>
          <Section title="RECEIVE ADDRESS">
            <ListGroup variant="secondary">
              <PressableFeedback animation={false} onPress={handleCopyLightningAddress}>
                <PressableFeedback.Scale>
                  <ListGroup.Item disabled>
                    <ListGroup.ItemPrefix>
                      <Icon
                        name="mingcute:lightning-fill"
                        size={20}
                        color={opacity(getPrimaryColor('0'), 0.4)}
                      />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>
                        {`${truncateMiddle(nostrKeys?.npub || '', 7)}@npubx.cash`}
                      </ListGroup.ItemTitle>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      <Icon
                        name="lets-icons:copy"
                        size={20}
                        color={opacity(getPrimaryColor('0'), 0.4)}
                      />
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>
                </PressableFeedback.Scale>
                <PressableFeedback.Ripple />
              </PressableFeedback>
            </ListGroup>
          </Section>
        </View>
      )}

      {showLightningAddress && (
        <HistoryEntryRefresh
          mintInfo={mintInfo}
          historyEntry={{
            type: 'receive',
            mintUrl: npcMintUrl || undefined,
          }}
          onPress={isUpdatingMint ? undefined : handleOpenMintSelector}
        />
      )}
    </>
  );

  // Render P2PK content
  const renderP2PKContent = () => (
    <>
      {latestKeypair ? (
        <>
          <PaymentInfo data={latestKeypair.publicKeyHex} popupMessage="p2pk_copied" unit="p2pk" />
          <View style={{ marginHorizontal: 16 }}>
            <Section title="P2PK PUBLIC KEY">
              <ListGroup variant="secondary">
                <PressableFeedback animation={false} onPress={handleCopyP2PKKey}>
                  <PressableFeedback.Scale>
                    <ListGroup.Item disabled>
                      <ListGroup.ItemPrefix>
                        <Icon
                          name="solar:key-bold"
                          size={20}
                          color={opacity(getPrimaryColor('0'), 0.4)}
                        />
                      </ListGroup.ItemPrefix>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>
                          {truncateMiddle(latestKeypair.publicKeyHex, 10)}
                        </ListGroup.ItemTitle>
                      </ListGroup.ItemContent>
                      <ListGroup.ItemSuffix>
                        <Icon
                          name="lets-icons:copy"
                          size={20}
                          color={opacity(getPrimaryColor('0'), 0.4)}
                        />
                      </ListGroup.ItemSuffix>
                    </ListGroup.Item>
                  </PressableFeedback.Scale>
                  <PressableFeedback.Ripple />
                </PressableFeedback>
              </ListGroup>
            </Section>
          </View>
        </>
      ) : (
        <View style={{ marginHorizontal: 16, marginTop: 32 }}>
          <View
            style={{
              backgroundColor: getPrimaryColor('800'),
              borderRadius: 12,
              padding: 24,
              alignItems: 'center',
            }}>
            <Icon name="mdi:key-variant" size={48} color={opacity(getPrimaryColor('0'), 0.25)} />
            <Text
              size={14}
              style={{
                color: opacity(getPrimaryColor('0'), 0.4),
                marginTop: 12,
                textAlign: 'center',
              }}>
              No P2PK keys yet. Generate one in Settings → P2PK Keys.
            </Text>
          </View>
        </View>
      )}
    </>
  );

  return (
    <ModalScreenLayout
      bottomButtons={
        <ButtonHandler
          buttons={[
            {
              text: 'Paste',
              icon: 'lets-icons:copy',
              variant: 'primary',
              onPress: handleEcashPaste,
            },
            {
              text: 'Fixed Amount',
              icon: 'mdi:decimal',
              variant: 'secondary',
              onPress: handleFixedAmount,
            },
            {
              text: 'Scan QR',
              icon: 'stash:qr-code',
              variant: 'secondary',
              onPress: handleScanQR,
            },
          ]}
        />
      }>
      {/* Tab bar - only show if P2PK quick access is enabled */}
      {quickAccessP2PK && (
        <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
          <Tabs tabs={tabs} selectedTab={selectedTab} handleTabPress={handleTabPress} />
        </View>
      )}

      {/* Content based on selected tab */}
      {selectedTab === 'Lightning' ? renderLightningContent() : renderP2PKContent()}
    </ModalScreenLayout>
  );
}

export function getFormattedReceiveTitle(unit: string): string {
  return `Receive ${unit === 'sat' ? 'Bitcoin' : (unit || 'SAT').toUpperCase()}`;
}
