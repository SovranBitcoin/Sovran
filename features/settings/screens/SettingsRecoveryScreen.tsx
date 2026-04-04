import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, ActivityIndicator } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import Container from '@/shared/ui/composed/Container';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { useMintManagement } from '@/features/mint';
import { useNavigation, router } from 'expo-router';
import { Mint } from '@cashu/coco-core';
import opacity from 'hex-color-opacity';
import { Button, Card } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

type RecoveryState = 'idle' | 'recovering' | 'complete' | 'error';

interface RecoveryResult {
  mint: string;
  success: boolean;
  error?: string;
}

export const SettingsRecoveryScreen: React.FC = () => {
  const [foreground, green400, red400] = useThemeColor([
    'foreground',
    'green-400',
    'red-400',
  ] as const);
  const navigation = useNavigation();
  const { mints, restoreMint, loadMints } = useMintManagement();

  const [recoveryState, setRecoveryState] = useState<RecoveryState>('idle');
  const [currentMintIndex, setCurrentMintIndex] = useState(0);
  const [results, setResults] = useState<RecoveryResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Lock navigation when recovery is in progress
  useEffect(() => {
    const isLocked = recoveryState === 'recovering';

    navigation.setOptions({
      gestureEnabled: !isLocked,
      headerBackVisible: !isLocked,
      headerLeft: isLocked ? () => null : undefined,
    });

    // Prevent hardware back button on Android
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (isLocked) {
        e.preventDefault();
      }
    });

    return unsubscribe;
  }, [recoveryState, navigation]);

  const handleStartRecovery = useCallback(async () => {
    if (mints.length === 0) {
      setErrorMessage('No mints found to recover from. Add a mint first.');
      setRecoveryState('error');
      return;
    }

    setRecoveryState('recovering');
    setResults([]);
    setCurrentMintIndex(0);
    setErrorMessage(null);

    const recoveryResults: RecoveryResult[] = [];

    try {
      for (let i = 0; i < mints.length; i++) {
        const mint = mints[i];
        setCurrentMintIndex(i);

        try {
          await restoreMint(mint.mintUrl);
          recoveryResults.push({ mint: mint.mintUrl, success: true });
        } catch (error) {
          recoveryResults.push({
            mint: mint.mintUrl,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }

        setResults([...recoveryResults]);
      }

      // Also recover pending send operations
      setCurrentMintIndex(mints.length); // Show "recovering pending transactions" state
      try {
        const manager = CocoManager.getInstance();
        await manager.ops.send.recovery.run();
      } catch (error) {
        console.warn('Failed to recover pending operations:', error);
      }

      // Reload mints/balances
      await loadMints();

      setRecoveryState('complete');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      setRecoveryState('error');
    }
  }, [mints, restoreMint, loadMints]);

  const handleClose = useCallback(() => {
    router.back();
  }, []);

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  const renderIdleState = () => (
    <VStack spacing={24} className="flex-1 items-center justify-center px-6">
      <View className="bg-surface-secondary h-24 w-24 items-center justify-center rounded-full">
        <Icon name="mdi:shield-refresh" size={48} color={foreground} />
      </View>

      <VStack spacing={8} className="items-center">
        <Text size={24} bold style={{ color: foreground, textAlign: 'center' }}>
          Recover Wallet
        </Text>
        <Text
          size={16}
          style={{
            color: opacity(foreground, 0.5),
            textAlign: 'center',
            lineHeight: 24,
          }}>
          This will attempt to recover your ecash from {mints.length} mint
          {mints.length !== 1 ? 's' : ''} using your seed phrase.
        </Text>
      </VStack>

      <Card variant="secondary" className="w-full">
        <Card.Body>
          <HStack spacing={12} className="items-start">
            <Icon name="mdi:information" size={24} color={opacity(foreground, 0.4)} />
            <VStack spacing={4} className="flex-1">
              <Card.Title>What happens during recovery?</Card.Title>
              <Card.Description>
                - Contacts each mint to restore proofs{'\n'}- Recovers interrupted transactions
                {'\n'}- This may take several minutes
              </Card.Description>
            </VStack>
          </HStack>
        </Card.Body>
      </Card>

      <VStack spacing={12} className="w-full">
        <Button variant="primary" className="w-full" onPress={handleStartRecovery}>
          <Button.Label>Start Recovery</Button.Label>
        </Button>
        <Button variant="secondary" className="w-full" onPress={handleClose}>
          <Button.Label>Cancel</Button.Label>
        </Button>
      </VStack>
    </VStack>
  );

  const renderRecoveringState = () => (
    <VStack spacing={24} className="flex-1 px-6 pt-8">
      <VStack spacing={8} className="items-center">
        <ActivityIndicator size="large" color={foreground} />
        <Text size={20} bold style={{ color: foreground, textAlign: 'center' }}>
          Recovering...
        </Text>
        <Text size={14} style={{ color: opacity(foreground, 0.5), textAlign: 'center' }}>
          Please do not close this screen
        </Text>
      </VStack>

      <Card variant="secondary" className="w-full">
        <Card.Body>
          <VStack spacing={16}>
            {mints.map((mint, index) => (
              <MintRecoveryRow
                key={mint.mintUrl}
                mint={mint}
                index={index}
                currentIndex={currentMintIndex}
                result={results[index]}
              />
            ))}

            {/* Pending transactions row */}
            <HStack spacing={12} className="items-center">
              <View className="h-6 w-6 items-center justify-center">
                {currentMintIndex === mints.length ? (
                  <ActivityIndicator size="small" color={foreground} />
                ) : currentMintIndex > mints.length ? (
                  <Icon name="mdi:check-circle" size={24} color={green400} />
                ) : (
                  <View className="bg-default h-4 w-4 rounded-full" />
                )}
              </View>
              <Text
                size={14}
                style={{
                  color: currentMintIndex >= mints.length ? foreground : opacity(foreground, 0.33),
                }}>
                Recovering pending transactions
              </Text>
            </HStack>
          </VStack>
        </Card.Body>
      </Card>
    </VStack>
  );

  const renderCompleteState = () => (
    <VStack spacing={24} className="flex-1 items-center justify-center px-6">
      <View
        className={`h-24 w-24 items-center justify-center rounded-full ${failureCount === 0 ? 'bg-success' : 'bg-surface-secondary'}`}>
        <Icon
          name={failureCount === 0 ? 'mdi:check-circle' : 'mdi:alert-circle'}
          size={48}
          color={failureCount === 0 ? green400 : foreground}
        />
      </View>

      <VStack spacing={8} className="items-center">
        <Text size={24} bold style={{ color: foreground, textAlign: 'center' }}>
          {failureCount === 0 ? 'Recovery Complete' : 'Recovery Partial'}
        </Text>
        <Text
          size={16}
          style={{
            color: opacity(foreground, 0.5),
            textAlign: 'center',
            lineHeight: 24,
          }}>
          {failureCount === 0
            ? `Successfully recovered from ${successCount} mint${successCount !== 1 ? 's' : ''}.`
            : `Recovered from ${successCount} mint${successCount !== 1 ? 's' : ''}. Failed for ${failureCount} mint${failureCount !== 1 ? 's' : ''}.`}
        </Text>
      </VStack>

      {/* Results summary */}
      <ScrollView className="max-h-48 w-full" contentContainerStyle={{ paddingVertical: 8 }}>
        <Card variant="secondary" className="w-full">
          <Card.Body>
            <VStack spacing={12}>
              {results.map((result, index) => (
                <HStack key={index} spacing={12} className="items-start">
                  <Icon
                    name={result.success ? 'mdi:check-circle' : 'mdi:close-circle'}
                    size={20}
                    color={result.success ? green400 : red400}
                  />
                  <VStack spacing={2} className="flex-1">
                    <Text size={13} numberOfLines={1} style={{ color: foreground }}>
                      {new URL(result.mint).hostname}
                    </Text>
                    {result.error && (
                      <Text size={12} style={{ color: red400 }}>
                        {result.error}
                      </Text>
                    )}
                  </VStack>
                </HStack>
              ))}
            </VStack>
          </Card.Body>
        </Card>
      </ScrollView>

      <Button variant="primary" className="w-full" onPress={handleClose}>
        <Button.Label>Done</Button.Label>
      </Button>
    </VStack>
  );

  const renderErrorState = () => (
    <VStack spacing={24} className="flex-1 items-center justify-center px-6">
      <View className="bg-danger h-24 w-24 items-center justify-center rounded-full">
        <Icon name="mdi:alert-circle" size={48} color={red400} />
      </View>

      <VStack spacing={8} className="items-center">
        <Text size={24} bold style={{ color: foreground, textAlign: 'center' }}>
          Recovery Failed
        </Text>
        <Text
          size={16}
          style={{
            color: opacity(foreground, 0.5),
            textAlign: 'center',
            lineHeight: 24,
          }}>
          {errorMessage || 'An unexpected error occurred during recovery.'}
        </Text>
      </VStack>

      <VStack spacing={12} className="w-full">
        <Button variant="primary" className="w-full" onPress={handleStartRecovery}>
          <Button.Label>Try Again</Button.Label>
        </Button>
        <Button variant="secondary" className="w-full" onPress={handleClose}>
          <Button.Label>Close</Button.Label>
        </Button>
      </VStack>
    </VStack>
  );

  return (
    <Container>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1 }}
        scrollEnabled={recoveryState !== 'recovering'}>
        {recoveryState === 'idle' && renderIdleState()}
        {recoveryState === 'recovering' && renderRecoveringState()}
        {recoveryState === 'complete' && renderCompleteState()}
        {recoveryState === 'error' && renderErrorState()}
      </ScrollView>
    </Container>
  );
};

// Helper component for mint recovery row
const MintRecoveryRow: React.FC<{
  mint: Mint;
  index: number;
  currentIndex: number;
  result?: RecoveryResult;
}> = ({ mint, index, currentIndex, result }) => {
  const [foreground, green400, red400] = useThemeColor([
    'foreground',
    'green-400',
    'red-400',
  ] as const);

  const isActive = index === currentIndex;
  const isComplete = index < currentIndex;
  const isPending = index > currentIndex;

  let hostname: string;
  try {
    hostname = new URL(mint.mintUrl).hostname;
  } catch {
    hostname = mint.mintUrl;
  }

  return (
    <HStack spacing={12} className="items-center">
      <View className="h-6 w-6 items-center justify-center">
        {isActive && <ActivityIndicator size="small" color={foreground} />}
        {isComplete && result?.success && (
          <Icon name="mdi:check-circle" size={24} color={green400} />
        )}
        {isComplete && !result?.success && (
          <Icon name="mdi:close-circle" size={24} color={red400} />
        )}
        {isPending && <View className="bg-default h-4 w-4 rounded-full" />}
      </View>
      <VStack spacing={2} className="flex-1">
        <Text
          size={14}
          numberOfLines={1}
          style={{
            color: isPending ? opacity(foreground, 0.33) : foreground,
          }}>
          {hostname}
        </Text>
        {isComplete && !result?.success && result?.error && (
          <Text size={12} numberOfLines={1} style={{ color: red400 }}>
            {result.error}
          </Text>
        )}
      </VStack>
    </HStack>
  );
};
