import React, { useState, useEffect, useCallback } from 'react';
import {
  Switch,
  Clipboard,
  Alert,
  ActivityIndicator,
  TouchableOpacity as RNTouchableOpacity,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Badge } from 'components/ui/Badge';
import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';
import { useManager } from 'coco-cashu-react';
import { popup } from '@/helper/popup';
import { truncateMiddle } from 'helper/strings';
import { Section } from './index';
import type { Keypair } from 'coco-cashu-core';
import { useSettingsStore } from 'stores/settingsStore';
import { ModalLayoutWrapper } from 'app/debugModal';
import { nip19 } from 'nostr-tools';
import QRCode from 'react-native-qrcode-svg';
import { Tabs } from 'components/ui/Tabs';
import opacity from 'hex-color-opacity';

/**
 * CurrentKeyItem - Featured display for the active/most recent key
 */
const CurrentKeyItem: React.FC<{
  keypair: Keypair;
  onCopy: (publicKey: string) => void;
}> = ({ keypair, onCopy }) => {
  const { getPrimaryColor } = useTheme();
  const [selectedTab, setSelectedTab] = useState('P2PK');

  const isDerived = keypair.derivationIndex !== undefined;

  // Get the npub value for non-derived keys
  const npubValue = !isDerived
    ? nip19.npubEncode(keypair.publicKeyHex.replace(/^02/, ''))
    : undefined;

  // Determine which data to show based on selected tab
  const isNpubTab = selectedTab === 'NPUB' && !isDerived;
  const activeData = isNpubTab ? npubValue! : keypair.publicKeyHex;

  // Display key based on tab selection (for derived keys, always show hex)
  const displayKey = isDerived ? keypair.publicKeyHex : activeData;

  const handleTabPress = useCallback((tab: string) => {
    setSelectedTab(tab);
  }, []);

  const handleShowQR = () => {
    router.push({
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
    <View
      style={{
        backgroundColor: getPrimaryColor('900'),
        borderRadius: 16,
        marginBottom: 16,
        overflow: 'hidden',
      }}>
      {/* Elevated key card */}
      <View
        style={{
          backgroundColor: getPrimaryColor('700'),
          borderRadius: 14,
          padding: 16,
        }}>
        {/* Tabs for npub keys */}
        {!isDerived && (
          <View style={{ marginBottom: 16 }}>
            <Tabs
              tabs={['P2PK', 'NPUB']}
              selectedTab={selectedTab}
              handleTabPress={handleTabPress}
            />
          </View>
        )}

        {/* QR Code Preview */}
        <TouchableOpacity onPress={handleShowQR}>
          <View
            style={{
              alignItems: 'center',
              marginBottom: 16,
              padding: 12,
              backgroundColor: getPrimaryColor('0'),
              borderRadius: 12,
              alignSelf: 'center',
            }}>
            <QRCode
              value={activeData}
              size={120}
              color={getPrimaryColor('900')}
              backgroundColor={getPrimaryColor('0')}
            />
          </View>
        </TouchableOpacity>

        {/* Badge row */}
        <HStack
          align="center"
          spacing={8}
          style={{ marginBottom: 14, flexWrap: 'wrap', rowGap: 8 }}>
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

        {/* Key content */}
        <HStack align="center">
          {/* Public key display */}
          <View
            style={{
              flex: 1,
              backgroundColor: getPrimaryColor('800'),
              borderRadius: 10,
              paddingVertical: 12,
              paddingHorizontal: 14,
            }}>
            <Text
              mono
              size={12}
              style={{
                color: getPrimaryColor('0'),
                flexShrink: 0,
              }}>
              {displayKey}
            </Text>
          </View>
        </HStack>

        {/* Action buttons */}
        <HStack spacing={10} style={{ marginTop: 14 }}>
          <TouchableOpacity onPress={handleCopy} style={{ flex: 1 }}>
            <View
              style={{
                backgroundColor: getPrimaryColor('600'),
                paddingVertical: 12,
                borderRadius: 10,
                alignItems: 'center',
              }}>
              <HStack align="center" spacing={8}>
                <Icon name="lets-icons:copy" size={16} color={opacity(getPrimaryColor('0'), 0.8)} />
                <Text size={13} weight="500" style={{ color: opacity(getPrimaryColor('0'), 0.8) }}>
                  Copy
                </Text>
              </HStack>
            </View>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleShowQR} style={{ flex: 1 }}>
            <View
              style={{
                backgroundColor: getPrimaryColor('600'),
                paddingVertical: 12,
                borderRadius: 10,
                alignItems: 'center',
              }}>
              <HStack align="center" spacing={8}>
                <Icon name="stash:qr-code" size={16} color={opacity(getPrimaryColor('0'), 0.8)} />
                <Text size={13} weight="500" style={{ color: opacity(getPrimaryColor('0'), 0.8) }}>
                  Show QR
                </Text>
              </HStack>
            </View>
          </TouchableOpacity>
        </HStack>
      </View>
    </View>
  );
};

/**
 * KeyItem - Individual key display component
 */
const KeyItem: React.FC<{
  keypair: Keypair;
  onCopy: (publicKey: string) => void;
}> = ({ keypair, onCopy }) => {
  const { getPrimaryColor } = useTheme();

  const isDerived = keypair.derivationIndex !== undefined;

  // Convert to npub if derived key, otherwise show raw hex
  const displayKey = !isDerived
    ? nip19.npubEncode(keypair.publicKeyHex.replace(/^02/, ''))
    : keypair.publicKeyHex;

  const handleShowQR = () => {
    // For non-derived (imported) keys, pass npub to enable tab switching
    const npubValue = !isDerived
      ? nip19.npubEncode(keypair.publicKeyHex.replace(/^02/, ''))
      : undefined;

    router.push({
      pathname: '/share',
      params: {
        type: 'p2pk',
        data: keypair.publicKeyHex,
        ...(npubValue && { npub: npubValue }),
      },
    });
  };

  return (
    <HStack
      align="center"
      style={{
        backgroundColor: getPrimaryColor('700'),
        borderRadius: 12,
        marginBottom: 8,
        padding: 8,
      }}>
      {/* Type indicator */}
      <View
        style={{
          backgroundColor: getPrimaryColor('600'),
          padding: 8,
          borderRadius: 8,
          marginRight: 10,
        }}>
        <Icon
          name={isDerived ? 'mdi:key-arrow-right' : 'ph:user-bold'}
          size={16}
          color={opacity(getPrimaryColor('0'), 0.5)}
        />
      </View>

      {/* Public key */}
      <VStack flex={1}>
        <Text
          mono
          size={11}
          style={{
            color: opacity(getPrimaryColor('0'), 0.8),
          }}>
          {truncateMiddle(displayKey, 7)}
        </Text>
        <Text size={10} style={{ color: opacity(getPrimaryColor('0'), 0.4), marginTop: 2 }}>
          {isDerived ? `Derived Key ${keypair.derivationIndex}` : `Imported`}
        </Text>
      </VStack>

      {/* Copy button */}
      <TouchableOpacity onPress={() => onCopy(keypair.publicKeyHex)}>
        <View
          style={{
            backgroundColor: getPrimaryColor('600'),
            padding: 8,
            borderRadius: 8,
          }}>
          <Icon name="lets-icons:copy" size={16} color={opacity(getPrimaryColor('0'), 0.4)} />
        </View>
      </TouchableOpacity>

      {/* QR button */}
      <TouchableOpacity onPress={handleShowQR} style={{ marginLeft: 6 }}>
        <View
          style={{
            backgroundColor: getPrimaryColor('600'),
            padding: 8,
            borderRadius: 8,
          }}>
          <Icon name="stash:qr-code" size={16} color={opacity(getPrimaryColor('0'), 0.4)} />
        </View>
      </TouchableOpacity>
    </HStack>
  );
};

/**
 * KeyringSettings - P2PK key management page
 */
const KeyringSettings: React.FC = () => {
  const { getPrimaryColor, getShadeColor } = useTheme();
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
      popup({ message: 'Failed to load keys', type: 'error' });
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
      popup({ message: 'New key generated', type: 'success', emoji: '🔑' });
      await loadKeypairs();
    } catch (error) {
      console.error('Failed to generate keypair:', error);
      popup({ message: 'Failed to generate key', type: 'error' });
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
                popup({ message: 'Key imported successfully', type: 'success', emoji: '🔑' });
                await loadKeypairs();
              } else {
                popup({
                  message: 'Invalid key format. Enter nsec or 64-character hex key.',
                  type: 'error',
                });
              }
            } catch (error) {
              console.error('Failed to import key:', error);
              popup({ message: 'Failed to import key', type: 'error' });
            }
          },
        },
      ],
      'plain-text'
    );
  };

  /**
   * Copies a public key to clipboard
   */
  const handleCopyKey = (publicKey: string) => {
    Clipboard.setString(publicKey);
    popup({ message: 'Public key copied', type: 'success' });
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
                <Icon name="mdi:key-arrow-right" size={22} color={getPrimaryColor('0')} />
              </RNTouchableOpacity>
              <RNTouchableOpacity
                onPress={handleGenerateKey}
                style={{ padding: 8 }}
                disabled={isGenerating}>
                {isGenerating ? (
                  <ActivityIndicator size="small" color={getPrimaryColor('0')} />
                ) : (
                  <Icon name="mdi:key-plus" size={22} color={getPrimaryColor('0')} />
                )}
              </RNTouchableOpacity>
            </HStack>
          ),
        }}
      />
      <ModalLayoutWrapper>
        {/* Quick Access Toggle */}
        <Section title="Preferences">
          <View
            style={{
              backgroundColor: getPrimaryColor('800'),
              borderRadius: 12,
              padding: 16,
            }}>
            <HStack align="center" justify="space-between">
              <VStack flex={1} style={{ marginRight: 12 }}>
                <Text size={16} style={{ color: getPrimaryColor('0') }}>
                  Quick Access to Lock
                </Text>
                <Text
                  size={13}
                  style={{
                    color: opacity(getPrimaryColor('0'), 0.4),
                    marginTop: 4,
                  }}>
                  Show your latest P2PK locking key in the receive ecash menu
                </Text>
              </VStack>
              <Switch
                value={quickAccessP2PK ?? false}
                onValueChange={setQuickAccessP2PK}
                trackColor={{
                  false: getPrimaryColor('700'),
                  true: getShadeColor('300'),
                }}
                thumbColor={getPrimaryColor('0')}
              />
            </HStack>
            <View style={{ height: 1, backgroundColor: opacity(getPrimaryColor('0'), 0.08), marginVertical: 12 }} />
            <HStack align="center" justify="space-between">
              <VStack flex={1} style={{ marginRight: 12 }}>
                <Text size={16} style={{ color: getPrimaryColor('0') }}>
                  Regenerate Key on Receive
                </Text>
                <Text
                  size={13}
                  style={{
                    color: opacity(getPrimaryColor('0'), 0.4),
                    marginTop: 4,
                  }}>
                  Automatically generate a new P2PK key after redeeming a locked token for improved privacy
                </Text>
              </VStack>
              <Switch
                value={regenerateP2PKOnReceive ?? true}
                onValueChange={setRegenerateP2PKOnReceive}
                trackColor={{
                  false: getPrimaryColor('700'),
                  true: getShadeColor('300'),
                }}
                thumbColor={getPrimaryColor('0')}
              />
            </HStack>
          </View>
        </Section>

        {/* Keys List */}
        <Section title={`Your Keys (${keypairs.length})`}>
          <View
            style={{
              backgroundColor: getPrimaryColor('800'),
              borderRadius: 12,
              overflow: 'hidden',
            }}>
            {/* Keys List */}
            <View style={{ padding: 16 }}>
              {isLoading ? (
                <VStack align="center" style={{ padding: 24 }}>
                  <ActivityIndicator size="small" color={opacity(getPrimaryColor('0'), 0.4)} />
                  <Text
                    size={14}
                    style={{ color: opacity(getPrimaryColor('0'), 0.4), marginTop: 8 }}>
                    Loading keys...
                  </Text>
                </VStack>
              ) : keypairs.length === 0 ? (
                <VStack align="center" style={{ padding: 24 }}>
                  <Icon name="mdi:key-variant" size={40} color={getPrimaryColor('600')} />
                  <Text
                    size={14}
                    style={{
                      color: opacity(getPrimaryColor('0'), 0.4),
                      marginTop: 12,
                      textAlign: 'center',
                    }}>
                    Generate or import a key to get started with P2PK-locked ecash
                  </Text>
                </VStack>
              ) : (
                <>
                  {/* Display keys in reverse order (most recent first) */}
                  {[...keypairs]
                    .reverse()
                    .map((keypair, index) =>
                      index === 0 ? (
                        <CurrentKeyItem
                          key={keypair.publicKeyHex}
                          keypair={keypair}
                          onCopy={handleCopyKey}
                        />
                      ) : (
                        <KeyItem
                          key={keypair.publicKeyHex}
                          keypair={keypair}
                          onCopy={handleCopyKey}
                        />
                      )
                    )}
                </>
              )}
            </View>
          </View>
        </Section>

        <Spacer size={32} />
      </ModalLayoutWrapper>
    </>
  );
};

export default KeyringSettings;
