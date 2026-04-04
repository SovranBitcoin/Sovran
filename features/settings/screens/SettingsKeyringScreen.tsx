import React, { useState, useEffect, useCallback } from 'react';
import {
  Clipboard,
  Alert,
  ActivityIndicator,
  TouchableOpacity as RNTouchableOpacity,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Text } from '@/shared/ui/primitives/Text';
import { Badge } from '@/shared/ui/primitives/Badge';
import Icon from 'assets/icons';
import { useManager } from '@cashu/coco-react';
import {
  keysLoadFailedPopup,
  keyGenerateFailedPopup,
  invalidKeyFormatPopup,
  keyGeneratedPopup,
  keyImportedPopup,
  keyImportFailedPopup,
  copyPopup,
} from '@/shared/lib/popup';
import { truncateMiddle } from '@/shared/lib/strings';
import { Section } from '@/features/settings';
import type { Keypair } from '@cashu/coco-core';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { nip19 } from 'nostr-tools';
import QRCode from 'react-native-qrcode-svg';
import { Tabs } from '@/shared/ui/composed/Tabs';
import opacity from 'hex-color-opacity';
import {
  Button,
  ListGroup,
  PressableFeedback,
  Separator,
  Switch as HeroSwitch,
} from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

/**
 * CurrentKeyItem - Featured display for the active/most recent key
 */
const CurrentKeyItem: React.FC<{
  keypair: Keypair;
  onCopy: (publicKey: string) => void;
}> = ({ keypair, onCopy }) => {
  const [foreground, surface, muted] = useThemeColor(['foreground', 'surface', 'muted'] as const);
  const [selectedTab, setSelectedTab] = useState('P2PK');

  const isDerived = keypair.derivationIndex !== undefined;

  const npubValue = !isDerived
    ? nip19.npubEncode(keypair.publicKeyHex.replace(/^02/, ''))
    : undefined;

  const isNpubTab = selectedTab === 'NPUB' && !isDerived;
  const activeData = isNpubTab ? npubValue! : keypair.publicKeyHex;
  const displayKey = isDerived ? keypair.publicKeyHex : activeData;

  const handleTabPress = useCallback((tab: string) => {
    setSelectedTab(tab);
  }, []);

  const handleShowQR = () => {
    router.navigate({
      pathname: '/share',
      params: {
        type: 'p2pk',
        data: keypair.publicKeyHex,
        ...(npubValue && { npub: npubValue }),
      },
    });
  };

  const handleCopy = useCallback(() => {
    onCopy(activeData);
  }, [activeData, onCopy]);

  return (
    <View className="p-4">
      {!isDerived && (
        <View className="mb-4">
          <Tabs tabs={['P2PK', 'NPUB']} selectedTab={selectedTab} handleTabPress={handleTabPress} />
        </View>
      )}

      <PressableFeedback
        onPress={handleShowQR}
        className="mb-4 self-center overflow-hidden rounded-xl">
        <PressableFeedback.Highlight />
        <View
          style={{
            alignItems: 'center',
            padding: 12,
            backgroundColor: foreground,
            borderRadius: 12,
          }}>
          <QRCode value={activeData} size={120} color={surface} backgroundColor={foreground} />
        </View>
      </PressableFeedback>

      <HStack align="center" spacing={8} className="mb-3.5 flex-wrap gap-y-2">
        <Badge variant="success" icon="solar:key-bold" size={11}>
          ACTIVE
        </Badge>
        {!isDerived && (
          <Badge variant="primary" icon={isNpubTab ? 'ph:user-bold' : 'solar:key-bold'} size={11}>
            {isNpubTab ? 'NPUB' : 'P2PK'}
          </Badge>
        )}
        {isDerived && (
          <Badge variant="primary" icon="mdi:key-arrow-right" size={11}>
            DERIVED {keypair.derivationIndex}
          </Badge>
        )}
      </HStack>

      <View className="bg-surface rounded-xl px-3.5 py-3">
        <Text size={12} className="text-foreground">
          {displayKey}
        </Text>
      </View>

      <HStack spacing={10} className="mt-3.5">
        <Button variant="secondary" className="flex-1" onPress={handleCopy}>
          <Icon name="lets-icons:copy" size={16} color={muted} />
          <Button.Label style={{ color: muted }}>Copy</Button.Label>
        </Button>
        <Button variant="secondary" className="flex-1" onPress={handleShowQR}>
          <Icon name="stash:qr-code" size={16} color={muted} />
          <Button.Label style={{ color: muted }}>Show QR</Button.Label>
        </Button>
      </HStack>
    </View>
  );
};

/**
 * KeyItem - Individual key display component using PressableFeedback
 */
const KeyItem: React.FC<{
  keypair: Keypair;
  onCopy: (publicKey: string) => void;
}> = ({ keypair, onCopy }) => {
  const foreground = useThemeColor('foreground');

  const isDerived = keypair.derivationIndex !== undefined;

  const displayKey = !isDerived
    ? nip19.npubEncode(keypair.publicKeyHex.replace(/^02/, ''))
    : keypair.publicKeyHex;

  const handleShowQR = () => {
    const npubValue = !isDerived
      ? nip19.npubEncode(keypair.publicKeyHex.replace(/^02/, ''))
      : undefined;

    router.navigate({
      pathname: '/share',
      params: {
        type: 'p2pk',
        data: keypair.publicKeyHex,
        ...(npubValue && { npub: npubValue }),
      },
    });
  };

  return (
    <PressableFeedback onPress={() => onCopy(keypair.publicKeyHex)}>
      <PressableFeedback.Highlight />
      <View className="flex-row items-center gap-3 p-4">
        <View className="bg-default items-center justify-center rounded-lg p-2">
          <Icon
            name={isDerived ? 'mdi:key-arrow-right' : 'ph:user-bold'}
            size={16}
            color={opacity(foreground, 0.5)}
          />
        </View>
        <ListGroup.ItemContent>
          <Text size={11} style={{ color: foreground }}>
            {truncateMiddle(displayKey, 7)}
          </Text>
          <Text size={10} className="mt-0.5" style={{ color: opacity(foreground, 0.4) }}>
            {isDerived ? `Derived Key ${keypair.derivationIndex}` : 'Imported'}
          </Text>
        </ListGroup.ItemContent>
        <HStack spacing={4}>
          <Button variant="ghost" size="sm" isIconOnly onPress={() => onCopy(keypair.publicKeyHex)}>
            <Icon name="lets-icons:copy" size={16} />
          </Button>
          <Button variant="ghost" size="sm" isIconOnly onPress={handleShowQR}>
            <Icon name="stash:qr-code" size={16} />
          </Button>
        </HStack>
      </View>
    </PressableFeedback>
  );
};

/**
 * KeyringSettings - P2PK key management page
 */
export const SettingsKeyringScreen: React.FC = () => {
  const [foreground, defaultColor] = useThemeColor(['foreground', 'default'] as const);
  const manager = useManager();

  const [keypairs, setKeypairs] = useState<Keypair[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  // Quick access setting from settings store
  const quickAccessP2PK = useSettingsStore((state) => state.quickAccessP2PK);
  const setQuickAccessP2PK = useSettingsStore((state) => state.setQuickAccessP2PK);
  const regenerateP2PKOnReceive = useSettingsStore((state) => state.regenerateP2PKOnReceive);
  const setRegenerateP2PKOnReceive = useSettingsStore((state) => state.setRegenerateP2PKOnReceive);

  /**
   * Loads all keypairs from the keyring
   */
  const loadKeypairs = useCallback(async () => {
    if (!manager) return;

    try {
      setIsLoading(true);
      const allKeys = await manager.keyring.getAllKeyPairs();
      setKeypairs(allKeys);
    } catch (error) {
      console.error('Failed to load keypairs:', error);
      keysLoadFailedPopup();
    } finally {
      setIsLoading(false);
    }
  }, [manager]);

  useEffect(() => {
    loadKeypairs();
  }, [loadKeypairs]);

  /**
   * Generates a new keypair
   */
  const handleGenerateKey = async () => {
    if (!manager) return;

    try {
      setIsGenerating(true);
      await manager.keyring.generateKeyPair();
      keyGeneratedPopup();
      await loadKeypairs();
    } catch (error) {
      console.error('Failed to generate keypair:', error);
      keyGenerateFailedPopup();
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * Helper to convert hex string to bytes
   */
  const hexToBytes = (hex: string): Uint8Array | null => {
    if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
      return null;
    }
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  };

  /**
   * Try to import a key with multiple strategies without manipulating the input
   */
  const tryImportKey = async (input: string): Promise<boolean> => {
    if (!manager) return false;

    // Strategy 1: Try as nsec
    if (input.startsWith('nsec1')) {
      try {
        const decoded = nip19.decode(input);
        if (decoded.type === 'nsec') {
          await manager.keyring.addKeyPair(decoded.data as Uint8Array);
          return true;
        }
      } catch {}
    }

    // Strategy 2: Try as raw 64-char hex
    const rawBytes = hexToBytes(input);
    if (rawBytes) {
      try {
        await manager.keyring.addKeyPair(rawBytes);
        return true;
      } catch {}
    }

    return false;
  };

  /**
   * Imports an existing private key (nsec or hex format)
   */
  const handleImportNsec = () => {
    Alert.prompt(
      'Import Private Key',
      'Enter your nsec or hex private key',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: async (value: string | undefined) => {
            if (!value || !manager) return;

            try {
              const trimmedValue = value.trim();
              const success = await tryImportKey(trimmedValue);

              if (success) {
                keyImportedPopup();
                await loadKeypairs();
              } else {
                invalidKeyFormatPopup();
              }
            } catch (error) {
              console.error('Failed to import key:', error);
              keyImportFailedPopup();
            }
          },
        },
      ],
      'secure-text'
    );
  };

  /**
   * Copies a public key to clipboard
   */
  const handleCopyKey = (publicKey: string) => {
    Clipboard.setString(publicKey);
    copyPopup('publicKey');
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'P2PK Keys',
          headerRight: () => (
            <HStack spacing={4}>
              <RNTouchableOpacity
                onPress={handleImportNsec}
                style={{ padding: 8 }}
                disabled={isGenerating}>
                <Icon name="mdi:key-arrow-right" size={22} color={foreground} />
              </RNTouchableOpacity>
              <RNTouchableOpacity
                onPress={handleGenerateKey}
                style={{ padding: 8 }}
                disabled={isGenerating}>
                {isGenerating ? (
                  <ActivityIndicator size="small" color={foreground} />
                ) : (
                  <Icon name="mdi:key-plus" size={22} color={foreground} />
                )}
              </RNTouchableOpacity>
            </HStack>
          ),
        }}
      />
      <ModalLayoutWrapper>
        {/* Quick Access Toggle */}
        <Section title="Preferences">
          <ListGroup variant="secondary">
            <ListGroup.Item>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Quick Access to Lock</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  Show your latest P2PK locking key in the receive ecash menu
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>
                <HeroSwitch
                  isSelected={quickAccessP2PK ?? false}
                  onSelectedChange={setQuickAccessP2PK}
                />
              </ListGroup.ItemSuffix>
            </ListGroup.Item>
            <Separator className="mx-4" />
            <ListGroup.Item>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Regenerate Key on Receive</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  Automatically generate a new P2PK key after redeeming a locked token for improved
                  privacy
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>
                <HeroSwitch
                  isSelected={regenerateP2PKOnReceive ?? true}
                  onSelectedChange={setRegenerateP2PKOnReceive}
                />
              </ListGroup.ItemSuffix>
            </ListGroup.Item>
          </ListGroup>
        </Section>

        {/* Keys List */}
        <Section title={`Your Keys (${keypairs.length})`}>
          <ListGroup variant="secondary">
            {isLoading ? (
              <VStack align="center" className="p-6">
                <ActivityIndicator size="small" color={opacity(foreground, 0.4)} />
                <Text size={14} className="mt-2" style={{ color: opacity(foreground, 0.4) }}>
                  Loading keys...
                </Text>
              </VStack>
            ) : keypairs.length === 0 ? (
              <VStack align="center" className="p-6">
                <Icon name="mdi:key-variant" size={40} color={defaultColor} />
                <Text
                  size={14}
                  className="mt-3 text-center"
                  style={{ color: opacity(foreground, 0.4) }}>
                  Generate or import a key to get started with P2PK-locked ecash
                </Text>
              </VStack>
            ) : (
              [...keypairs].reverse().map((keypair, index) => (
                <React.Fragment key={keypair.publicKeyHex}>
                  {index > 0 && <Separator className="mx-4" />}
                  {index === 0 ? (
                    <CurrentKeyItem keypair={keypair} onCopy={handleCopyKey} />
                  ) : (
                    <KeyItem keypair={keypair} onCopy={handleCopyKey} />
                  )}
                </React.Fragment>
              ))
            )}
          </ListGroup>
        </Section>

        <Spacer size={32} />
      </ModalLayoutWrapper>
    </>
  );
};
