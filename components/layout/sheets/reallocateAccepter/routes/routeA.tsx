import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Switch, Animated, View as RNView } from 'react-native';

import { ButtonHandler } from 'components/common/ButtonHandler';
import { Text } from 'components/common/Text';
import { View, HStack, VStack } from 'components/common/View';
import { Spinner } from 'components/common/Spinner';
import { greens, greys, reds } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { memoizedGetMintInfo, memoizedGetBalance } from 'helper/redux/cashu/selectors';
import { useSelector } from 'react-redux';
import {
  RouteScreenProps,
  useSheetPayload,
  useSheetRef,
  ScrollView,
} from 'react-native-actions-sheet';
import Image from 'components/common/Image';
import Icon from 'assets/icons';
import Wrapper from 'components/layout/sheets/wrapper';
import Svg, { Circle } from 'react-native-svg';
import { Card } from 'components/common/Card';
import {
  checkLightningReceiveStatus,
  getMeltQuote,
  receiveLightning,
  sendLightning,
} from 'helper/cashuClient';
import { store } from 'helper/redux/store';

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

    // text styles are applied via Text props per rules

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

// Animated reallocation item that expands to show errors
const ReallocationItem = React.memo(
  ({
    reallocation,
    index,
    progress,
    theme,
    _hasError,
    reallocationProgress,
    isExecuting,
    executionSteps,
  }: {
    reallocation: any;
    index: number;
    progress: any;
    theme: any;
    _hasError: boolean;
    reallocationProgress: any;
    isExecuting: boolean;
    executionSteps: any[];
  }) => {
    // Animation for expanding error state
    const expandAnimation = useRef(new Animated.Value(0)).current;
    const errorOpacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      if (_hasError) {
        // Expand and show error
        Animated.parallel([
          Animated.timing(expandAnimation, {
            toValue: 1,
            duration: 300,
            useNativeDriver: false,
          }),
          Animated.timing(errorOpacity, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        // Collapse and hide error
        Animated.parallel([
          Animated.timing(expandAnimation, {
            toValue: 0,
            duration: 200,
            useNativeDriver: false,
          }),
          Animated.timing(errorOpacity, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }),
        ]).start();
      }
    }, [_hasError, errorOpacity, expandAnimation]);

    const containerStyle = useMemo(
      () => ({
        marginBottom: 12,
        paddingHorizontal: 10,
        paddingVertical: 12,
        backgroundColor: greys(theme)[700],
        borderRadius: 14,
        borderWidth: 1,
        borderColor: greys(theme)[600],
      }),
      [theme]
    );

    const errorContainerHeight = expandAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 60],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View style={containerStyle}>
        {/* Main row with mints and transfer info */}
        <HStack align="center" justify="space-between">
          {/* Source Mint */}
          <MintComponent mintUrl={reallocation.fromMint} isSource={true} theme={theme} />

          {/* Transfer Info */}
          <VStack
            align="center"
            justify="center"
            style={{
              marginHorizontal: 6,
              paddingVertical: 8,
            }}>
            {/* Arrow Circle */}
            <ReallocationArrow
              reallocationIndex={index}
              reallocationProgress={reallocationProgress}
              isExecuting={isExecuting}
              theme={theme}
              executionSteps={executionSteps}
            />

            {/* Amount Above */}
            {(() => {
              const amountTextColor = progress?.completed
                ? greens[300]
                : progress?.error
                  ? reds[300]
                  : greys(theme)[0];
              return (
                <Text
                  size={12}
                  bold
                  color={amountTextColor}
                  style={{ textAlign: 'center', marginTop: 3 }}>
                  {reallocation.amount} {reallocation.unit.toUpperCase()}
                </Text>
              );
            })()}

            {/* Percentage Below */}
            <Text bold size={10} color={greys(theme)[300]} style={{ textAlign: 'center' }}>
              +{reallocation.percentage.toFixed(1)}%
            </Text>
          </VStack>

          {/* Destination Mint */}
          <MintComponent mintUrl={reallocation.toMint} isSource={false} theme={theme} />
        </HStack>

        {/* Animated error container */}
        {_hasError && (
          <Animated.View
            style={{
              height: errorContainerHeight,
              overflow: 'hidden',
              marginTop: 12,
            }}>
            <Animated.View
              style={{
                opacity: errorOpacity,
                marginHorizontal: 10,
                marginBottom: 8,
              }}>
              <Card message={progress?.error} variant="warning"></Card>
            </Animated.View>
          </Animated.View>
        )}
      </Animated.View>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.index === nextProps.index &&
      prevProps._hasError === nextProps._hasError &&
      prevProps.progress?.step === nextProps.progress?.step &&
      prevProps.progress?.completed === nextProps.progress?.completed &&
      prevProps.progress?.error === nextProps.progress?.error
    );
  }
);

ReallocationItem.displayName = 'ReallocationItem';

// MPP Allocation Item component
const MPPAllocationItem = React.memo(
  ({
    allocation,
    index,
    progress,
    theme,
    _hasError,
    reallocationProgress,
    isExecuting,
    executionSteps,
    unit,
  }: {
    allocation: any;
    index: number;
    progress: any;
    theme: any;
    _hasError: boolean;
    reallocationProgress: any;
    isExecuting: boolean;
    executionSteps: any[];
    unit: string;
  }) => {
    // Animation for expanding error state
    const expandAnimation = useRef(new Animated.Value(0)).current;
    const errorOpacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      if (_hasError) {
        // Expand and show error
        Animated.parallel([
          Animated.timing(expandAnimation, {
            toValue: 1,
            duration: 300,
            useNativeDriver: false,
          }),
          Animated.timing(errorOpacity, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        // Collapse and hide error
        Animated.parallel([
          Animated.timing(expandAnimation, {
            toValue: 0,
            duration: 200,
            useNativeDriver: false,
          }),
          Animated.timing(errorOpacity, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }),
        ]).start();
      }
    }, [_hasError, errorOpacity, expandAnimation]);

    const containerStyle = useMemo(
      () => ({
        marginBottom: 12,
        paddingHorizontal: 10,
        paddingVertical: 12,
        backgroundColor: greys(theme)[700],
        borderRadius: 14,
        borderWidth: 1,
        borderColor: greys(theme)[600],
      }),
      [theme]
    );

    const errorContainerHeight = expandAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 60],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View style={containerStyle}>
        {/* Main row with mint and allocation info */}
        <HStack align="center" justify="space-between">
          {/* Mint */}
          <MintComponent mintUrl={allocation.mintUrl} theme={theme} />

          {/* Allocation Info */}
          <VStack
            align="center"
            justify="center"
            style={{
              marginHorizontal: 6,
              paddingVertical: 8,
            }}>
            {/* Arrow Circle */}
            <ReallocationArrow
              reallocationIndex={index}
              reallocationProgress={reallocationProgress}
              isExecuting={isExecuting}
              theme={theme}
              executionSteps={executionSteps}
            />

            {/* Amount Above */}
            {(() => {
              const amountTextColor = progress?.completed
                ? greens[300]
                : progress?.error
                  ? reds[300]
                  : greys(theme)[0];
              return (
                <Text
                  size={12}
                  bold
                  color={amountTextColor}
                  style={{ textAlign: 'center', marginTop: 3 }}>
                  {allocation.amount} {unit?.toUpperCase() || 'SAT'}
                </Text>
              );
            })()}

            {/* Percentage Below */}
            <Text bold size={10} color={greys(theme)[300]} style={{ textAlign: 'center' }}>
              {allocation.percentage.toFixed(1)}%
            </Text>
          </VStack>

          {/* Empty space for symmetry */}
          <View style={{ width: 90 }} />
        </HStack>

        {/* Animated error container */}
        {_hasError && (
          <Animated.View
            style={{
              height: errorContainerHeight,
              overflow: 'hidden',
              marginTop: 12,
            }}>
            <Animated.View
              style={{
                opacity: errorOpacity,
                marginHorizontal: 10,
                marginBottom: 8,
              }}>
              <Card message={progress?.error} variant="warning"></Card>
            </Animated.View>
          </Animated.View>
        )}
      </Animated.View>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.index === nextProps.index &&
      prevProps._hasError === nextProps._hasError &&
      prevProps.progress?.step === nextProps.progress?.step &&
      prevProps.progress?.completed === nextProps.progress?.completed &&
      prevProps.progress?.error === nextProps.progress?.error
    );
  }
);

MPPAllocationItem.displayName = 'MPPAllocationItem';

// Progress component for individual reallocation arrows
const ReallocationArrow = React.memo(
  ({
    reallocationIndex,
    reallocationProgress,
    isExecuting,
    theme,
    executionSteps,
  }: {
    reallocationIndex: number;
    reallocationProgress: any;
    isExecuting: boolean;
    theme: any;
    executionSteps: any[];
  }) => {
    const progress = reallocationProgress[reallocationIndex];
    const isActive = isExecuting && progress && !progress.completed && !progress.error;
    const isCompleted = progress?.completed;
    const _hasError = progress?.error;

    // Animation values
    const animatedScale = useRef(new Animated.Value(1)).current;
    const animatedOpacity = useRef(new Animated.Value(0)).current;
    const pulseAnimation = useRef(new Animated.Value(1)).current;

    // Memoize colors to prevent recalculation
    const arrowColor = useMemo(() => greys(theme)[400], [theme]);

    // Memoize icon components to prevent re-creation
    const errorIcon = useMemo(
      () => <Icon name="material-symbols:close-rounded" size={24} color={reds[300]} />,
      []
    );
    const successIcon = useMemo(
      () => <Icon name="material-symbols:check-rounded" size={24} color={greens[300]} />,
      []
    );
    const arrowIcon = useMemo(
      () => <Icon name="lucide:arrow-right" size={24} color={arrowColor} />,
      [arrowColor]
    );
    const spinner = useMemo(() => <Spinner size={16} />, []);

    // Animate progress when it changes - track previous step to only animate on actual changes
    const prevStepRef = useRef(progress?.step);
    useEffect(() => {
      if (progress) {
        // Immediate opacity change
        animatedOpacity.setValue(1);

        // Only trigger scale animation if the step actually changed for THIS arrow
        if (prevStepRef.current !== progress.step) {
          Animated.sequence([
            Animated.timing(animatedScale, {
              toValue: 1.1,
              duration: 150,
              useNativeDriver: true,
            }),
            Animated.timing(animatedScale, {
              toValue: 1,
              duration: 150,
              useNativeDriver: true,
            }),
          ]).start();
        }
        prevStepRef.current = progress.step;
      } else {
        // Reset when not executing
        animatedScale.setValue(1);
        animatedOpacity.setValue(0);
        pulseAnimation.setValue(1);
        prevStepRef.current = undefined;
      }
    }, [progress, animatedOpacity, animatedScale, pulseAnimation]);

    // Separate effect for pulse animation to avoid conflicts
    useEffect(() => {
      if (isActive && progress && !progress.completed && !progress.error) {
        const pulseLoop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnimation, {
              toValue: 1.05,
              duration: 600,
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnimation, {
              toValue: 1,
              duration: 600,
              useNativeDriver: true,
            }),
          ])
        );
        pulseLoop.start();

        return () => {
          pulseLoop.stop();
          pulseAnimation.setValue(1);
        };
      } else {
        pulseAnimation.setValue(1);
      }
    }, [isActive, progress, pulseAnimation]);

    // Progress state
    const size = 36;
    const strokeWidth = 2;
    const radius = (size - strokeWidth) / 2;
    const progressRadius = radius - 1; // Make progress circle 2px smaller in diameter
    const circumference = 2 * Math.PI * progressRadius;

    return (
      <Animated.View
        style={{
          position: 'relative',
          width: size,
          height: size,
          transform: [{ scale: animatedScale }, { scale: pulseAnimation }],
        }}>
        <Svg width={size} height={size}>
          {/* Background circle */}
          <Circle
            stroke={greys(theme)[600]}
            fill="none"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={strokeWidth}
          />
        </Svg>

        {/* Animated progress circle */}
        {(isCompleted || isActive || progress) && (
          <Animated.View
            style={{
              position: 'absolute',
              opacity: animatedOpacity,
            }}>
            <Svg width={size} height={size}>
              <Circle
                stroke={_hasError ? reds[300] : isCompleted ? greens[300] : theme.shades[200]}
                fill="none"
                cx={size / 2}
                cy={size / 2}
                r={progressRadius}
                strokeWidth={strokeWidth}
                strokeDasharray={`${circumference} ${circumference}`}
                strokeDashoffset={
                  isCompleted
                    ? 0
                    : circumference * (1 - (progress?.step || 0) / executionSteps.length)
                }
                strokeLinecap="round"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            </Svg>
          </Animated.View>
        )}

        {/* Icon overlay */}
        <Animated.View
          style={{
            position: 'absolute',
            width: size,
            height: size,
            opacity: isExecuting ? 1 : 0.8,
          }}>
          <VStack align="center" justify="center" style={{ width: size, height: size }}>
            {_hasError ? errorIcon : isActive ? spinner : isCompleted ? successIcon : arrowIcon}
          </VStack>
        </Animated.View>
      </Animated.View>
    );
  },
  (prevProps, nextProps) => {
    // Only re-render if the reallocationIndex changes or relevant progress changes
    return (
      prevProps.reallocationIndex === nextProps.reallocationIndex &&
      prevProps.isExecuting === nextProps.isExecuting &&
      prevProps.reallocationProgress[prevProps.reallocationIndex]?.step ===
        nextProps.reallocationProgress[nextProps.reallocationIndex]?.step &&
      prevProps.reallocationProgress[prevProps.reallocationIndex]?.completed ===
        nextProps.reallocationProgress[nextProps.reallocationIndex]?.completed &&
      prevProps.reallocationProgress[prevProps.reallocationIndex]?.error ===
        nextProps.reallocationProgress[nextProps.reallocationIndex]?.error
    );
  }
);

ReallocationArrow.displayName = 'ReallocationArrow';

// eslint-disable-next-line no-empty-pattern
function RouteA({}: RouteScreenProps<'reallocate-accepter', 'route-a'>) {
  const theme = useSelector(memoizedGetTheme);
  const ref = useSheetRef('reallocate-accepter');
  const payload = useSheetPayload('reallocate-accepter');

  const [ignoreDust, setIgnoreDust] = useState(payload.ignoreDust ?? true);
  const DUST_PERCENTAGE = 2; // 2% of total balance

  // Progress tracking state
  const [isExecuting, setIsExecuting] = useState(false);
  const [reallocationProgress, setReallocationProgress] = useState<{
    [index: number]: {
      step: number;
      error: string | null;
      completed: boolean;
    };
  }>({});
  const [hasCompletedSuccessfully, setHasCompletedSuccessfully] = useState(false);

  // Refs for auto-scrolling to current item
  const scrollViewRef = useRef<any>(null);
  const itemRefs = useRef<{ [key: number]: RNView | null }>({});

  // Define execution steps based on mode
  const executionSteps = useMemo(() => {
    if (payload.mode === 'mpp') {
      return [
        { id: 'quote', label: 'Getting quote', icon: 'mdi:cash-sync' },
        { id: 'send', label: 'Sending payment', icon: 'ri:send-plane-2-fill' },
      ];
    } else {
      return [
        { id: 'receive', label: 'Generating receive invoice', icon: 'iconamoon:send-fill' },
        { id: 'quote', label: 'Quoting fees', icon: 'mdi:cash-sync' },
        { id: 'send', label: 'Sending funds', icon: 'ri:send-plane-2-fill' },
        { id: 'status', label: 'Confirming payment', icon: 'humbleicons:refresh' },
      ];
    }
  }, [payload.mode]);

  // Calculate dynamic dust threshold based on total balance
  const dustThreshold = useMemo(() => {
    const totalAmount = payload.totalAmount || payload.amount || 0;
    return (totalAmount * DUST_PERCENTAGE) / 100;
  }, [payload.totalAmount, payload.amount, DUST_PERCENTAGE]);

  // Filter reallocations based on ignore dust setting
  const filteredReallocations = useMemo(() => {
    if (payload.mode === 'mpp') {
      // For MPP mode, use mppAllocations instead of reallocations
      return payload.mppAllocations || [];
    }
    if (!ignoreDust) {
      return payload.reallocations || [];
    }
    return (payload.reallocations || []).filter(
      (reallocation) => reallocation.amount > dustThreshold
    );
  }, [payload.reallocations, payload.mppAllocations, payload.mode, ignoreDust, dustThreshold]);

  // Separate arrays for type safety
  const mppAllocations = payload.mode === 'mpp' ? payload.mppAllocations || [] : [];
  const reallocations = payload.mode !== 'mpp' ? payload.reallocations || [] : [];

  // Calculate filtered total amount
  const filteredTotalAmount = useMemo(() => {
    return filteredReallocations.reduce((sum, reallocation) => sum + reallocation.amount, 0);
  }, [filteredReallocations]);

  // Scroll to the current item being processed
  const scrollToItem = (index: number) => {
    // Use setTimeout to make this non-blocking and allow React to update first
    setTimeout(() => {
      const itemRef = itemRefs.current[index];
      if (itemRef && scrollViewRef.current) {
        try {
          // Use measureLayout to get the item's position relative to the scroll container
          itemRef.measureLayout(
            scrollViewRef.current.getInnerViewNode(),
            (_x: number, y: number, _width: number, _height: number) => {
              // Check if scrollTo method exists and call it
              if (scrollViewRef.current && scrollViewRef.current.scrollTo) {
                scrollViewRef.current.scrollTo({
                  y: Math.max(0, y - 50), // Add some padding above the item
                  animated: true,
                });
              }
            },
            () => {
              // Fallback with estimated position
              if (scrollViewRef.current && scrollViewRef.current.scrollTo) {
                scrollViewRef.current.scrollTo({
                  y: index * 120, // Estimated height per item
                  animated: true,
                });
              }
            }
          );
        } catch {
          // Final fallback with estimated position
          if (scrollViewRef.current && scrollViewRef.current.scrollTo) {
            scrollViewRef.current.scrollTo({
              y: index * 120,
              animated: true,
            });
          }
        }
      }
    }, 100); // Small delay to ensure DOM is updated
  };

  // Execute MPP payment process
  const executeMPPPayment = async () => {
    setIsExecuting(true);

    // Start fresh - completely reset state
    setReallocationProgress({});
    setHasCompletedSuccessfully(false);

    // Add a small delay to ensure state updates are processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      let hadAnyError = false;
      // Process each mint allocation sequentially
      for (let i = 0; i < mppAllocations.length; i++) {
        const allocation = mppAllocations[i];

        // Initialize progress for this allocation
        setReallocationProgress((prev) => ({
          ...prev,
          [i]: { step: 0, error: null, completed: false },
        }));

        // Add a small delay to ensure state is updated
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Scroll to the current item being processed
        scrollToItem(i);

        // Step 1: Get melt quote
        setReallocationProgress((prev) => ({
          ...prev,
          [i]: { step: 1, error: null, completed: false },
        }));

        const quoteRes = await getMeltQuote({
          pr: payload.pr!,
          unit: payload.unit,
          mintUrl: allocation.mintUrl,
          mppAmount: allocation.amount,
        });

        if (quoteRes.isErr()) {
          setReallocationProgress((prev) => ({
            ...prev,
            [i]: {
              step: 1,
              error: quoteRes.error?.message || 'Failed to get quote',
              completed: false,
            },
          }));
          hadAnyError = true;
          continue;
        }

        // Step 2: Send payment
        setReallocationProgress((prev) => ({
          ...prev,
          [i]: { step: 2, error: null, completed: false },
        }));

        const sendRes = await sendLightning({
          mintUrl: allocation.mintUrl,
          pr: payload.pr!,
          unit: payload.unit,
          pubkey: payload.pubkey,
          meltQuote: quoteRes.value,
          email: payload.email,
          lud16: payload.lud16,
        });

        if (sendRes.isErr()) {
          setReallocationProgress((prev) => ({
            ...prev,
            [i]: {
              step: 2,
              error: sendRes.error?.message || 'Failed to send payment',
              completed: false,
            },
          }));
          hadAnyError = true;
          continue;
        }

        // Mark as completed
        setReallocationProgress((prev) => ({
          ...prev,
          [i]: { step: 2, error: null, completed: true },
        }));

        // Brief pause to show completion
        await new Promise((resolve) => setTimeout(resolve, 400));
      }

      if (!hadAnyError) {
        setHasCompletedSuccessfully(true);
      }
    } catch (error) {
      console.error('MPP execution error:', error);
    } finally {
      setIsExecuting(false);
    }
  };

  // Execute reallocation process for each reallocation
  const executeReallocation = async () => {
    setIsExecuting(true);

    // Start fresh - completely reset state
    setReallocationProgress({});
    setHasCompletedSuccessfully(false);

    // Add a small delay to ensure state updates are processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      let hadAnyError = false;
      // Process each reallocation sequentially
      for (let i = 0; i < reallocations.length; i++) {
        const reallocation = reallocations[i];

        // Initialize progress for this reallocation
        setReallocationProgress((prev) => ({
          ...prev,
          [i]: { step: 0, error: null, completed: false },
        }));

        // Add a small delay to ensure state is updated
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Scroll to the current item being processed
        scrollToItem(i);

        // Step 1: Generate receive invoice on destination mint
        setReallocationProgress((prev) => ({
          ...prev,
          [i]: { step: 1, error: null, completed: false },
        }));

        const receiveResult = await receiveLightning({
          amount: reallocation.amount,
          unit: reallocation.unit,
          memo: `Reallocation from ${reallocation.fromMint} to ${reallocation.toMint}`,
          mintUrl: reallocation.toMint, // Use the destination mint
          batchId,
        });
        if (receiveResult.isErr()) {
          setReallocationProgress((prev) => ({
            ...prev,
            [i]: {
              step: 1,
              error: receiveResult.error?.message || 'Failed to generate invoice',
              completed: false,
            },
          }));
          hadAnyError = true;
          // Continue to next reallocation
          continue;
        }
        let pr = receiveResult.value.request;
        // Brief pause to show step progress
        await new Promise((resolve) => setTimeout(resolve, 400));

        // Step 2: Get melt quote from source mint and verify balance against fees
        setReallocationProgress((prev) => ({
          ...prev,
          [i]: { step: 2, error: null, completed: false },
        }));

        const meltQuoteRes = await getMeltQuote({
          pr,
          unit: reallocation.unit,
          mintUrl: reallocation.fromMint,
        });
        if (meltQuoteRes.isErr()) {
          setReallocationProgress((prev) => ({
            ...prev,
            [i]: {
              step: 2,
              error: meltQuoteRes.error?.message || 'Failed to get quote',
              completed: false,
            },
          }));
          hadAnyError = true;
          continue;
        }
        let meltQuote = meltQuoteRes.value;
        const sourceBalance = memoizedGetBalance(
          reallocation.unit,
          reallocation.fromMint
        )(store.getState());
        let totalDebit = Number(meltQuote.amount) + Number(meltQuote.fee_reserve);
        if (typeof sourceBalance === 'number' && totalDebit > sourceBalance) {
          // Adjust: try to reduce invoice amount to fit balance accounting for fee reserve
          const adjustedAmount = Math.floor(Number(sourceBalance) - Number(meltQuote.fee_reserve));
          if (adjustedAmount <= 0) {
            setReallocationProgress((prev) => ({
              ...prev,
              [i]: {
                step: 2,
                error: 'Insufficient balance to cover network fee',
                completed: false,
              },
            }));
            hadAnyError = true;
            continue;
          }

          const adjustedReceive = await receiveLightning({
            amount: adjustedAmount,
            unit: reallocation.unit,
            memo: `Reallocation from ${reallocation.fromMint} to ${reallocation.toMint}`,
            mintUrl: reallocation.toMint,
            batchId,
          });
          if (adjustedReceive.isErr()) {
            setReallocationProgress((prev) => ({
              ...prev,
              [i]: {
                step: 2,
                error: adjustedReceive.error?.message || 'Failed to adjust invoice',
                completed: false,
              },
            }));
            hadAnyError = true;
            continue;
          }
          const pr2 = adjustedReceive.value.request;
          const meltQuoteRes2 = await getMeltQuote({
            pr: pr2,
            unit: reallocation.unit,
            mintUrl: reallocation.fromMint,
          });
          if (meltQuoteRes2.isErr()) {
            setReallocationProgress((prev) => ({
              ...prev,
              [i]: {
                step: 2,
                error: meltQuoteRes2.error?.message || 'Failed to get adjusted quote',
                completed: false,
              },
            }));
            hadAnyError = true;
            continue;
          }
          meltQuote = meltQuoteRes2.value;
          totalDebit = Number(meltQuote.amount) + Number(meltQuote.fee_reserve);
          if (totalDebit > sourceBalance) {
            setReallocationProgress((prev) => ({
              ...prev,
              [i]: {
                step: 2,
                error: 'Insufficient balance after adjustment',
                completed: false,
              },
            }));
            hadAnyError = true;
            continue;
          }
          // Use adjusted pr for sending
          pr = pr2;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));

        // Step 3: Send from source mint using melt quote
        setReallocationProgress((prev) => ({
          ...prev,
          [i]: { step: 3, error: null, completed: false },
        }));

        const sendRes = await sendLightning({
          pr,
          unit: reallocation.unit,
          meltQuote,
          mintUrl: reallocation.fromMint,
          batchId,
        });
        if (sendRes.isErr()) {
          setReallocationProgress((prev) => ({
            ...prev,
            [i]: { step: 3, error: sendRes.error?.message || 'Failed to send', completed: false },
          }));
          hadAnyError = true;
          continue;
        }

        // Step 4: Check status on destination mint until paid (single check here)
        setReallocationProgress((prev) => ({
          ...prev,
          [i]: { step: 4, error: null, completed: false },
        }));

        const statusRes = await checkLightningReceiveStatus({
          unit: reallocation.unit,
          mintUrl: reallocation.toMint,
          amount: reallocation.amount,
          quote: receiveResult.value.mintQuote.quote,
          request: receiveResult.value.request,
        });
        if (statusRes.isErr()) {
          setReallocationProgress((prev) => ({
            ...prev,
            [i]: {
              step: 4,
              error: statusRes.error?.message || 'Failed to confirm',
              completed: false,
            },
          }));
          hadAnyError = true;
          continue;
        }

        // Completed
        setReallocationProgress((prev) => ({
          ...prev,
          [i]: { step: 4, error: null, completed: true },
        }));
        await new Promise((resolve) => setTimeout(resolve, 400));

        // Backoff between mints to avoid throttling
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // All transactions processed; mark success if no errors occurred
      setIsExecuting(false);
      if (!hadAnyError) {
        setHasCompletedSuccessfully(true);
      }

      // Close modal after brief delay
      setTimeout(() => {
        ref.current.hide({
          confirmed: true,
          ignoreDust,
        });
      }, 1500);
    } catch (err) {
      console.error('Unexpected error in executeReallocation:', err);
      setIsExecuting(false);
    }
  };

  return (
    <Wrapper
      buttons={
        <ButtonHandler
          context="sheet"
          buttons={[
            {
              text: 'Cancel',
              variant: 'secondary',
              onPress: async () => {
                ref.current.hide({
                  confirmed: false,
                  ignoreDust,
                });
              },
              disabled: isExecuting || hasCompletedSuccessfully,
            },
            {
              text: payload.mode === 'mpp' ? 'Send Payment' : 'Confirm',
              variant: 'primary',
              onPress: payload.mode === 'mpp' ? executeMPPPayment : executeReallocation,
              disabled:
                hasCompletedSuccessfully ||
                (payload.mode === 'mpp' ? mppAllocations.length === 0 : reallocations.length === 0),
              loading: isExecuting,
            },
          ]}
        />
      }>
      <View style={{ flex: 1 }}>
        {/* Ignore Dust Toggle - only show for reallocation mode */}
        {payload.mode !== 'mpp' && (
          <View
            style={{
              flex: 1,
            }}>
            <Text
              size={20}
              heavy
              color={greys(theme)[0]}
              style={{
                textAlign: 'center',
                marginBottom: 16,
              }}>
              {isExecuting
                ? payload.mode === 'mpp'
                  ? 'Processing MPP Payment'
                  : 'Processing Reallocation'
                : payload.mode === 'mpp'
                  ? 'Confirm MPP Payment'
                  : 'Confirm Reallocation'}
            </Text>
            <HStack
              align="center"
              justify="space-between"
              style={{
                paddingHorizontal: 16,
                paddingVertical: 12,
                backgroundColor: greys(theme)[700],
                borderRadius: 14,
                marginBottom: 16,
                borderWidth: 1,
                borderColor: greys(theme)[600],
              }}>
              <View style={{ flex: 1 }}>
                <Text
                  size={14}
                  semibold
                  color={greys(theme)[0]}
                  style={{
                    marginBottom: 2,
                  }}>
                  Ignore Dust (recommended)
                </Text>
                <Text size={12} regular color={greys(theme)[300]}>
                  Skip transactions under 2% of total ({Math.round(dustThreshold)}{' '}
                  {payload.unit.toUpperCase()})
                </Text>
              </View>
              <Switch
                value={ignoreDust}
                onValueChange={setIgnoreDust}
                trackColor={{
                  false: greys(theme)[600],
                  true: theme.shades[200] + '40',
                }}
                thumbColor={ignoreDust ? theme.shades[200] : greys(theme)[400]}
              />
            </HStack>
          </View>
        )}

        {/* Reallocation Details */}
        <View style={{ marginBottom: 12 }}>
          {(payload.mode === 'mpp' ? mppAllocations.length === 0 : reallocations.length === 0) ? (
            <View
              style={{
                paddingHorizontal: 16,
                paddingVertical: 24,
                backgroundColor: greys(theme)[700],
                borderRadius: 14,
                borderWidth: 1,
                borderColor: greys(theme)[600],
              }}>
              <VStack align="center" gap={8}>
                <Icon name="mdi:cancel" size={24} color={greys(theme)[400]} />
                <Text
                  size={14}
                  bold
                  color={greys(theme)[300]}
                  style={{
                    textAlign: 'center',
                  }}>
                  All transactions filtered out as dust
                </Text>
                <Text
                  size={12}
                  regular
                  color={greys(theme)[400]}
                  style={{
                    textAlign: 'center',
                  }}>
                  No reallocations needed under current settings
                </Text>
              </VStack>
            </View>
          ) : (
            <ScrollView
              ref={scrollViewRef}
              style={{ maxHeight: 400 }}
              showsVerticalScrollIndicator={false}>
              {(payload.mode === 'mpp' ? mppAllocations : reallocations).map((item, index) => {
                const _hasError = !!reallocationProgress[index]?.error;

                return (
                  <View
                    key={index}
                    ref={(ref) => {
                      itemRefs.current[index] = ref;
                    }}
                    collapsable={false}>
                    {payload.mode === 'mpp' ? (
                      <MPPAllocationItem
                        allocation={item}
                        index={index}
                        progress={reallocationProgress[index]}
                        theme={theme}
                        _hasError={_hasError}
                        reallocationProgress={reallocationProgress}
                        isExecuting={isExecuting}
                        executionSteps={executionSteps}
                        unit={payload.unit}
                      />
                    ) : (
                      <ReallocationItem
                        reallocation={item}
                        index={index}
                        progress={reallocationProgress[index]}
                        theme={theme}
                        _hasError={_hasError}
                        reallocationProgress={reallocationProgress}
                        isExecuting={isExecuting}
                        executionSteps={executionSteps}
                      />
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* Total Summary */}
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: greys(theme)[600],
            borderRadius: 14,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: greys(theme)[500],
          }}>
          <HStack align="center" gap={8}>
            <Icon name="fluent:arrow-swap-16-filled" size={16} color={greys(theme)[200]} />
            <Text size={14} semibold color={greys(theme)[0]}>
              Total:
            </Text>
            <Text size={14} bold color={theme.shades[200]}>
              {filteredTotalAmount} {payload.unit.toUpperCase()}
            </Text>
          </HStack>

          {/* Show filtered transactions info - only for reallocation mode */}
          {payload.mode !== 'mpp' &&
            ignoreDust &&
            (payload.reallocations?.length || 0) !== reallocations.length && (
              <Text
                size={11}
                regular
                color={greys(theme)[300]}
                style={{
                  textAlign: 'center',
                  marginTop: 6,
                }}>
                {(payload.reallocations?.length || 0) - reallocations.length} dust transaction
                {(payload.reallocations?.length || 0) - reallocations.length !== 1 ? 's' : ''}{' '}
                filtered
              </Text>
            )}
        </View>
      </View>
    </Wrapper>
  );
}

export default RouteA;
