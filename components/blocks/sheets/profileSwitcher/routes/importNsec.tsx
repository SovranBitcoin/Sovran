import React, { useState, useCallback } from 'react';
import { Text } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { View } from 'components/ui/View/View';
import opacity from 'hex-color-opacity';
import { RouteScreenProps, useSheetPayload } from 'react-native-actions-sheet';
import { useThemeColor } from 'hooks/useThemeColor';
import { nip19, getPublicKey } from 'nostr-tools';
import { Button, Input, Label, TextField } from 'heroui-native';
import { useProfileStore } from '@/stores/profileStore';
import { storeImportedNsec } from '@/helper/secureStorage';
import { pubkeyToAccountNumber } from '@/helper/keyDerivation';

const ImportNsec = ({ router }: RouteScreenProps<'profile-switcher', 'import-nsec'>) => {
  const [foreground, muted, danger] = useThemeColor(['foreground', 'muted', 'danger'] as const);
  const payload = useSheetPayload('profile-switcher');
  const [nsecInput, setNsecInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleImport = useCallback(async () => {
    const trimmed = nsecInput.trim();
    setError(null);

    if (!trimmed) {
      setError('Please enter an nsec.');
      return;
    }

    // Validate nsec format
    let privateKeyBytes: Uint8Array;
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type !== 'nsec') {
        setError('Invalid format. Must be an nsec (nsec1...).');
        return;
      }
      privateKeyBytes = decoded.data;
    } catch {
      setError('Invalid nsec format.');
      return;
    }

    // Derive pubkey from the private key
    let pubkeyHex: string;
    try {
      pubkeyHex = getPublicKey(privateKeyBytes);
    } catch {
      setError('Failed to derive public key from nsec.');
      return;
    }

    // Check for duplicate (same pubkey already exists as any profile type)
    if (useProfileStore.getState().hasPubkey(pubkeyHex)) {
      setError('This identity already exists as a profile.');
      return;
    }

    setIsImporting(true);
    try {
      // Securely store the imported nsec
      const stored = await storeImportedNsec(pubkeyHex, trimmed);
      if (!stored) {
        setError('Failed to store nsec securely.');
        return;
      }

      // Compute the deterministic account number from the pubkey
      const npubNumber = pubkeyToAccountNumber(pubkeyHex);

      // Add profile to the store
      useProfileStore.getState().addProfile(npubNumber, pubkeyHex, 'imported');

      // Close the sheet and trigger the switch
      router?.close();
      setTimeout(() => {
        payload.onImportProfile?.(npubNumber);
      }, 100);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      setError(message);
    } finally {
      setIsImporting(false);
    }
  }, [nsecInput, router, payload]);

  return (
    <View
      className="bg-surface-secondary mx-4 mb-3 overflow-hidden rounded-[20px] border"
      style={{ borderColor: opacity(muted, 0.2) }}>
      <VStack spacing={16} style={{ padding: 16 }}>
        <VStack spacing={4}>
          <Text className="text-foreground" size={18} weight="bold">
            Import nsec
          </Text>
          <Text style={{ color: opacity(foreground, 0.5) }} size={13}>
            Paste your Nostr private key to create an imported profile.
          </Text>
        </VStack>

        <TextField isInvalid={!!error}>
          <Label>nsec</Label>
          <Input
            value={nsecInput}
            onChangeText={setNsecInput}
            placeholder="nsec1..."
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
        </TextField>

        {error && (
          <Text style={{ color: danger }} size={13}>
            {error}
          </Text>
        )}

        <Button onPress={handleImport} isDisabled={isImporting || !nsecInput.trim()}>
          <Button.Label>{isImporting ? 'Importing...' : 'Import'}</Button.Label>
        </Button>
      </VStack>
    </View>
  );
};

export default ImportNsec;
