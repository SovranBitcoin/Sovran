import React, { useState, useMemo } from 'react';

import { ButtonHandler } from 'components/common/ButtonHandler';
import { Text } from 'components/common/Text';
import { View, HStack, VStack } from 'components/common/View';
import { Spinner } from 'components/common/Spinner';
import { greens, greys, reds } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { memoizedGetMintInfo } from 'helper/redux/cashu/selectors';
import { useSelector } from 'react-redux';
import { useSheetPayload, useSheetRef, ScrollView } from 'react-native-actions-sheet';
import Image from 'components/common/Image';
import Icon from 'assets/icons';
import Wrapper from 'components/layout/sheets/wrapper';
import { Card } from 'components/common/Card';
import { getMeltQuote, sendLightning } from 'helper/cashuClient';
import { useTypedNavigation } from 'helper/navigation';

// Isolated MintComponent to prevent re-renders during animations
const MintComponent = React.memo(
  ({ mintUrl, isSource = false, theme }: { mintUrl: string; isSource?: boolean; theme: any }) => {
    // isSource is unused but kept for potential future use
    void isSource;
    const mintInfo = useSelector(memoizedGetMintInfo(mintUrl));
    const mintName = mintInfo?.name || mintUrl.replace('https://', '').replace('http://', '');
    const iconUrl = mintInfo?.icon_url;

    // Memoize style objects to prevent recalculation
    const containerStyle = useMemo(
      () => ({
        flex: 1,
        paddingHorizontal: 4,
      }),
      []
    );

    const cardStyle = useMemo(
      () => ({
        backgroundColor: greys(theme)[800],
        borderRadius: 10,
        padding: 10,
        minWidth: 90,
        borderWidth: 1,
        borderColor: greys(theme)[600],
        shadowColor: greys(theme)[900],
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 2,
        elevation: 2,
      }),
      [theme]
    );

    const imageStyle = useMemo(
      () => ({
        width: 28,
        height: 28,
        borderRadius: 7,
        backgroundColor: greys(theme)[500],
        marginBottom: 6,
      }),
      [theme]
    );

    const fallbackStyle = useMemo(
      () => ({
        width: 28,
        height: 28,
        borderRadius: 7,
        backgroundColor: greys(theme)[500],
        borderWidth: 1,
        borderColor: greys(theme)[400],
        marginBottom: 6,
      }),
      [theme]
    );

    // Memoize the image component to prevent re-creation
    const imageComponent = useMemo(() => {
      if (iconUrl) {
        return <Image source={{ uri: iconUrl }} style={imageStyle} />;
      } else {
        return (
          <VStack align="center" justify="center" style={fallbackStyle}>
            <Text size={16} bold color={greys(theme)[100]}>
              {mintName.charAt(0).toUpperCase()}
            </Text>
          </VStack>
        );
      }
    }, [iconUrl, imageStyle, fallbackStyle, mintName, theme]);

    return (
      <VStack align="center" style={containerStyle}>
        <VStack align="center" style={cardStyle}>
          {imageComponent}
          <Text
            size={10}
            semibold
            color={greys(theme)[200]}
            style={{ textAlign: 'center', lineHeight: 12 }}>
            {mintName}
          </Text>
        </VStack>
      </VStack>
    );
  },
  (prevProps, nextProps) => {
    // Only re-render if mintUrl or theme changes
    return (
      prevProps.mintUrl === nextProps.mintUrl &&
      prevProps.theme === nextProps.theme &&
      prevProps.isSource === nextProps.isSource
    );
  }
);

MintComponent.displayName = 'MintComponent';

interface Payload {
  pr: string;
  unit: string;
  amount: number;
  pubkey?: string;
  email?: string;
  lud16?: string;
  redirect?: string;
  selectedMint: string;
  selectedMintBalance?: { amount: number; unit: string };
}

const RouteB = () => {
  const ref = useSheetRef('lightning-mpp');
  const payload = useSheetPayload('lightning-mpp') as Payload | undefined;
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();

  const [isExecuting, setIsExecuting] = useState(false);
  const [progress, setProgress] = useState<{
    step: number;
    error: string | null;
    completed: boolean;
  }>({ step: 0, error: null, completed: false });

  // Define execution steps for MPP payment
  const executionSteps = useMemo(
    () => [
      { id: 'quote', label: 'Getting quote', icon: 'mdi:cash-sync' },
      { id: 'send', label: 'Sending payment', icon: 'ri:send-plane-2-fill' },
    ],
    []
  );

  const handleExecute = async () => {
    if (!payload) return;

    setIsExecuting(true);
    setProgress({ step: 0, error: null, completed: false });

    try {
      await executeMPPPayment(payload);
    } catch (error) {
      console.error('Execution error:', error);
      setProgress((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setIsExecuting(false);
    }
  };

  const executeMPPPayment = async (payload: Payload) => {
    // Step 1: Get melt quote
    setProgress({ step: 1, error: null, completed: false });

    const quoteRes = await getMeltQuote({
      pr: payload.pr,
      unit: payload.unit,
      mintUrl: payload.selectedMint,
    });

    if (quoteRes.isErr()) {
      setProgress({ step: 1, error: quoteRes.error.message, completed: false });
      throw quoteRes.error;
    }

    // Step 2: Send payment
    setProgress({ step: 2, error: null, completed: false });

    const sendRes = await sendLightning({
      mintUrl: payload.selectedMint,
      pr: payload.pr,
      unit: payload.unit,
      pubkey: payload.pubkey,
      meltQuote: quoteRes.value,
      email: payload.email,
      lud16: payload.lud16,
    });

    if (sendRes.isErr()) {
      setProgress({ step: 2, error: sendRes.error.message, completed: false });
      throw sendRes.error;
    }

    setProgress({ step: 2, error: null, completed: true });
  };

  const handleConfirm = () => {
    ref?.close({ confirmed: true });
  };

  const handleCancel = () => {
    ref?.close({ confirmed: false });
  };

  if (!payload) {
    return (
      <Wrapper>
        <View style={{ padding: 16, alignItems: 'center' }}>
          <Text>Invalid payload</Text>
        </View>
      </Wrapper>
    );
  }

  return (
    <Wrapper
      buttons={
        <ButtonHandler
          buttons={[
            {
              text: 'Cancel',
              variant: 'secondary' as const,
              onPress: handleCancel,
              disabled: isExecuting,
            },
            {
              text: progress.completed ? 'Done' : 'Execute',
              variant: 'primary' as const,
              onPress: progress.completed ? handleConfirm : handleExecute,
              loading: isExecuting,
              disabled: isExecuting && !progress.completed,
            },
          ]}
        />
      }>
      <ScrollView style={{ flex: 1 }}>
        <View style={{ padding: 16 }}>
          <Text weight="bold" size={24} color={greys(theme)[0]} style={{ marginBottom: 8 }}>
            MPP Payment Confirmation
          </Text>

          <Text color={greys(theme)[200]} style={{ marginBottom: 24 }}>
            Confirm the details of your multi-path payment
          </Text>

          {/* Payment Details */}
          <View
            style={{
              backgroundColor: greys(theme)[800],
              borderRadius: 12,
              padding: 16,
              marginBottom: 24,
            }}>
            <Text weight="semibold" color={greys(theme)[0]} style={{ marginBottom: 12 }}>
              Payment Details
            </Text>
            <HStack style={{ marginBottom: 8 }} justify="space-between">
              <Text color={greys(theme)[200]}>Amount:</Text>
              <Text color={greys(theme)[0]}>
                {payload.amount} {payload.unit.toUpperCase()}
              </Text>
            </HStack>
            {payload.pubkey && (
              <HStack justify="space-between">
                <Text color={greys(theme)[200]}>Recipient:</Text>
                <Text
                  color={greys(theme)[0]}
                  numberOfLines={1}
                  style={{ flex: 1, textAlign: 'right' }}>
                  {payload.pubkey.slice(0, 16)}...
                </Text>
              </HStack>
            )}
          </View>

          {/* Mint Selection */}
          <View
            style={{
              backgroundColor: greys(theme)[800],
              borderRadius: 12,
              padding: 16,
              marginBottom: 24,
            }}>
            <Text weight="semibold" color={greys(theme)[0]} style={{ marginBottom: 12 }}>
              Selected Mint
            </Text>
            <MintComponent mintUrl={payload.selectedMint} theme={theme} />
            {payload.selectedMintBalance && (
              <Text color={greys(theme)[200]} style={{ textAlign: 'center', marginTop: 8 }}>
                Balance: {payload.selectedMintBalance.amount}{' '}
                {payload.selectedMintBalance.unit.toUpperCase()}
              </Text>
            )}
          </View>

          {/* Execution Steps */}
          {isExecuting && (
            <View
              style={{
                backgroundColor: greys(theme)[800],
                borderRadius: 12,
                padding: 16,
                marginBottom: 24,
              }}>
              <Text weight="semibold" color={greys(theme)[0]} style={{ marginBottom: 16 }}>
                Execution Progress
              </Text>

              {executionSteps.map((step, index) => {
                const stepNumber = index + 1;
                const isCurrentStep = stepNumber === progress.step;
                const isCompleted = stepNumber < progress.step || progress.completed;
                const hasError = isCurrentStep && progress.error;

                return (
                  <HStack
                    key={step.id}
                    style={{
                      marginBottom: 12,
                      opacity: isCompleted ? 1 : isCurrentStep ? 1 : 0.5,
                    }}
                    align="center">
                    <View style={{ marginRight: 12 }}>
                      {isCompleted ? (
                        <Icon name="material-symbols:check-circle" size={20} color={greens[300]} />
                      ) : isCurrentStep ? (
                        hasError ? (
                          <Icon name="material-symbols:error" size={20} color={reds[300]} />
                        ) : (
                          <Spinner size="small" color={greys(theme)[0]} />
                        )
                      ) : (
                        <View
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 10,
                            backgroundColor: greys(theme)[600],
                          }}
                        />
                      )}
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text
                        color={hasError ? reds[300] : isCompleted ? greens[300] : greys(theme)[0]}
                        weight={isCurrentStep ? 'semibold' : 'normal'}>
                        {step.label}
                      </Text>
                      {hasError && (
                        <Text color={reds[300]} size={12} style={{ marginTop: 4 }}>
                          {progress.error}
                        </Text>
                      )}
                    </View>
                  </HStack>
                );
              })}
            </View>
          )}

          {/* Error Display */}
          {progress.error && !isExecuting && <Card message={progress.error} variant="warning" />}

          {/* Success Message */}
          {progress.completed && (
            <Card message="MPP payment completed successfully!" variant="success" />
          )}
        </View>
      </ScrollView>
    </Wrapper>
  );
};

export default RouteB;
