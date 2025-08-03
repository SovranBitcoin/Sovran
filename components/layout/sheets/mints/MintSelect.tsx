import React, { useState, useMemo, useRef, useCallback } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useSelector } from 'react-redux';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  withSpring,
  useAnimatedStyle,
  interpolate,
} from 'react-native-reanimated';

import {
  memoizedGetAllBalancesMultipleCurrencies,
  memoizedGetSelectedMint,
} from 'helper/redux/cashu/selectors';
import Icon, { CheckIcon, CurrencyIcon, FlagIcon } from 'assets/icons';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { useSheetRouter } from 'react-native-actions-sheet/dist/src/hooks/use-router';
import { Text } from 'components/common/Text';
import { greens, greys, reds, Theme } from 'helper/colors';
import { formatCurrency } from 'helper/currency';
import Image from 'components/common/Image';
import Wrapper from '../wrapper';
import { showMessage } from 'helper/popup/popups';
import { sovran } from '.';
import opacity from 'hex-color-opacity';
import { LinearGradient } from 'expo-linear-gradient';
import _ from 'lodash';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { store } from 'helper/redux/store';
import { memoizedGetTheme } from 'helper/redux/settings';
import Haptics from 'components/common/Haptics';
import RippleButton from 'components/common/RippleButton';
import { darken } from 'polished';

interface SelectedMintDisplayProps {
  onPress?: () => void;
  onMintSelected?: (
    mint: {
      id: string;
      name: string;
      iconUrl: string | null;
      unit: string;
    },
    balance: { amount: number; unit: string } | undefined
  ) => Promise<void>;
  onMintQuoteUpdate?: (meltQuote: string) => void;
  pr?: string;
  unit?: string;
  onUnitUpdate?: (unit: string) => void;
  loading?: boolean;
}

type SupportedCurrency = 'SAT' | 'USD' | 'EUR' | 'GBP';

// Integer ratio system for precise percentage calculations
const RATIO_PRECISION = 10000; // Gives 0.01% precision

// Helper functions for ratio conversion
const ratioToPercentage = (ratio: number): number => {
  return (ratio / RATIO_PRECISION) * 100;
};

const percentageToRatio = (percentage: number): number => {
  return Math.round((percentage / 100) * RATIO_PRECISION);
};

// Initialize ratios that sum to exactly RATIO_PRECISION
const initializeRatios = (mintIds: string[]): Record<string, number> => {
  const equalRatio = Math.floor(RATIO_PRECISION / mintIds.length);
  const remainder = RATIO_PRECISION - equalRatio * (mintIds.length - 1);

  const ratios: Record<string, number> = {};
  mintIds.forEach((id, index) => {
    ratios[id] = index === 0 ? remainder : equalRatio;
  });

  return ratios;
};

// Helper function for testing - validates that ratios always sum to RATIO_PRECISION
const validateRatios = (ratios: Record<string, number>, label: string = '') => {
  const total = Object.values(ratios).reduce((sum, ratio) => sum + ratio, 0);
  console.log(`${label} Ratio validation:`, {
    total,
    expected: RATIO_PRECISION,
    isValid: total === RATIO_PRECISION,
    ratios: Object.entries(ratios).map(([id, ratio]) => ({
      id: id.split('/').pop(), // Show just the mint name
      ratio,
      percentage: ratioToPercentage(ratio).toFixed(2) + '%',
    })),
  });
  return total === RATIO_PRECISION;
};

// Helper function to format percentage to 2 significant figures - optimized
const formatPercentage = (value: number): number => {
  if (value === 0) return 0;
  if (value >= 10) return Math.round(value);
  if (value >= 1) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
};

interface MintState {
  selected: {
    id: string;
    name: string;
    balance: number;
    iconUrl: string | null;
    unit: string;
  } | null;
  loadingId: string | null;
}

interface MintItemProps {
  mint: {
    id: string;
    name: string;
    iconUrl: string | null;
  };
  balance?: {
    amount: number;
    unit: string;
  };
  isSelected: boolean;
  isLoading: boolean;
  globalLoading: boolean;
  selectedCurrency: string;
  theme: Theme;
  onPress: () => void;
  isEditing: boolean;
  percentage?: number;
  onPercentageChange?: (mintId: string, change: number) => void;
  // Gesture handling props
  isAnyGestureActive?: boolean;
  onGestureStart?: (mintId: string) => void;
  onGestureUpdate?: (mintId: string, newPercentage: number) => void;
  onGestureEnd?: (mintId: string, finalPercentage: number) => void;
  // Button handlers
  onIncrement?: () => void;
  onDecrement?: () => void;
}

const MintItem = React.memo<MintItemProps>(
  ({
    mint,
    balance,
    isSelected,
    isLoading,
    globalLoading,
    selectedCurrency,
    theme,
    onPress,
    isEditing,
    percentage = 0,
    onPercentageChange,
    isAnyGestureActive = false,
    onGestureStart,
    onGestureUpdate,
    onGestureEnd,
    onIncrement,
    onDecrement,
  }) => {
    const styles = createStyles(theme);

    // Unified Reanimated approach - all animations use shared values
    const animatedPercentage = useSharedValue(percentage);
    const animatedDisplayText = useSharedValue(percentage);
    const lastHapticValue = useRef(0);
    const gestureStartValue = useRef(0);

    // Update animated values when percentage changes - optimized
    React.useEffect(() => {
      if (isAnyGestureActive) {
        // ✅ GOOD - Direct assignment during gestures for immediate response
        animatedPercentage.value = percentage;
        animatedDisplayText.value = percentage;
      } else {
        // ✅ GOOD - Spring animation only for final values
        animatedPercentage.value = withSpring(percentage, {
          mass: 0.2,
          stiffness: 400,
          damping: 20,
        });
        animatedDisplayText.value = percentage;
      }
    }, [percentage, isAnyGestureActive]);

    // Animated styles for progress bar - optimized
    const progressBarStyle = useAnimatedStyle(() => {
      const width = interpolate(animatedPercentage.value, [0, 100], [2, 100], 'clamp');
      return { width: `${width}%` };
    }, []);

    // Animated text style - unified approach
    const textStyle = useAnimatedStyle(
      () => ({
        opacity: withSpring(isAnyGestureActive ? 0.8 : 1, { duration: 150 }),
      }),
      [isAnyGestureActive]
    );

    const onPanGestureEvent = (event: any) => {
      if (!isEditing || !onGestureUpdate) return;

      const { translationX } = event.nativeEvent;
      // Each 10 pixels of movement = 0.5% change
      const percentageChange = Math.round((translationX / 10) * 2) / 2; // 0.5% increments
      const newDisplayPercentage = Math.max(
        0,
        Math.min(100, gestureStartValue.current + percentageChange)
      );

      // Update all percentages via parent handler
      onGestureUpdate(mint.id, newDisplayPercentage);

      // Provide haptic feedback every 1% change
      const hapticThreshold = Math.floor(newDisplayPercentage);
      if (hapticThreshold !== lastHapticValue.current) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        lastHapticValue.current = hapticThreshold;
      }
    };

    const onPanHandlerStateChange = (event: any) => {
      if (!isEditing) return;

      const { state } = event.nativeEvent;

      if (state === State.BEGAN) {
        gestureStartValue.current = percentage;
        lastHapticValue.current = Math.floor(percentage);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onGestureStart?.(mint.id);
      } else if (state === State.END || state === State.CANCELLED) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        const { translationX } = event.nativeEvent;
        const percentageChange = Math.round((translationX / 10) * 2) / 2;
        const finalPercentage = Math.max(
          0,
          Math.min(100, gestureStartValue.current + percentageChange)
        );

        onGestureEnd?.(mint.id, finalPercentage);
      }
    };

    function handlePress() {
      if (!isEditing) {
        onPress();
      }
    }

    // Use display value during gesture, actual percentage otherwise
    const currentDisplayPercentage = percentage;

    const formattedBalance = balance
      ? formatCurrency(
          {
            currency:
              selectedCurrency === 'SAT'
                ? 'BTC'
                : (selectedCurrency as 'USD' | 'EUR' | 'GBP' | 'AUD' | 'CAD' | 'NZD' | 'KRW'),
            value: balance.amount,
            denomination: (selectedCurrency.toLowerCase() === 'sat'
              ? 'sats'
              : selectedCurrency.toLowerCase()) as
              | 'btc'
              | 'sats'
              | 'bits'
              | 'finneys'
              | 'usd'
              | 'eur'
              | 'gbp'
              | 'aud'
              | 'cad'
              | 'nzd'
              | 'krw',
          },
          {
            locale: 'en-US',
            precision: selectedCurrency === 'SAT' ? 0 : 2,
            currencyDisplay: selectedCurrency === 'SAT' ? 'name' : 'symbol',
            denomination: (selectedCurrency.toLowerCase() === 'sat'
              ? 'sats'
              : selectedCurrency.toLowerCase()) as
              | 'btc'
              | 'sats'
              | 'bits'
              | 'finneys'
              | 'usd'
              | 'eur'
              | 'gbp'
              | 'aud'
              | 'cad'
              | 'nzd'
              | 'krw',
          }
        )
      : '0';
    const router = useSheetRouter('mint');

    const colors =
      isSelected && !isEditing
        ? [
            opacity(theme.shades[200], 0.88),
            opacity(theme.shades[200], 0.88),
            opacity(theme.shades[300], 0.88),
            opacity(theme.shades[200], 0.88),
            opacity(theme.shades[300], 0.88),
          ]
        : [];

    return (
      <LinearGradient
        colors={colors as any}
        style={[
          {
            padding: 1,
            marginVertical: 4,
            borderRadius: 16,
          },
        ]}>
        <PanGestureHandler
          onGestureEvent={onPanGestureEvent}
          onHandlerStateChange={onPanHandlerStateChange}
          minDist={0}
          enabled={isEditing}
          activeOffsetX={[-10, 10]}
          failOffsetY={[-15, 15]}
          shouldCancelWhenOutside={false}>
          {isEditing ? (
            <View
              key={mint.id}
              style={[
                sovran(theme).listItem,
                globalLoading && styles.disabledMintItem,
                {
                  backgroundColor: greys(theme)[900],
                  marginVertical: 0,
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  padding: 16,
                },
                // Remove selected styling in editing mode
              ]}>
              <View style={styles.mintHeaderRow}>
                <View
                  style={{
                    position: 'relative',
                  }}>
                  {mint.iconUrl ? (
                    <Image source={{ uri: mint.iconUrl }} style={styles.mintIcon} />
                  ) : (
                    <View style={styles.mintIcon} />
                  )}
                  <View
                    style={{
                      position: 'absolute',
                      bottom: -2,
                      right: -2,
                    }}>
                    {isLoading ? (
                      <ActivityIndicator animating size="small" color={greys(theme)[0]} />
                    ) : isSelected ? (
                      <View style={styles.checkIconContainer}>
                        <CheckIcon size={16} color={greys(theme)[0]} />
                      </View>
                    ) : null}
                  </View>
                </View>
                <View style={styles.mintBalanceRow}>
                  <Text style={styles.mintName}>{mint.name}</Text>
                  <Text style={styles.mintBalance}>{formattedBalance}</Text>
                </View>
              </View>
              <View style={styles.percentageControls}>
                <RippleButton
                  style={styles.decrementButton}
                  disabled={percentage <= 0}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onDecrement?.();
                  }}>
                  <Icon
                    name="gala:remove"
                    size={32}
                    color={percentage <= 0 ? reds[500] : reds[300]}
                  />
                </RippleButton>
                <View style={styles.percentageContainer}>
                  <View style={styles.percentageOverlayContainer}>
                    {/* Progress bar behind text */}
                    <Animated.View style={[styles.progressBar, progressBarStyle]} />

                    {/* Text overlay */}
                    <View style={styles.percentageTextOverlay}>
                      <Animated.Text style={[styles.percentageText, textStyle]}>
                        {`${formatPercentage(percentage)}%`}
                      </Animated.Text>
                      {/* <Text style={styles.ratioDebugText}>
                        R:{Math.round(percentageToRatio(percentage))}
                      </Text> */}
                    </View>
                  </View>
                </View>
                <RippleButton
                  style={styles.incrementButton}
                  disabled={percentage >= 100}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onIncrement?.();
                  }}>
                  <Icon
                    name="gala:add"
                    size={32}
                    color={percentage >= 100 ? greens[500] : greens[300]}
                  />
                </RippleButton>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              key={mint.id}
              style={[
                sovran(theme).listItem,
                globalLoading && styles.disabledMintItem,
                {
                  backgroundColor: greys(theme)[900],
                  marginVertical: 0,
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: sovran(theme).listItem.padding,
                },
                isSelected && styles.selectedMintItem,
              ]}
              onPress={handlePress}
              disabled={globalLoading}>
              <View
                style={{
                  position: 'relative',
                }}>
                {mint.iconUrl ? (
                  <Image source={{ uri: mint.iconUrl }} style={styles.mintIcon} />
                ) : (
                  <View style={styles.mintIcon} />
                )}
                <View
                  style={{
                    position: 'absolute',
                    bottom: -2,
                    right: -2,
                  }}>
                  {isLoading ? (
                    <ActivityIndicator animating size="small" color={greys(theme)[0]} />
                  ) : isSelected ? (
                    <View style={styles.checkIconContainer}>
                      <CheckIcon size={16} color={greys(theme)[0]} />
                    </View>
                  ) : null}
                </View>
              </View>
              <View style={styles.mintDetails}>
                <Text style={styles.mintName}>{mint.name}</Text>
                <Text style={styles.mintBalance}>{formattedBalance}</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  router?.navigate('mintDetailsPage', {
                    mintUrl: mint.id,
                  });
                }}>
                <Icon
                  style={{
                    padding: 8,
                    backgroundColor: isSelected
                      ? opacity(greys(theme)[900], 0.5)
                      : opacity(greys(theme)[800], 0.75),
                    borderRadius: 10000,
                  }}
                  name="bx:dots-vertical-rounded"
                />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        </PanGestureHandler>
      </LinearGradient>
    );
  }
);

MintItem.displayName = 'MintItem';

// Custom comparison function for optimal re-rendering
const MemoizedMintItem = React.memo(
  MintItem,
  (prevProps: MintItemProps, nextProps: MintItemProps) => {
    // Only re-render if specific props changed
    return (
      prevProps.mint.id === nextProps.mint.id &&
      prevProps.percentage === nextProps.percentage &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.isLoading === nextProps.isLoading &&
      prevProps.globalLoading === nextProps.globalLoading &&
      prevProps.isEditing === nextProps.isEditing &&
      prevProps.isAnyGestureActive === nextProps.isAnyGestureActive &&
      prevProps.balance?.amount === nextProps.balance?.amount &&
      prevProps.selectedCurrency === nextProps.selectedCurrency &&
      prevProps.theme === nextProps.theme
    );
  }
);

MemoizedMintItem.displayName = 'MintItem';

// Export the memoized component as MintItem for clean usage
const MintItemComponent = MemoizedMintItem;

export function MintSelect({ onMintSelected, unit }: SelectedMintDisplayProps) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const [mintState, setMintState] = useState<MintState>({
    selected: null,
    loadingId: null,
  });
  const [selectedCurrency, setSelectedCurrency] = useState<SupportedCurrency>(
    (unit?.toUpperCase() || 'SAT') as SupportedCurrency
  );
  const [isEditing, setIsEditing] = useState(false);
  const [mintRatios, setMintRatios] = useState<Record<string, number>>({});

  // ✅ GOOD - Ref-based gesture state to avoid unnecessary re-renders
  const gestureStateRef = useRef({
    isActive: false,
    activeMintId: null as string | null,
    initialRatios: {} as Record<string, number>, // Renamed for clarity
    displayRatios: {} as Record<string, number>, // Renamed for clarity
  });

  // Separate state for UI that actually needs re-renders
  const [isGestureActive, setIsGestureActive] = useState(false);

  // Update without triggering re-renders unless necessary
  const updateGestureState = useCallback((updates: Partial<typeof gestureStateRef.current>) => {
    Object.assign(gestureStateRef.current, updates);

    // Only trigger re-render when isActive state changes (affects UI)
    if (updates.isActive !== undefined) {
      setIsGestureActive(updates.isActive);
    }
  }, []);

  // Ref to track latest ratios to avoid stale closures
  const latestRatiosRef = useRef<Record<string, number>>({});

  // Ref to track current gesture state for stable throttled function
  const gestureStateRefForThrottled = useRef(gestureStateRef.current);
  gestureStateRefForThrottled.current = gestureStateRef.current;

  // ADDITIONAL FIX: Clear gesture state when not editing
  React.useEffect(() => {
    if (!isEditing) {
      updateGestureState({
        // ✅ GOOD - Direct property mutation, no object spread
        isActive: false,
        activeMintId: null,
      });
    }
  }, [isEditing, updateGestureState]);

  const multipleBalances = useSelector(memoizedGetAllBalancesMultipleCurrencies);

  // limit to specified currencies: sat, eur, gbp, usd
  const currencies: any = _.uniq(multipleBalances.map((b) => b.unit?.toUpperCase())).filter((c) =>
    ['SAT', 'USD', 'EUR', 'GBP'].includes(c)
  );

  // Filter mints based on the selected currency - optimized with useMemo
  const filteredMints = useMemo(() => {
    const mints = multipleBalances.filter((mint) => mint.unit?.toUpperCase() === selectedCurrency);

    // Initialize ratios equally when mints change - optimized
    if (mints.length > 0 && Object.keys(mintRatios).length === 0) {
      const mintIds = mints.map((mint) => mint.mintUrl);
      const newRatios = initializeRatios(mintIds);

      // ✅ GOOD - Update ref directly in setter
      latestRatiosRef.current = newRatios;
      setMintRatios(newRatios);

      // Validate ratios sum correctly (temporarily disabled)
      // validateRatios(newRatios, 'Initial Setup');
    }

    return mints;
  }, [multipleBalances, selectedCurrency, mintRatios]);

  // Optimized rebalancing function - integer ratio-based approach
  const rebalanceProportionally = useCallback(
    (
      ratios: Record<string, number>,
      targetMintId: string,
      newPercentage: number
    ): Record<string, number> => {
      const newRatio = percentageToRatio(Math.max(0, Math.min(100, newPercentage)));
      const oldRatio = ratios[targetMintId] || 0;

      // Early return if no meaningful change
      if (Math.abs(newRatio - oldRatio) < 1) {
        return ratios;
      }

      // Create new state
      const newRatios = { ...ratios };
      newRatios[targetMintId] = newRatio;

      // Get other mint IDs
      const otherMintIds = Object.keys(ratios).filter((id) => id !== targetMintId);

      if (otherMintIds.length === 0) {
        return newRatios;
      }

      // Calculate remaining ratio to distribute
      const remainingRatio = RATIO_PRECISION - newRatio;

      // Calculate current total of other mints
      let otherTotal = 0;
      otherMintIds.forEach((id) => {
        otherTotal += ratios[id] || 0;
      });

      if (otherTotal === 0) {
        // If other mints are 0, distribute equally
        const equalShare = Math.floor(remainingRatio / otherMintIds.length);
        const remainder = remainingRatio - equalShare * (otherMintIds.length - 1);

        otherMintIds.forEach((id, index) => {
          newRatios[id] = index === 0 ? remainder : equalShare;
        });
      } else {
        // Distribute proportionally using integer math
        let distributed = 0;

        // Handle all but the last mint
        for (let i = 0; i < otherMintIds.length - 1; i++) {
          const id = otherMintIds[i];
          const currentRatio = ratios[id] || 0;

          // Integer-based proportional calculation
          const newMintRatio = Math.round((remainingRatio * currentRatio) / otherTotal);
          newRatios[id] = newMintRatio;
          distributed += newMintRatio;
        }

        // Give remainder to last mint to ensure exact total
        const lastMintId = otherMintIds[otherMintIds.length - 1];
        newRatios[lastMintId] = remainingRatio - distributed;
      }

      // Validate that ratios sum to exactly RATIO_PRECISION
      const total = Object.values(newRatios).reduce((sum, ratio) => sum + ratio, 0);
      if (total !== RATIO_PRECISION) {
        console.error('Ratio sum error:', { total, expected: RATIO_PRECISION, newRatios });
      }

      return newRatios;
    },
    []
  );

  const handlePercentageChange = useCallback(
    (mintId: string, change: number) => {
      setMintRatios((prev) => {
        // Use the latest state from ref to avoid stale closures
        const currentState = { ...latestRatiosRef.current };
        const currentPercentage = ratioToPercentage(currentState[mintId] || 0);
        const newPercentage = currentPercentage + change;

        const newRatios = rebalanceProportionally(currentState, mintId, newPercentage);

        // ✅ GOOD - Update ref directly in setter
        latestRatiosRef.current = newRatios;

        // Validate ratios after percentage change
        validateRatios(newRatios, `After ${change > 0 ? '+' : ''}${change}% change`);

        return newRatios;
      });
    },
    [rebalanceProportionally]
  );

  // ✅ GOOD - Create handlers once per mint, not per render
  const mintButtonHandlers = useMemo(() => {
    const handlers: Record<string, { increment: () => void; decrement: () => void }> = {};
    filteredMints.forEach((mint) => {
      handlers[mint.mintUrl] = {
        increment: () => {
          // Reset gesture state before updating percentages
          updateGestureState({ isActive: false, activeMintId: null });
          handlePercentageChange(mint.mintUrl, 5);
        },
        decrement: () => {
          // Reset gesture state before updating percentages
          updateGestureState({ isActive: false, activeMintId: null });
          handlePercentageChange(mint.mintUrl, -5);
        },
      };
    });
    return handlers;
  }, [filteredMints, handlePercentageChange, updateGestureState]); // Only when mints change

  // Gesture handlers for real-time updates
  const handleGestureStart = useCallback(
    (mintId: string) => {
      updateGestureState({
        // Capture initial state only once at gesture start
        isActive: true,
        activeMintId: mintId,
        initialRatios: { ...mintRatios }, // Only copy once at start
        displayRatios: { ...mintRatios }, // Only copy once at start
      });
    },
    [mintRatios, updateGestureState]
  );

  // Throttled version for smoother performance - optimized throttling
  const throttledGestureUpdate = useMemo(
    () =>
      _.throttle((mintId: string, newPercentage: number) => {
        // ✅ GOOD - Create copy only once per throttled call, not on every frame
        const ratiosCopy = { ...gestureStateRefForThrottled.current.initialRatios };
        const calculatedRatios = rebalanceProportionally(
          ratiosCopy, // Work on copy to preserve initial state
          mintId,
          newPercentage // Function handles percentage-to-ratio conversion internally
        );

        // ✅ GOOD - Direct assignment without re-render
        gestureStateRef.current.displayRatios = calculatedRatios;
      }, 8), // Stable throttling at 8ms
    [] // No dependencies - stable function
  );

  const handleGestureEnd = useCallback(
    (mintId: string, finalPercentage: number) => {
      updateGestureState({
        isActive: false,
        activeMintId: null,
      });

      // Commit the final change
      const initialRatio = gestureStateRef.current.initialRatios[mintId] || 0;
      const initialPercentage = ratioToPercentage(initialRatio); // Convert ratio to percentage
      const change = finalPercentage - initialPercentage;

      if (Math.abs(change) >= 0.1) {
        handlePercentageChange(mintId, change);
      }
    },
    [updateGestureState, handlePercentageChange]
  );

  // Memoized button handlers to prevent object recreation on every render
  const buttonHandlersMap = useMemo(() => {
    const handlersMap = new Map<string, { increment: () => void; decrement: () => void }>();

    filteredMints.forEach((mint) => {
      const handlers = mintButtonHandlers[mint.mintUrl];
      if (handlers) {
        handlersMap.set(mint.mintUrl, handlers);
      }
    });

    return handlersMap;
  }, [filteredMints, mintButtonHandlers]);

  const handleMintSelection = async (
    mint: {
      id: string;
      name: string;
      iconUrl: string | null;
    },
    balance: { amount: number; unit: string } | undefined
  ) => {
    if (onMintSelected && !isEditing) {
      setMintState((prev) => ({
        ...prev,
        loadingId: mint.id,
      }));

      try {
        const selectedUnit = selectedCurrency.toLowerCase();
        const finalUnit = (balance?.unit || selectedUnit) as string;
        await onMintSelected(
          {
            ...mint,
            unit: finalUnit.toLowerCase(),
          },
          balance
        );
        setMintState(() => ({
          selected: {
            id: mint.id,
            name: mint.name,
            balance: balance?.amount || 0,
            iconUrl: mint.iconUrl,
            unit: finalUnit,
          },
          loadingId: null,
        }));
      } catch {
        setMintState((prev) => ({
          ...prev,
          loadingId: null,
        }));

        showMessage('general_error', {}, { emoji: '🚨' });
      }
    }

    if (!isEditing) {
      router?.goBack();
    }
  };

  const selectedMint = memoizedGetSelectedMint(store.getState());

  const displayCurrency = (currency: string) => {
    return currency === 'SAT' ? 'BTC' : currency;
  };

  const handleEditToggle = () => {
    if (isEditing) {
      // Save logic would go here
      setIsEditing(false);
    } else {
      // Clear any gesture state when entering edit mode
      updateGestureState({
        isActive: false,
        activeMintId: null,
      });
      setIsEditing(true);
    }
  };

  const router = useSheetRouter('mint');

  return (
    <Wrapper
      buttons={
        <ButtonHandler
          buttons={[
            {
              text: 'Add mints',
              variant: 'primary',
              onPress: async () => {
                router?.navigate('mintAddMore');
              },
              loading: mintState.loadingId !== null,
              disabled: isEditing,
            },
            {
              text: 'Cancel',
              variant: 'secondary',
              onPress: async () => {
                router?.goBack();
              },
              loading: mintState.loadingId !== null,
              disabled: isEditing,
            },
          ]}
        />
      }>
      <View>
        <Text weight="bold" style={styles.sectionHeader}>
          Send payment in
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.currencyScroll}
          scrollEnabled={!isEditing}>
          {currencies.map((currency: any) => (
            <LinearGradient
              key={currency}
              colors={
                selectedCurrency === currency
                  ? ([
                      opacity(theme.shades[200], 0.88),
                      opacity(theme.shades[200], 0.88),
                      opacity(theme.shades[300], 0.88),
                      opacity(theme.shades[200], 0.88),
                      opacity(theme.shades[300], 0.88),
                    ] as const)
                  : [opacity(theme.shades[200], 0), opacity(theme.shades[200], 0)]
              }
              style={[
                styles.currencyButton,
                sovran(theme).borderSubtle,
                isEditing && styles.disabledCurrency,
                {
                  marginRight: 8,
                  borderRadius: 8,
                  padding: 1,
                  backgroundColor:
                    selectedCurrency === currency ? greys(theme)[900] : greys(theme)[900],
                },
              ]}>
              <TouchableOpacity
                style={[
                  styles.currencyButton,
                  selectedCurrency === currency && styles.selectedCurrencyButton,
                  {
                    flex: 1,
                  },
                ]}
                onPress={() => !isEditing && setSelectedCurrency(currency)}
                disabled={isEditing}>
                <View style={styles.currencyContent}>
                  {currency === 'USD' || currency === 'EUR' || currency === 'GBP' ? (
                    <FlagIcon
                      country={currency === 'USD' ? 'US' : currency === 'EUR' ? 'EU' : 'GB'}
                      height={32}
                      width={32}
                    />
                  ) : (
                    <CurrencyIcon currency={currency.toLowerCase()} />
                  )}
                  <Text style={styles.currencyText}>{displayCurrency(currency)}</Text>
                </View>
              </TouchableOpacity>
            </LinearGradient>
          ))}
        </ScrollView>

        <View style={styles.sendFromHeader}>
          <Text weight="bold" style={[styles.sectionHeader, { marginTop: 24, marginBottom: 4 }]}>
            Send from
          </Text>
          <TouchableOpacity onPress={handleEditToggle} style={styles.editButtonContainer}>
            <Text style={styles.editButton}>{isEditing ? 'Save' : 'Reallocate'}</Text>
          </TouchableOpacity>
        </View>
        <View>
          {filteredMints.map((mint) => {
            // Get the correct percentage to display from ratios
            const displayPercentage = gestureStateRef.current.isActive
              ? ratioToPercentage(gestureStateRef.current.displayRatios[mint.mintUrl] || 0)
              : ratioToPercentage(mintRatios[mint.mintUrl] || 0);

            // Create stable button handlers for this mint
            const buttonHandlers = buttonHandlersMap.get(mint.mintUrl);

            return (
              <MintItemComponent
                key={mint.mintUrl}
                mint={{
                  id: mint.mintUrl,
                  name: mint.mintUrl.replace('https://', '')?.split('/')?.[0],
                  iconUrl: mint.iconUrl,
                }}
                balance={{ amount: mint.amount, unit: mint.unit }}
                isSelected={selectedMint === mint.mintUrl}
                isLoading={mintState.loadingId === mint.mintUrl}
                globalLoading={mintState.loadingId !== null}
                selectedCurrency={selectedCurrency}
                theme={theme}
                isEditing={isEditing}
                percentage={displayPercentage}
                onPercentageChange={handlePercentageChange}
                isAnyGestureActive={isGestureActive}
                onGestureStart={handleGestureStart}
                onGestureUpdate={throttledGestureUpdate}
                onGestureEnd={handleGestureEnd}
                onIncrement={buttonHandlers?.increment}
                onDecrement={buttonHandlers?.decrement}
                onPress={() =>
                  handleMintSelection(
                    {
                      id: mint.mintUrl,
                      name: mint.mintUrl.replace('https://', '')?.split('/')?.[0],
                      iconUrl: null,
                    },
                    { amount: mint.amount, unit: mint.unit }
                  )
                }
              />
            );
          })}
        </View>
      </View>
    </Wrapper>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    sectionHeader: {
      color: greys(theme)[0],
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 4,
    },
    sendFromHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
    },
    editButtonContainer: {
      marginBottom: 4,
    },
    editButton: {
      color: theme.shades[200],
      fontSize: 16,
      fontWeight: '500',
    },
    currencyScroll: {
      flexGrow: 1,
    },
    currencyButton: {
      padding: 12,
      borderRadius: 8,
      minWidth: 100,
    },
    currencyContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: 8,
    },
    selectedCurrencyButton: {
      backgroundColor: greys(theme)[700],
    },
    currencyText: {
      color: greys(theme)[0],
      fontSize: 14,
      fontFamily: 'OverpassBold',
    },
    disabledCurrency: {
      opacity: 0.5,
    },
    selectedMintItem: {
      backgroundColor: greys(theme)[700],
    },
    mintIcon: {
      width: 32,
      height: 32,
      borderRadius: 12,
      backgroundColor: greys(theme)[200],
    },
    mintHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 4,
    },
    mintBalanceRow: {
      marginBottom: 8,
    },
    mintDetails: {
      flex: 1,
      marginLeft: 12,
      marginRight: 12,
    },
    mintName: {
      color: greys(theme)[0],
      fontSize: 16,
    },
    mintBalance: {
      color: greys(theme)[200],
      fontSize: 14,
    },
    checkIconContainer: {
      backgroundColor: greys(theme)[800],
      borderRadius: 1000,
      marginLeft: 8,
    },
    disabledMintItem: {
      opacity: 0.5,
    },
    percentageControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      alignSelf: 'flex-end',
      width: '100%',
    },
    percentageButton: {
      padding: 12,
      borderRadius: 10000,
    },
    decrementButton: {
      // padding: 12,
      backgroundColor: darken(0.2, reds[500]), // Dark red background for minus (red-900)
      borderRadius: 10000,
    },
    incrementButton: {
      // padding: 12,
      backgroundColor: darken(0.2, greens[500]), // Dark green background for plus (green-800)
      borderRadius: 10000,
    },
    percentageText: {
      color: greys(theme)[0],
      fontSize: 16,
      fontWeight: '600',
      minWidth: 40,
      textAlign: 'center',
    },
    percentageContainer: {
      flex: 1,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      minHeight: 48,
    },
    percentageTextContainer: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: opacity(greys(theme)[700], 0.3),
    },
    progressBarContainer: {
      width: '100%',
      height: 8,
      backgroundColor: greys(theme)[700],
      borderRadius: 4,
      overflow: 'hidden',
    },
    progressBar: {
      position: 'absolute',
      left: 0,
      top: 0,
      height: '100%',
      backgroundColor: greys(theme)[600],
      borderRadius: 8,
      zIndex: 1,
    },
    percentageOverlayContainer: {
      position: 'relative',
      width: '100%',
      height: 48,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: greys(theme)[800],
      borderRadius: 8,
      overflow: 'hidden',
    },
    percentageTextOverlay: {
      position: 'absolute',
      zIndex: 10,
      width: '100%',
      height: '100%',
      justifyContent: 'center',
      alignItems: 'center',
    },
    ratioDebugText: {
      color: greys(theme)[200],
      fontSize: 12,
      fontWeight: '400',
      marginTop: 4,
    },
  });
