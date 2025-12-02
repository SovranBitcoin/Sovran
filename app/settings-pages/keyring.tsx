import React, { useState, useEffect, useCallback } from 'react';
import {
  Switch,
  Clipboard,
  Alert,
  ActivityIndicator,
  TouchableOpacity as RNTouchableOpacity,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';
import { useManager } from 'coco-cashu-react';
import { popup } from '@/helper/popup';
import { truncateMiddle } from 'helper/strings';
import { Section } from './index';
import type { Keypair } from 'coco-cashu-core';
import { useSettingsStore } from 'stores/settingsStore';
import { ModalLayoutWrapper } from 'app/debugModal';

/**
 * KeyItem - Individual key display component
 */
const KeyItem: React.FC<{
  keypair: Keypair;
  onCopy: (publicKey: string) => void;
}> = ({ keypair, onCopy }) => {
  const { getPrimaryColor } = useTheme();

  const handleShowQR = () => {
    router.push({
      pathname: '/share',
      params: {
        type: 'p2pk',
        data: keypair.publicKeyHex,
      },
    });
  };

  return (
    <HStack
      align="center"
      style={{
        backgroundColor: getPrimaryColor('800'),
        borderRadius: 12,
        marginBottom: 8,
      }}>
      {/* Copy button */}
      <TouchableOpacity onPress={() => onCopy(keypair.publicKeyHex)}>
        <View
          style={{
            backgroundColor: getPrimaryColor('700'),
            padding: 8,
            borderRadius: 8,
          }}>
          <Icon name="lets-icons:copy" size={16} color={getPrimaryColor('400')} />
        </View>
      </TouchableOpacity>

      {/* Public key */}
      <VStack flex={1} style={{ marginLeft: 12 }}>
        <Text
          mono
          size={12}
          style={{
            color: getPrimaryColor('100'),
            flexShrink: 0,
          }}>
          {truncateMiddle(keypair.publicKeyHex, 10)}
        </Text>
      </VStack>

      {/* QR button */}
      <TouchableOpacity onPress={handleShowQR} style={{ marginLeft: 8 }}>
        <View
          style={{
            backgroundColor: getPrimaryColor('700'),
            padding: 8,
            borderRadius: 8,
          }}>
          <Icon name="stash:qr-code" size={16} color={getPrimaryColor('400')} />
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
  const [isExpanded, setIsExpanded] = useState(true);

  // Quick access setting from settings store
  const quickAccessP2PK = useSettingsStore((state) => state.quickAccessP2PK);
  const setQuickAccessP2PK = useSettingsStore((state) => state.setQuickAccessP2PK);

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
   * Imports an existing nsec key
   */
  const handleImportNsec = () => {
    Alert.prompt(
      'Import Private Key',
      'Enter your 32-byte hex secret key (64 characters)',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: async (value: string | undefined) => {
            if (!value || !manager) return;

            try {
              // Convert hex string to Uint8Array
              const cleanHex = value.replace(/^0x/, '').trim();
              if (cleanHex.length !== 64) {
                popup({
                  message: 'Invalid key length. Expected 64 hex characters.',
                  type: 'error',
                });
                return;
              }

              const bytes = new Uint8Array(32);
              for (let i = 0; i < 32; i++) {
                bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
              }

              await manager.keyring.addKeyPair(bytes);
              popup({ message: 'Key imported successfully', type: 'success', emoji: '🔑' });
              await loadKeypairs();
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
                    color: getPrimaryColor('400'),
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
            {/* Collapsible Header */}
            <TouchableOpacity onPress={() => setIsExpanded(!isExpanded)}>
              <HStack align="center" justify="space-between" style={{ padding: 16 }}>
                <Text size={15} style={{ color: getPrimaryColor('0') }}>
                  {keypairs.length > 0
                    ? `Click to ${isExpanded ? 'hide' : 'browse'} ${keypairs.length} key${keypairs.length !== 1 ? 's' : ''}`
                    : 'No keys yet'}
                </Text>
                <Icon
                  name={isExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
                  size={20}
                  color={getPrimaryColor('400')}
                />
              </HStack>
            </TouchableOpacity>

            {/* Keys List */}
            {isExpanded && (
              <View style={{ padding: 16, paddingTop: 0 }}>
                {isLoading ? (
                  <VStack align="center" style={{ padding: 24 }}>
                    <ActivityIndicator size="small" color={getPrimaryColor('400')} />
                    <Text size={14} style={{ color: getPrimaryColor('400'), marginTop: 8 }}>
                      Loading keys...
                    </Text>
                  </VStack>
                ) : keypairs.length === 0 ? (
                  <VStack align="center" style={{ padding: 24 }}>
                    <Icon name="mdi:key-variant" size={40} color={getPrimaryColor('600')} />
                    <Text
                      size={14}
                      style={{
                        color: getPrimaryColor('400'),
                        marginTop: 12,
                        textAlign: 'center',
                      }}>
                      Generate or import a key to get started with P2PK-locked ecash
                    </Text>
                  </VStack>
                ) : (
                  keypairs.map((keypair) => (
                    <KeyItem key={keypair.publicKeyHex} keypair={keypair} onCopy={handleCopyKey} />
                  ))
                )}
              </View>
            )}
          </View>
        </Section>

        <Spacer size={32} />
      </ModalLayoutWrapper>
    </>
  );
};

export default KeyringSettings;
