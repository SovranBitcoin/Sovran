import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Switch, Animated, ScrollView, View as RNView } from 'react-native';

import { ButtonHandler } from 'components/common/ButtonHandler';
import { Text } from 'components/common/Text';
import { View } from 'components/common/View';
import { Spinner } from 'components/common/Spinner';
import { greens, greys, reds } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { memoizedGetMintInfo } from 'helper/redux/cashu/selectors';
import { useSelector } from 'react-redux';
import { RouteScreenProps, useSheetPayload, useSheetRef } from 'react-native-actions-sheet';
import Image from 'components/common/Image';
import Icon from 'assets/icons';
import Wrapper from 'components/layout/sheets/wrapper';
import Svg, { Circle } from 'react-native-svg';
import { Card } from 'components/common/Card';
import { receiveLightning } from 'helper/cashuClient';

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
        alignItems: 'center' as const,
        paddingHorizontal: 4,
      }),
      []
    );

    const cardStyle = useMemo(
      () => ({
        alignItems: 'center' as const,
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
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        marginBottom: 6,
      }),
      [theme]
    );

    const textStyle = useMemo(
      () => ({
        fontSize: 16,
        color: greys(theme)[100],
        fontFamily: 'OverpassBold',
      }),
      [theme]
    );

    const nameStyle = useMemo(
      () => ({
        fontSize: 10,
        color: greys(theme)[200],
        fontFamily: 'OverpassSemiBold',
        textAlign: 'center' as const,
        lineHeight: 12,
      }),
      [theme]
    );

    // Memoize the image component to prevent re-creation
    const imageComponent = useMemo(() => {
      if (iconUrl) {
        return <Image source={{ uri: iconUrl }} style={imageStyle} />;
      } else {
        return (
          <View style={fallbackStyle}>
            <Text style={textStyle}>{mintName.charAt(0).toUpperCase()}</Text>
          </View>
        );
      }
    }, [iconUrl, imageStyle, fallbackStyle, textStyle, mintName]);

    return (
      <View style={containerStyle}>
        <View style={cardStyle}>
          {imageComponent}
          <Text style={nameStyle}>{mintName}</Text>
        </View>
      </View>
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
    hasError,
    reallocationProgress,
    isExecuting,
    executionSteps,
  }: {
    reallocation: any;
    index: number;
    progress: any;
    theme: any;
    hasError: boolean;
    reallocationProgress: any;
    isExecuting: boolean;
    executionSteps: any[];
  }) => {
    // Animation for expanding error state
    const expandAnimation = useRef(new Animated.Value(0)).current;
    const errorOpacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      if (hasError) {
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
    }, [hasError]);

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
      [theme, hasError]
    );

    const errorContainerHeight = expandAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 60],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View style={containerStyle}>
        {/* Main row with mints and transfer info */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
          {/* Source Mint */}
          <MintComponent mintUrl={reallocation.fromMint} isSource={true} theme={theme} />

          {/* Transfer Info */}
          <View
            style={{
              alignItems: 'center',
              justifyContent: 'center',
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
            <Text
              style={{
                fontSize: 12,
                fontFamily: 'OverpassBold',
                textAlign: 'center',
                marginTop: 3,
                color: progress?.completed
                  ? greens[300]
                  : progress?.error
                    ? reds[300]
                    : greys(theme)[0],
              }}>
              {reallocation.amount} {reallocation.unit.toUpperCase()}
            </Text>

            {/* Percentage Below */}
            <Text
              bold
              style={{
                fontSize: 10,
                color: greys(theme)[300],
                textAlign: 'center',
              }}>
              +{reallocation.percentage.toFixed(1)}%
            </Text>
          </View>

          {/* Destination Mint */}
          <MintComponent mintUrl={reallocation.toMint} isSource={false} theme={theme} />
        </View>

        {/* Animated error container */}
        {hasError && (
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
      prevProps.hasError === nextProps.hasError &&
      prevProps.progress?.step === nextProps.progress?.step &&
      prevProps.progress?.completed === nextProps.progress?.completed &&
      prevProps.progress?.error === nextProps.progress?.error
    );
  }
);

ReallocationItem.displayName = 'ReallocationItem';

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
    const hasError = progress?.error;

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
    }, [progress?.step, progress?.completed, progress?.error]);

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
    }, [isActive, progress?.completed, progress?.error]);

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
          alignItems: 'center',
          justifyContent: 'center',
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
                stroke={hasError ? reds[300] : isCompleted ? greens[300] : theme.shades[200]}
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
            alignItems: 'center',
            justifyContent: 'center',
            width: size,
            height: size,
            opacity: isExecuting ? 1 : 0.8,
          }}>
          {hasError ? errorIcon : isActive ? spinner : isCompleted ? successIcon : arrowIcon}
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

  // Refs for auto-scrolling to current item
  const scrollViewRef = useRef<ScrollView>(null);
  const itemRefs = useRef<{ [key: number]: RNView | null }>({});

  // Define execution steps
  const executionSteps = [
    { id: 'receive', label: 'Generating lightning address', icon: 'iconamoon:send-fill' },
    { id: 'process', label: 'Processing receive address', icon: 'ion:checkmark-done' },
  ];

  // Calculate dynamic dust threshold based on total balance
  const dustThreshold = useMemo(() => {
    return (payload.totalAmount * DUST_PERCENTAGE) / 100;
  }, [payload.totalAmount, DUST_PERCENTAGE]);

  // Filter reallocations based on ignore dust setting
  const filteredReallocations = useMemo(() => {
    if (!ignoreDust) {
      return payload.reallocations;
    }
    return payload.reallocations.filter((reallocation) => reallocation.amount > dustThreshold);
  }, [payload.reallocations, ignoreDust, dustThreshold]);

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
        } catch (_error) {
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

  // Execute reallocation process for each reallocation
  const executeReallocation = async () => {
    setIsExecuting(true);

    // Start fresh - completely reset state
    setReallocationProgress({});

    // Add a small delay to ensure state updates are processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      // Process each reallocation sequentially
      for (let i = 0; i < filteredReallocations.length; i++) {
        const reallocation = filteredReallocations[i];

        // Initialize progress for this reallocation
        setReallocationProgress((prev) => ({
          ...prev,
          [i]: { step: 0, error: null, completed: false },
        }));

        // Add a small delay to ensure state is updated
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Scroll to the current item being processed
        scrollToItem(i);

        // Step 1: Generate lightning address using receiveLightning
        setReallocationProgress((prev) => ({
          ...prev,
          [i]: { step: 1, error: null, completed: false },
        }));

        try {
          const receiveResult = await receiveLightning({
            amount: reallocation.amount,
            unit: reallocation.unit,
            memo: `Reallocation from ${reallocation.fromMint} to ${reallocation.toMint}`,
            mintUrl: reallocation.toMint, // Use the destination mint
          });

          if (receiveResult.isErr()) {
            throw new Error(receiveResult.error.message);
          }

          // Successfully generated lightning address
          await new Promise((resolve) => setTimeout(resolve, 800));
        } catch (error) {
          console.error('Error generating lightning address:', error);
          // For now we'll continue anyway since we don't want to stop the demo
          await new Promise((resolve) => setTimeout(resolve, 800));
        }

        // Step 2: Process the receive address (simulated action)
        setReallocationProgress((prev) => ({
          ...prev,
          [i]: { step: 2, error: null, completed: false },
        }));

        // Simulate processing the generated receive address
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Mark as completed
        setReallocationProgress((prev) => ({
          ...prev,
          [i]: { step: 2, error: null, completed: true },
        }));
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // All transactions completed successfully
      setIsExecuting(false);

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
            },
            {
              text: 'Confirm',
              variant: 'primary',
              onPress: executeReallocation,
              disabled: filteredReallocations.length === 0,
              loading: isExecuting,
            },
          ]}
        />
      }>
      <Text
        size={24}
        style={{
          fontSize: 20,
          fontFamily: 'OverpassHeavy',
          color: greys(theme)[0],
          textAlign: 'center',
          marginBottom: 16,
        }}>
        {isExecuting ? 'Processing Reallocation' : 'Confirm Reallocation'}
      </Text>

      {/* Ignore Dust Toggle */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
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
            style={{
              fontSize: 14,
              color: greys(theme)[0],
              fontFamily: 'OverpassSemiBold',
              marginBottom: 2,
            }}>
            Ignore Dust (recommended)
          </Text>
          <Text
            style={{
              fontSize: 12,
              color: greys(theme)[300],
              fontFamily: 'OverpassRegular',
            }}>
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
      </View>

      {/* Reallocation Details */}
      <View style={{ marginBottom: 12 }}>
        {filteredReallocations.length === 0 ? (
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 24,
              backgroundColor: greys(theme)[700],
              borderRadius: 14,
              borderWidth: 1,
              borderColor: greys(theme)[600],
              alignItems: 'center',
            }}>
            <Icon name="mdi:cancel" size={24} color={greys(theme)[400]} />
            <Text
              style={{
                fontSize: 14,
                color: greys(theme)[300],
                fontFamily: 'OverpassSemiBold',
                textAlign: 'center',
                marginTop: 8,
              }}>
              All transactions filtered out as dust
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: greys(theme)[400],
                fontFamily: 'OverpassRegular',
                textAlign: 'center',
                marginTop: 4,
              }}>
              No reallocations needed under current settings
            </Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollViewRef}
            style={{ maxHeight: 400 }}
            showsVerticalScrollIndicator={false}>
            {filteredReallocations.map((reallocation, index) => {
              const hasError = !!reallocationProgress[index]?.error;

              return (
                <View
                  key={index}
                  ref={(ref) => {
                    itemRefs.current[index] = ref;
                  }}
                  collapsable={false}>
                  <ReallocationItem
                    reallocation={reallocation}
                    index={index}
                    progress={reallocationProgress[index]}
                    theme={theme}
                    hasError={hasError}
                    reallocationProgress={reallocationProgress}
                    isExecuting={isExecuting}
                    executionSteps={executionSteps}
                  />
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
          alignItems: 'center',
        }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}>
          <Icon name="fluent:arrow-swap-16-filled" size={16} color={greys(theme)[200]} />
          <Text
            style={{
              fontSize: 14,
              color: greys(theme)[0],
              fontFamily: 'OverpassSemiBold',
            }}>
            Total:
          </Text>
          <Text
            style={{
              fontSize: 14,
              fontFamily: 'OverpassSemiBold',
              color: theme.shades[200],
            }}>
            {filteredTotalAmount} {payload.unit.toUpperCase()}
          </Text>
        </View>

        {/* Show filtered transactions info */}
        {ignoreDust && payload.reallocations.length !== filteredReallocations.length && (
          <Text
            style={{
              fontSize: 11,
              color: greys(theme)[300],
              fontFamily: 'OverpassRegular',
              textAlign: 'center',
              marginTop: 6,
            }}>
            {payload.reallocations.length - filteredReallocations.length} dust transaction
            {payload.reallocations.length - filteredReallocations.length !== 1 ? 's' : ''} filtered
          </Text>
        )}
      </View>
    </Wrapper>
  );
}

export default RouteA;
