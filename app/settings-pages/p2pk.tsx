import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, Modal, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import { router } from 'expo-router';
import { truncateMiddle } from 'helper/strings';
import Container from 'components/blocks/Container';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { View, HStack, VStack } from 'components/ui/View';
import Icon from 'assets/icons';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { RowButton, Section } from './index';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { useCocoContext } from '@/helper/coco/CocoProvider';
import { nip19, getPublicKey } from 'nostr-tools';
import * as Clipboard from 'expo-clipboard';
import { popup } from '@/helper/popup';
import TextInput from 'components/ui/TextInput';
import { useManager } from 'coco-cashu-react';
const P2PKKeysSettings: React.FC = () => {
  const manager = useManager();

  const { isReady } = useCocoContext();
  const { getPrimaryColor } = useTheme();
  const [keys, setKeys] = useState<Keypair[]>([]);
  const [loading, setLoading] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [nsecInput, setNsecInput] = useState('');
  const [importing, setImporting] = useState(false);

  const loadKeys = useCallback(async () => {
    if (!manager || !isReady) return;
    try {
      setLoading(true);
      const allKeys = await manager.keyring.getAllKeyPairs();
      setKeys(allKeys);
    } catch (error) {
      console.error('Failed to load keys:', error);
      popup({
        message: 'Failed to load P2PK keys',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [manager, isReady]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleGenerateKey = useCallback(async () => {
    if (!manager || !isReady) return;
    try {
      setLoading(true);
      await manager.keyring.generateKeyPair();
      await loadKeys();
      popup({
        message: 'P2PK key generated successfully',
        type: 'success',
      });
    } catch (error) {
      console.error('Failed to generate key:', error);
      popup({
        message: 'Failed to generate P2PK key',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [manager, isReady, loadKeys]);

  const handleImportNsec = useCallback(async () => {
    if (!manager || !isReady) return;
    if (!nsecInput.trim()) {
      popup({
        message: 'Please enter an nsec',
        type: 'error',
      });
      return;
    }

    const nsec = nsecInput.trim();
    if (!nsec.startsWith('nsec1')) {
      popup({
        message: 'Invalid nsec format. Must start with "nsec1"',
        type: 'error',
      });
      return;
    }

    try {
      setImporting(true);
      // Decode nsec
      const decoded = nip19.decode(nsec);
      if (decoded.type !== 'nsec') {
        throw new Error('Invalid nsec type');
      }
      const secretKey = decoded.data as Uint8Array;

      // Convert to P2PK format public key
      const publicKeyHex = '02' + getPublicKey(secretKey);

      // Check if key already exists
      const existingKey = await manager.keyring.getKeyPair(publicKeyHex);
      if (existingKey) {
        popup({
          message: 'This key already exists in your keyring',
          type: 'warning',
        });
        setShowImportModal(false);
        setNsecInput('');
        return;
      }

      // Add the keypair
      await manager.keyring.addKeyPair(secretKey);
      await loadKeys();
      popup({
        message: 'NSEC imported successfully',
        type: 'success',
      });
      setShowImportModal(false);
      setNsecInput('');
    } catch (error) {
      console.error('Failed to import nsec:', error);
      popup({
        message: error instanceof Error ? error.message : 'Failed to import nsec',
        type: 'error',
      });
    } finally {
      setImporting(false);
    }
  }, [manager, isReady, nsecInput, loadKeys]);

  const handleCopyKey = useCallback(async (publicKeyHex: string) => {
    try {
      await Clipboard.setStringAsync(publicKeyHex);
      popup({
        message: 'p2pk_copied',
        type: 'success',
      });
    } catch (error) {
      console.error('Failed to copy key:', error);
      popup({
        message: 'Failed to copy key',
        type: 'error',
      });
    }
  }, []);

  const handleShowQR = useCallback((publicKeyHex: string) => {
    router.push(`/share?type=p2pk&data=${encodeURIComponent(publicKeyHex)}`);
  }, []);

  if (!isReady || !manager) {
    return (
      <Container>
        <ScrollView className="px-4">
          <View className="py-8">
            <Text className="text-center text-primary-400">Loading...</Text>
          </View>
        </ScrollView>
      </Container>
    );
  }

  return (
    <Container>
      <ScrollView className="px-4">
        <Section title="P2PK Keys">
          {keys.length === 0 ? (
            <RowButton
              isFirst
              isLast
              label="No keys yet. Generate or import one to get started."
              onPress={undefined}
            />
          ) : (
            keys.map((keypair, index) => (
              <RowButton
                key={keypair.publicKeyHex}
                isFirst={index === 0}
                isLast={index === keys.length - 1}
                label={truncateMiddle(keypair.publicKeyHex, 10)}
                rightIcon={
                  <HStack spacing={8} align="center">
                    <TouchableOpacity
                      onPress={() => handleCopyKey(keypair.publicKeyHex)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Icon name="lets-icons:copy" size={20} color={getPrimaryColor('400')} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleShowQR(keypair.publicKeyHex)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Icon
                        name="material-symbols:qr-code-2-rounded"
                        size={20}
                        color={getPrimaryColor('400')}
                      />
                    </TouchableOpacity>
                  </HStack>
                }
              />
            ))
          )}
        </Section>

        <View className="pb-8 pt-4">
          <ButtonHandler
            buttons={[
              {
                text: 'Generate Key',
                variant: 'primary',
                onPress: handleGenerateKey,
                loading: loading,
              },
              {
                text: 'Import NSEC',
                variant: 'secondary',
                onPress: () => setShowImportModal(true),
                loading: false,
              },
            ]}
          />
        </View>
      </ScrollView>

      {/* Import NSEC Modal */}
      <Modal
        visible={showImportModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowImportModal(false);
          setNsecInput('');
        }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}>
          <Pressable
            style={{
              flex: 1,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              justifyContent: 'center',
              alignItems: 'center',
            }}
            onPress={() => {
              setShowImportModal(false);
              setNsecInput('');
            }}>
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{
                backgroundColor: getPrimaryColor('800'),
                borderRadius: 16,
                padding: 24,
                width: '90%',
                maxWidth: 400,
              }}>
              <VStack spacing={16}>
                <HStack justify="space-between" align="center">
                  <Text size={20} bold className="text-primary-0">
                    Import NSEC
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setShowImportModal(false);
                      setNsecInput('');
                    }}>
                    <Icon
                      name="material-symbols:close-rounded"
                      size={24}
                      color={getPrimaryColor('400')}
                    />
                  </TouchableOpacity>
                </HStack>
                <Text size={16} className="text-primary-100">
                  Enter your nsec (Nostr secret key) to import it as a P2PK key.
                </Text>
                <Text size={14} className="text-primary-300">
                  Warning: This feature is experimental. Only use with small amounts. If you lose
                  your private keys, nobody will be able to unlock the ecash locked to it anymore.
                </Text>
                <TextInput
                  value={nsecInput}
                  onChangeText={setNsecInput}
                  placeholder="nsec1..."
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={true}
                />
                <ButtonHandler
                  buttons={[
                    {
                      text: 'Cancel',
                      variant: 'secondary',
                      onPress: () => {
                        setShowImportModal(false);
                        setNsecInput('');
                      },
                    },
                    {
                      text: 'Import',
                      variant: 'primary',
                      onPress: handleImportNsec,
                      loading: importing,
                      disabled: !nsecInput.trim() || importing,
                    },
                  ]}
                />
              </VStack>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </Container>
  );
};

export default withSheetProvider(P2PKKeysSettings);
