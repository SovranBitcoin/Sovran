import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, ActivityIndicator } from 'react-native';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import Container from 'components/blocks/Container';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import Icon from 'assets/icons';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { CocoManager } from 'helper/coco/manager';
import { useMintManagement } from 'hooks/coco/useMintManagement';
import { useNavigation, router } from 'expo-router';
import { Mint } from 'coco-cashu-core';
import opacity from 'hex-color-opacity';

type RecoveryState = 'idle' | 'recovering' | 'complete' | 'error';

interface RecoveryResult {
  mint: string;
  success: boolean;
  error?: string;
}

const RecoveryScreen: React.FC = () => {
  const { getPrimaryColor, getGreenColor, getRedColor } = useTheme();
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
        await manager.send.recoverPendingOperations();
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
      <View
        className="h-24 w-24 items-center justify-center rounded-full"
        style={{ backgroundColor: getPrimaryColor('800') }}>
        <Icon name="mdi:shield-refresh" size={48} color={getPrimaryColor('0')} />
      </View>

      <VStack spacing={8} className="items-center">
        <Text size={24} bold style={{ color: getPrimaryColor('0'), textAlign: 'center' }}>
          Recover Wallet
        </Text>
        <Text
          size={16}
          style={{
            color: opacity(getPrimaryColor('0'), 0.5),
            textAlign: 'center',
            lineHeight: 24,
          }}>
          This will attempt to recover your ecash from {mints.length} mint
          {mints.length !== 1 ? 's' : ''} using your seed phrase.
        </Text>
      </VStack>

      <View className="w-full rounded-xl p-4" style={{ backgroundColor: getPrimaryColor('900') }}>
        <HStack spacing={12} className="items-start">
          <Icon name="mdi:information" size={24} color={opacity(getPrimaryColor('0'), 0.4)} />
          <VStack spacing={4} className="flex-1">
            <Text size={14} medium style={{ color: opacity(getPrimaryColor('0'), 0.66) }}>
              What happens during recovery?
            </Text>
            <Text size={13} style={{ color: opacity(getPrimaryColor('0'), 0.4), lineHeight: 20 }}>
              • Contacts each mint to restore proofs{'\n'}• Recovers any interrupted transactions
              {'\n'}• This may take several minutes
            </Text>
          </VStack>
        </HStack>
      </View>

      <VStack spacing={12} className="w-full">
        <TouchableOpacity
          onPress={handleStartRecovery}
          className="w-full items-center rounded-xl p-4"
          style={{ backgroundColor: getPrimaryColor('0') }}>
          <Text size={16} bold style={{ color: getPrimaryColor('950') }}>
            Start Recovery
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleClose}
          className="w-full items-center rounded-xl p-4"
          style={{ backgroundColor: getPrimaryColor('800') }}>
          <Text size={16} medium style={{ color: opacity(getPrimaryColor('0'), 0.66) }}>
            Cancel
          </Text>
        </TouchableOpacity>
      </VStack>
    </VStack>
  );

  const renderRecoveringState = () => (
    <VStack spacing={24} className="flex-1 px-6 pt-8">
      <VStack spacing={8} className="items-center">
        <ActivityIndicator size="large" color={getPrimaryColor('0')} />
        <Text size={20} bold style={{ color: getPrimaryColor('0'), textAlign: 'center' }}>
          Recovering...
        </Text>
        <Text size={14} style={{ color: opacity(getPrimaryColor('0'), 0.5), textAlign: 'center' }}>
          Please do not close this screen
        </Text>
      </VStack>

      <View className="w-full rounded-xl p-4" style={{ backgroundColor: getPrimaryColor('900') }}>
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
                <ActivityIndicator size="small" color={getPrimaryColor('0')} />
              ) : currentMintIndex > mints.length ? (
                <Icon name="mdi:check-circle" size={24} color={getGreenColor('400')} />
              ) : (
                <View
                  className="h-4 w-4 rounded-full"
                  style={{ backgroundColor: getPrimaryColor('600') }}
                />
              )}
            </View>
            <Text
              size={14}
              style={{
                color:
                  currentMintIndex >= mints.length
                    ? getPrimaryColor('0')
                    : opacity(getPrimaryColor('0'), 0.33),
              }}>
              Recovering pending transactions
            </Text>
          </HStack>
        </VStack>
      </View>
    </VStack>
  );

  const renderCompleteState = () => (
    <VStack spacing={24} className="flex-1 items-center justify-center px-6">
      <View
        className="h-24 w-24 items-center justify-center rounded-full"
        style={{
          backgroundColor: failureCount === 0 ? getGreenColor('900') : getPrimaryColor('800'),
        }}>
        <Icon
          name={failureCount === 0 ? 'mdi:check-circle' : 'mdi:alert-circle'}
          size={48}
          color={failureCount === 0 ? getGreenColor('400') : getPrimaryColor('0')}
        />
      </View>

      <VStack spacing={8} className="items-center">
        <Text size={24} bold style={{ color: getPrimaryColor('0'), textAlign: 'center' }}>
          {failureCount === 0 ? 'Recovery Complete' : 'Recovery Partial'}
        </Text>
        <Text
          size={16}
          style={{
            color: opacity(getPrimaryColor('0'), 0.5),
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
        <View className="w-full rounded-xl p-4" style={{ backgroundColor: getPrimaryColor('900') }}>
          <VStack spacing={12}>
            {results.map((result, index) => (
              <HStack key={index} spacing={12} className="items-start">
                <Icon
                  name={result.success ? 'mdi:check-circle' : 'mdi:close-circle'}
                  size={20}
                  color={result.success ? getGreenColor('400') : getRedColor('400')}
                />
                <VStack spacing={2} className="flex-1">
                  <Text size={13} numberOfLines={1} style={{ color: getPrimaryColor('0') }}>
                    {new URL(result.mint).hostname}
                  </Text>
                  {result.error && (
                    <Text size={12} style={{ color: getRedColor('400') }}>
                      {result.error}
                    </Text>
                  )}
                </VStack>
              </HStack>
            ))}
          </VStack>
        </View>
      </ScrollView>

      <TouchableOpacity
        onPress={handleClose}
        className="w-full items-center rounded-xl p-4"
        style={{ backgroundColor: getPrimaryColor('0') }}>
        <Text size={16} bold style={{ color: getPrimaryColor('950') }}>
          Done
        </Text>
      </TouchableOpacity>
    </VStack>
  );

  const renderErrorState = () => (
    <VStack spacing={24} className="flex-1 items-center justify-center px-6">
      <View
        className="h-24 w-24 items-center justify-center rounded-full"
        style={{ backgroundColor: getRedColor('900') }}>
        <Icon name="mdi:alert-circle" size={48} color={getRedColor('400')} />
      </View>

      <VStack spacing={8} className="items-center">
        <Text size={24} bold style={{ color: getPrimaryColor('0'), textAlign: 'center' }}>
          Recovery Failed
        </Text>
        <Text
          size={16}
          style={{
            color: opacity(getPrimaryColor('0'), 0.5),
            textAlign: 'center',
            lineHeight: 24,
          }}>
          {errorMessage || 'An unexpected error occurred during recovery.'}
        </Text>
      </VStack>

      <VStack spacing={12} className="w-full">
        <TouchableOpacity
          onPress={handleStartRecovery}
          className="w-full items-center rounded-xl p-4"
          style={{ backgroundColor: getPrimaryColor('0') }}>
          <Text size={16} bold style={{ color: getPrimaryColor('950') }}>
            Try Again
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleClose}
          className="w-full items-center rounded-xl p-4"
          style={{ backgroundColor: getPrimaryColor('800') }}>
          <Text size={16} medium style={{ color: opacity(getPrimaryColor('0'), 0.66) }}>
            Close
          </Text>
        </TouchableOpacity>
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
  const { getPrimaryColor, getGreenColor, getRedColor } = useTheme();

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
        {isActive && <ActivityIndicator size="small" color={getPrimaryColor('0')} />}
        {isComplete && result?.success && (
          <Icon name="mdi:check-circle" size={24} color={getGreenColor('400')} />
        )}
        {isComplete && !result?.success && (
          <Icon name="mdi:close-circle" size={24} color={getRedColor('400')} />
        )}
        {isPending && (
          <View
            className="h-4 w-4 rounded-full"
            style={{ backgroundColor: getPrimaryColor('600') }}
          />
        )}
      </View>
      <VStack spacing={2} className="flex-1">
        <Text
          size={14}
          numberOfLines={1}
          style={{
            color: isPending ? opacity(getPrimaryColor('0'), 0.33) : getPrimaryColor('0'),
          }}>
          {hostname}
        </Text>
        {isComplete && !result?.success && result?.error && (
          <Text size={12} numberOfLines={1} style={{ color: getRedColor('400') }}>
            {result.error}
          </Text>
        )}
      </VStack>
    </HStack>
  );
};

export default RecoveryScreen;
