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
// duplicate import removed
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
import { useAllocation } from 'helper/redux/cashu/hooks';
import Haptics from 'components/common/Haptics';
import RippleButton from 'components/common/RippleButton';
import { darken } from 'polished';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { SheetManager } from 'react-native-actions-sheet';

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
  startInEditing?: boolean;
  onCancel?: () => void;
  onSaved?: () => void;
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

  // Gesture handling props
  isAnyGestureActive?: boolean;
  onGestureStart?: (mintId: string) => void;
  onGestureUpdate?: (mintId: string, newPercentage: number) => void;
  onGestureEnd?: (mintId: string, finalPercentage: number) => void;
  // Button handlers
  onIncrement?: () => void;
  onDecrement?: () => void;
  // Preview props
  showPreview?: boolean;
  previewPercentage?: number;
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
    isAnyGestureActive = false,
    onGestureStart,
    onGestureUpdate,
    onGestureEnd,
    onIncrement,
    onDecrement,
    showPreview = false,
    previewPercentage = 0,
  }) => {
    const styles = createStyles(theme);

    // Unified Reanimated approach - all animations use shared values
    const animatedPercentage = useSharedValue(percentage);
    const animatedDisplayText = useSharedValue(percentage);
    const animatedPreviewPercentage = useSharedValue(previewPercentage);
    const lastHapticValue = useRef(0);
    const gestureStartValue = useRef(0);

    // Update animated values when percentage changes - optimized
    React.useEffect(() => {
      if (isAnyGestureActive) {
        // ✅ SMOOTH - Direct assignment during gestures for immediate response
        animatedPercentage.value = percentage;
        animatedDisplayText.value = percentage;
      } else {
        // ✅ SMOOTH - Spring animation only for final values
        animatedPercentage.value = withSpring(percentage, {
          mass: 0.15, // Lighter mass for quicker response
          stiffness: 500, // Higher stiffness for snappier animation
          damping: 25, // Slightly higher damping to reduce overshoot
        });
        animatedDisplayText.value = percentage;
      }
    }, [percentage, isAnyGestureActive, animatedPercentage, animatedDisplayText]);

    // Update preview percentage animated value
    React.useEffect(() => {
      if (showPreview) {
        // Direct assignment for immediate response during preview
        animatedPreviewPercentage.value = previewPercentage;
      }
    }, [previewPercentage, showPreview, animatedPreviewPercentage]);

    // Animated styles for progress bar - optimized
    const progressBarStyle = useAnimatedStyle(() => {
      const width = interpolate(animatedPercentage.value, [0, 100], [2, 100], 'clamp');
      return { width: `${width}%` };
    }, []);

    // Animated styles for preview progress bar
    const previewProgressBarStyle = useAnimatedStyle(() => {
      const width = interpolate(animatedPreviewPercentage.value, [0, 100], [2, 100], 'clamp');
      return {
        width: `${width}%`,
        opacity: showPreview ? 0.8 : 0,
      };
    }, [showPreview]);

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
      // Each 8 pixels of movement = 1% change for smoother control
      const percentageChange = translationX / 8; // Smooth continuous movement
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
        const percentageChange = translationX / 8; // Match the smooth gesture calculation
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
          enabled={isEditing}
          activeOffsetX={[-15, 15]}
          failOffsetY={[-30, 30]}
          activeOffsetY={[-10000, 10000]}
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
                    {/* Current progress bar behind text */}
                    <Animated.View style={[styles.progressBar, progressBarStyle]} />

                    {/* Preview progress bar (only visible during gesture) */}
                    {showPreview && (
                      <Animated.View style={[styles.previewProgressBar, previewProgressBarStyle]} />
                    )}

                    {/* Text overlay */}
                    <View style={styles.percentageTextOverlay}>
                      <Animated.Text style={[styles.percentageText, textStyle]}>
                        {`${formatPercentage(percentage)}%`}
                      </Animated.Text>
                      {/* {showPreview && (
                        <Text style={styles.previewPercentageText}>
                          → {formatPercentage(previewPercentage)}%
                        </Text>
                      )} */}
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
      prevProps.theme === nextProps.theme &&
      prevProps.showPreview === nextProps.showPreview &&
      prevProps.previewPercentage === nextProps.previewPercentage
    );
  }
);

MemoizedMintItem.displayName = 'MintItem';

// Export the memoized component as MintItem for clean usage
const MintItemComponent = MemoizedMintItem;

function MintSelectComponent({
  onMintSelected,
  unit,
  startInEditing,
  onCancel,
  onSaved,
}: SelectedMintDisplayProps) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { getCurrencyAllocation, updateCurrencyAllocation } = useAllocation();

  const [mintState, setMintState] = useState<MintState>({
    selected: null,
    loadingId: null,
  });
  const [selectedCurrency, setSelectedCurrency] = useState<SupportedCurrency>(
    (unit?.toUpperCase() || 'SAT') as SupportedCurrency
  );
  const [isEditing, setIsEditing] = useState(!!startInEditing);

  React.useEffect(() => {
    if (startInEditing) {
      setIsEditing(true);
    }
  }, [startInEditing]);

  // Local state for temporary editing (before save)
  const [localMintRatios, setLocalMintRatios] = useState<Record<string, number>>({});

  // Store the mint order when editing starts to keep it stable during editing
  const [editingMintOrder, setEditingMintOrder] = useState<string[]>([]);

  // ✅ GOOD - Ref-based gesture state to avoid unnecessary re-renders
  const gestureStateRef = useRef({
    isActive: false,
    activeMintId: null as string | null,
    initialRatios: {} as Record<string, number>, // Renamed for clarity
    displayRatios: {} as Record<string, number>, // Renamed for clarity
    previewPercentage: 0, // Preview percentage for the active mint
  });

  // Separate state for UI that actually needs re-renders
  const [isGestureActive, setIsGestureActive] = useState(false);
  // State to track which mint is showing preview and its value
  const [previewState, setPreviewState] = useState<{
    mintId: string | null;
    percentage: number;
  }>({ mintId: null, percentage: 0 });

  // Update without triggering re-renders unless necessary
  const updateGestureState = useCallback((updates: Partial<typeof gestureStateRef.current>) => {
    Object.assign(gestureStateRef.current, updates);

    // Only trigger re-render when isActive state changes (affects UI)
    if (updates.isActive !== undefined) {
      setIsGestureActive(updates.isActive);

      // Clear preview state when gesture ends
      if (!updates.isActive) {
        setPreviewState({ mintId: null, percentage: 0 });
      }
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

  // Clear local state when currency changes (unless editing)
  React.useEffect(() => {
    if (!isEditing) {
      setLocalMintRatios({});
      setEditingMintOrder([]);
    }
  }, [selectedCurrency, isEditing]);

  const multipleBalances = useSelector(memoizedGetAllBalancesMultipleCurrencies);
  // limit to specified currencies: sat, eur, gbp, usd
  const currencies: any = _.uniq(multipleBalances.map((b) => b.unit?.toUpperCase())).filter((c) =>
    ['SAT', 'USD', 'EUR', 'GBP'].includes(c)
  );

  // Get current mint ratios - from local state when editing, from Redux when not
  const currentMintRatios = useMemo(() => {
    const reduxRatios = getCurrencyAllocation(selectedCurrency.toLowerCase());

    if (isEditing) {
      // When editing, use local state if available, otherwise return Redux ratios
      // (initialization happens in useEffect)
      return Object.keys(localMintRatios).length > 0 ? localMintRatios : reduxRatios;
    } else {
      // When not editing, always use Redux
      return reduxRatios;
    }
  }, [selectedCurrency, isEditing, localMintRatios, getCurrencyAllocation]);

  // Initialize local state when entering edit mode
  React.useEffect(() => {
    if (isEditing && Object.keys(localMintRatios).length === 0) {
      const reduxRatios = getCurrencyAllocation(selectedCurrency.toLowerCase());
      setLocalMintRatios(reduxRatios);
    }
  }, [isEditing, selectedCurrency, localMintRatios, getCurrencyAllocation]);

  // Filter and sort mints based on the selected currency and view mode - optimized with useMemo
  const filteredMints = useMemo(() => {
    const mints = multipleBalances.filter((mint) => mint.unit?.toUpperCase() === selectedCurrency);

    // Always update ref with current ratios
    latestRatiosRef.current = currentMintRatios;

    // Sort based on view mode
    let sortedMints: typeof mints;

    if (isEditing && editingMintOrder.length > 0) {
      // In editing mode with stored order: maintain the stable order
      sortedMints = [...mints].sort((a, b) => {
        const indexA = editingMintOrder.indexOf(a.mintUrl);
        const indexB = editingMintOrder.indexOf(b.mintUrl);
        // If mint not found in stored order, put it at the end
        const finalIndexA = indexA === -1 ? editingMintOrder.length : indexA;
        const finalIndexB = indexB === -1 ? editingMintOrder.length : indexB;
        return finalIndexA - finalIndexB;
      });
    } else {
      // Default view or first time entering edit: sort by balance (highest first)
      sortedMints = [...mints].sort((a, b) => (b.amount || 0) - (a.amount || 0));
    }

    return sortedMints;
  }, [multipleBalances, selectedCurrency, currentMintRatios, isEditing, editingMintOrder]);

  // Initialize ratios when needed (moved from useMemo to prevent re-render loops)
  React.useEffect(() => {
    if (filteredMints.length > 0 && Object.keys(currentMintRatios).length === 0) {
      const mintIds = filteredMints.map((mint) => mint.mintUrl);
      const newRatios = initializeRatios(mintIds);

      // Update ref
      latestRatiosRef.current = newRatios;

      // Set local ratios for editing
      setLocalMintRatios(newRatios);

      // Validate ratios sum correctly (temporarily disabled)
      // validateRatios(newRatios, 'Initial Setup');
    }
  }, [filteredMints, currentMintRatios]);

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
      setLocalMintRatios((_prev) => {
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
      const initialPercentage = ratioToPercentage(currentMintRatios[mintId] || 0);

      updateGestureState({
        // Capture initial state only once at gesture start
        isActive: true,
        activeMintId: mintId,
        initialRatios: { ...currentMintRatios }, // Only copy once at start
        displayRatios: { ...currentMintRatios }, // Only copy once at start
        previewPercentage: initialPercentage,
      });

      // Set initial preview state
      setPreviewState({
        mintId: mintId,
        percentage: initialPercentage,
      });
    },
    [currentMintRatios, updateGestureState]
  );

  // Real-time gesture update for smooth dragging
  const handleGestureUpdate = useCallback(
    (mintId: string, newPercentage: number) => {
      // ✅ SMOOTH - No throttling for visual updates, direct animated value updates
      const ratiosCopy = { ...gestureStateRefForThrottled.current.initialRatios };
      const calculatedRatios = rebalanceProportionally(
        ratiosCopy, // Work on copy to preserve initial state
        mintId,
        newPercentage // Function handles percentage-to-ratio conversion internally
      );

      // ✅ SMOOTH - Direct assignment without re-render
      gestureStateRef.current.displayRatios = calculatedRatios;
      gestureStateRef.current.previewPercentage = newPercentage;

      // Update preview state for UI - minimal throttling just for React state
      setPreviewState({
        mintId: mintId,
        percentage: newPercentage,
      });
    },
    [rebalanceProportionally] // Include the dependency
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

  const handleSplitEvenly = () => {
    // Find mints with ratios > 0
    const mintsWithRatio = Object.entries(currentMintRatios)
      .filter(([_, ratio]) => ratio > 0)
      .map(([mintId]) => mintId);

    if (mintsWithRatio.length === 0) return;

    // Calculate equal distribution
    const equalRatio = Math.floor(RATIO_PRECISION / mintsWithRatio.length);
    const remainder = RATIO_PRECISION - equalRatio * (mintsWithRatio.length - 1);

    const newRatios: Record<string, number> = { ...currentMintRatios };

    // Reset all mint ratios to 0 first
    Object.keys(newRatios).forEach((mintId) => {
      newRatios[mintId] = 0;
    });

    // Distribute evenly among selected mints
    mintsWithRatio.forEach((mintId, index) => {
      newRatios[mintId] = index === 0 ? remainder : equalRatio;
    });

    setLocalMintRatios(newRatios);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleSaveEdit = async () => {
    const reduxRatios = getCurrencyAllocation(selectedCurrency.toLowerCase());

    // Calculate reallocations properly
    const reallocations: {
      fromMint: string;
      toMint: string;
      amount: number;
      unit: string;
      percentage: number;
    }[] = [];

    // Get all mints involved in this currency
    const currentMints = multipleBalances.filter(
      (mint) => mint.unit?.toUpperCase() === selectedCurrency
    );

    if (currentMints.length === 0) {
      // No balances for this currency, nothing to reallocate
      updateCurrencyAllocation(selectedCurrency.toLowerCase(), localMintRatios);
      setIsEditing(false);
      setLocalMintRatios({});
      setEditingMintOrder([]);
      updateGestureState({
        isActive: false,
        activeMintId: null,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    }

    // Calculate total balance across all mints for this currency
    const totalBalance = currentMints.reduce((sum, mint) => sum + mint.amount, 0);

    // Calculate current and target balances for each mint
    const mintBalanceChanges: {
      mintUrl: string;
      currentBalance: number;
      targetBalance: number;
      difference: number;
    }[] = [];

    // Get all mint URLs from both current and target ratios
    const allMintUrls = new Set([
      ...Object.keys(reduxRatios),
      ...Object.keys(localMintRatios),
      ...currentMints.map((m) => m.mintUrl),
    ]);

    allMintUrls.forEach((mintUrl) => {
      const currentBalance = currentMints.find((m) => m.mintUrl === mintUrl)?.amount || 0;
      const targetRatio = localMintRatios[mintUrl] || 0;
      const targetPercentage = ratioToPercentage(targetRatio);
      const targetBalance = Math.round((totalBalance * targetPercentage) / 100);
      const difference = targetBalance - currentBalance;

      if (Math.abs(difference) > 0) {
        mintBalanceChanges.push({
          mintUrl,
          currentBalance,
          targetBalance,
          difference,
        });
      }
    });

    // Separate into surplus (negative difference) and deficit (positive difference) mints
    const surplusMints = mintBalanceChanges.filter((m) => m.difference < 0);
    const deficitMints = mintBalanceChanges.filter((m) => m.difference > 0);

    // Create transfers from surplus to deficit mints
    let totalTransferred = 0;

    surplusMints.forEach((surplusMint) => {
      let remainingToTransfer = Math.abs(surplusMint.difference);

      deficitMints.forEach((deficitMint) => {
        if (remainingToTransfer <= 0) return;

        const neededByDeficit = deficitMint.difference;
        const actualTransfer = Math.min(remainingToTransfer, neededByDeficit);

        if (actualTransfer > 0) {
          const transferPercentage = (actualTransfer / surplusMint.currentBalance) * 100;

          reallocations.push({
            fromMint: surplusMint.mintUrl,
            toMint: deficitMint.mintUrl,
            amount: actualTransfer,
            unit: selectedCurrency.toLowerCase(),
            percentage: transferPercentage,
          });

          remainingToTransfer -= actualTransfer;
          deficitMint.difference -= actualTransfer; // Reduce the deficit
          totalTransferred += actualTransfer;
        }
      });
    });

    // If no meaningful changes, just save directly
    if (reallocations.length === 0) {
      updateCurrencyAllocation(selectedCurrency.toLowerCase(), localMintRatios);
      setIsEditing(false);
      setLocalMintRatios({});
      setEditingMintOrder([]);
      updateGestureState({
        isActive: false,
        activeMintId: null,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    }

    // Show reallocation confirmation
    try {
      const result = await SheetManager.show('reallocate-accepter', {
        payload: {
          reallocations,
          totalAmount: totalTransferred,
          unit: selectedCurrency.toLowerCase(),
        },
      });

      if (result?.confirmed) {
        // User confirmed - save the changes
        updateCurrencyAllocation(selectedCurrency.toLowerCase(), localMintRatios);
        // Exit editing mode
        setIsEditing(false);
        // Clear local ratios since they're now saved
        setLocalMintRatios({});
        // Clear the stored editing order
        setEditingMintOrder([]);
        // Clear any gesture state
        updateGestureState({
          isActive: false,
          activeMintId: null,
        });
        // Haptic feedback for successful save
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        // If used inside dedicated sheet, close it after successful save
        if (onSaved) {
          onSaved();
        }
      }
      // If not confirmed, do nothing - stay in editing mode
    } catch (error) {
      console.error('Error showing reallocation confirmation:', error);
      // Fallback - save without confirmation
      updateCurrencyAllocation(selectedCurrency.toLowerCase(), localMintRatios);
      setIsEditing(false);
      setLocalMintRatios({});
      setEditingMintOrder([]);
      updateGestureState({
        isActive: false,
        activeMintId: null,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  };

  const handleCancelEdit = () => {
    // Revert to original values without saving
    setIsEditing(false);
    // Clear local ratios to revert to Redux state
    setLocalMintRatios({});
    // Clear the stored editing order
    setEditingMintOrder([]);
    // Clear any gesture state
    updateGestureState({
      isActive: false,
      activeMintId: null,
    });
    // If embedded inside dedicated reallocation sheet, close it
    if (onCancel) {
      onCancel();
    }
  };

  // Left for reference; editing is now launched in a dedicated sheet
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleStartEdit = () => {
    // Clear any gesture state when entering edit mode
    updateGestureState({
      isActive: false,
      activeMintId: null,
    });
    // Initialize local ratios from Redux when starting edit
    const reduxRatios = getCurrencyAllocation(selectedCurrency.toLowerCase());
    setLocalMintRatios(reduxRatios);

    // Capture the initial order sorted by percentages for stable editing
    const mintsForCurrentCurrency = multipleBalances.filter(
      (mint) => mint.unit?.toUpperCase() === selectedCurrency
    );
    const sortedByPercentage = [...mintsForCurrentCurrency].sort((a, b) => {
      const percentageA = ratioToPercentage(reduxRatios[a.mintUrl] || 0);
      const percentageB = ratioToPercentage(reduxRatios[b.mintUrl] || 0);
      return percentageB - percentageA;
    });
    setEditingMintOrder(sortedByPercentage.map((mint) => mint.mintUrl));

    setIsEditing(true);
  };

  const router = useSheetRouter('mint');

  return (
    <Wrapper
      buttons={
        <ButtonHandler
          buttons={[
            ...(isEditing
              ? [
                  {
                    text: 'Cancel',
                    variant: 'secondary' as const,
                    onPress: async () => {
                      handleCancelEdit();
                    },
                    disabled: !isEditing,
                  },
                  {
                    text: 'Save',
                    variant: 'primary' as const,
                    onPress: async () => {
                      await handleSaveEdit();
                    },
                    disabled: !isEditing,
                  },
                ]
              : [
                  {
                    text: 'Cancel',
                    variant: 'secondary' as const,
                    onPress: async () => {
                      router?.goBack();
                    },
                    loading: mintState.loadingId !== null,
                    disabled: isEditing,
                  },
                  {
                    text: 'Add mints',
                    variant: 'primary' as const,
                    onPress: async () => {
                      router?.navigate('mintAddMore');
                    },
                    loading: mintState.loadingId !== null,
                    disabled: isEditing,
                  },
                  {
                    text: 'Reallocate',
                    variant: 'primary' as const,
                    icon: 'material-symbols:pie-chart',
                    onPress: async () => {
                      await SheetManager.show('mint-reallocation', {
                        payload: {
                          currency: selectedCurrency,
                        },
                      });
                    },
                    loading: mintState.loadingId !== null,
                    disabled: isEditing,
                  },
                ]),
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
          {isEditing && (
            <TouchableOpacity
              onPress={handleSplitEvenly}
              style={[styles.editButtonContainer, { marginRight: 8 }]}>
              <View style={styles.splitButtonContent}>
                <Icon name="radix-icons:half-2" size={16} color={theme.shades[200]} />
                <Text style={[styles.editButton, { marginLeft: 4 }]}>Split</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
        <View>
          {filteredMints.map((mint) => {
            // Get the correct percentage to display from ratios
            // Only the actively dragged mint gets real-time updates, others stay static during gesture
            const displayPercentage =
              gestureStateRef.current.isActive &&
              gestureStateRef.current.activeMintId === mint.mintUrl
                ? ratioToPercentage(gestureStateRef.current.displayRatios[mint.mintUrl] || 0)
                : ratioToPercentage(currentMintRatios[mint.mintUrl] || 0);

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
                isAnyGestureActive={isGestureActive}
                onGestureStart={handleGestureStart}
                onGestureUpdate={handleGestureUpdate}
                onGestureEnd={handleGestureEnd}
                onIncrement={buttonHandlers?.increment}
                onDecrement={buttonHandlers?.decrement}
                showPreview={previewState.mintId === mint.mintUrl}
                previewPercentage={previewState.percentage}
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

MintSelectComponent.displayName = 'MintSelectComponent';

export const MintSelect = withSheetProvider(MintSelectComponent);

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
    splitButtonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
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
    previewProgressBar: {
      position: 'absolute',
      left: 0,
      top: 0,
      height: '100%',
      // backgroundColor: theme.shades[300], // Use theme accent color for preview
      borderRadius: 8,
      zIndex: 2, // Above the regular progress bar
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
    previewPercentageText: {
      color: theme.shades[200],
      fontSize: 14,
      fontWeight: '500',
      marginTop: 2,
      textAlign: 'center',
    },
  });
