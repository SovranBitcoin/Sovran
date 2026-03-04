import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { nip19, getPublicKey } from 'nostr-tools';
import { BottomSheet, Input, Label, TextField } from 'heroui-native';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { storeImportedNsec } from '@/shared/lib/nostr/secureStorage';
import { pubkeyToAccountNumber } from '@/shared/lib/nostr/keyDerivation';
import type { ActionSheetPayloads } from '../../actionSheetTypes';

interface ImportNsecFooterState {
  onImport: () => void;
  isDisabled: boolean;
  isImporting: boolean;
}

interface ImportNsecProps {
  payload: ActionSheetPayloads['profile-switcher'];
  close: () => void;
  onFooterStateChange: (state: ImportNsecFooterState) => void;
}

export function ImportNsec({ payload, close, onFooterStateChange }: ImportNsecProps) {
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

    let pubkeyHex: string;
    try {
      pubkeyHex = getPublicKey(privateKeyBytes);
    } catch {
      setError('Failed to derive public key from nsec.');
      return;
    }

    if (useProfileStore.getState().hasPubkey(pubkeyHex)) {
      setError('This identity already exists as a profile.');
      return;
    }

    setIsImporting(true);
    try {
      const stored = await storeImportedNsec(pubkeyHex, trimmed);
      if (!stored) {
        setError('Failed to store nsec securely.');
        return;
      }

      const npubNumber = pubkeyToAccountNumber(pubkeyHex);
      useProfileStore.getState().addProfile(npubNumber, pubkeyHex, 'imported');

      close();
      setTimeout(() => {
        payload.onImportProfile?.(npubNumber);
      }, 100);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      setError(message);
    } finally {
      setIsImporting(false);
    }
  }, [nsecInput, close, payload]);

  useEffect(() => {
    onFooterStateChange({
      onImport: handleImport,
      isDisabled: isImporting || !nsecInput.trim(),
      isImporting,
    });
  }, [handleImport, isImporting, nsecInput, onFooterStateChange]);

  return (
    <View style={{ flex: 1 }}>
      <VStack spacing={16} className="flex-1">
        <View className="flex-row items-center justify-between">
          <BottomSheet.Title className="text-lg font-bold">Import NSEC</BottomSheet.Title>
          <BottomSheet.Close />
        </View>
        <VStack spacing={4}>
          <Text className="text-foreground/50 text-sm">
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
          />
        </TextField>

        {error && <Text className="text-danger text-sm">{error}</Text>}
      </VStack>
    </View>
  );
}
