import React, { createContext, useContext, useEffect, useCallback, ReactNode } from 'react';
import { useSharedValue, withTiming, SharedValue, Easing } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';

/**
 * Blur mode options for background configuration
 */
export type BlurMode = 'none' | 'partial' | 'full' | 'gradient';

/**
 * Configuration for background blur effects
 */
export interface BackgroundConfig {
  blurMode: BlurMode;
  blurIntensity?: number;
  blurGradientStart?: number;
  blurGradientEnd?: number;
}

/**
 * Animation configuration
 */
const ANIMATION_CONFIG = {
  duration: 300,
  easing: Easing.bezier(0.25, 0.1, 0.25, 1),
};

/**
 * Default configurations for each blur mode
 */
const DEFAULT_CONFIGS: Record<BlurMode, Required<Omit<BackgroundConfig, 'blurMode'>>> = {
  none: {
    blurIntensity: 0,
    blurGradientStart: 0.3,
    blurGradientEnd: 0.6,
  },
  partial: {
    blurIntensity: 200,
    blurGradientStart: 0.3,
    blurGradientEnd: 0.6,
  },
  full: {
    blurIntensity: 200,
    blurGradientStart: 0,
    blurGradientEnd: 0.1,
  },
  gradient: {
    blurIntensity: 200,
    blurGradientStart: 0.3,
    blurGradientEnd: 0.6,
  },
};

/**
 * Context value type with shared values for animations
 */
interface BackgroundContextValue {
  // Current blur mode (for conditional rendering)
  blurMode: SharedValue<number>; // 0=none, 1=partial, 2=full, 3=gradient
  // Animated values
  blurIntensity: SharedValue<number>;
  blurGradientStart: SharedValue<number>;
  blurGradientEnd: SharedValue<number>;
  // For partial mode: controls opacity of fixed bottom blur
  partialBlurOpacity: SharedValue<number>;
  // For full mode: controls opacity of full blur
  fullBlurOpacity: SharedValue<number>;
  // Method to update config
  setConfig: (config: BackgroundConfig) => void;
}

const BackgroundContext = createContext<BackgroundContextValue | null>(null);

interface BackgroundProviderProps {
  children: ReactNode;
}

/**
 * Provider component that manages shared background state across tabs
 */
export function BackgroundProvider({ children }: BackgroundProviderProps) {
  // Shared values for animations
  const blurMode = useSharedValue(1); // Start with partial
  const blurIntensity = useSharedValue(200);
  const blurGradientStart = useSharedValue(0.3);
  const blurGradientEnd = useSharedValue(0.6);
  const partialBlurOpacity = useSharedValue(1);
  const fullBlurOpacity = useSharedValue(0);

  const setConfig = useCallback(
    (config: BackgroundConfig) => {
      const defaults = DEFAULT_CONFIGS[config.blurMode];
      const intensity = config.blurIntensity ?? defaults.blurIntensity;
      const gradientStart = config.blurGradientStart ?? defaults.blurGradientStart;
      const gradientEnd = config.blurGradientEnd ?? defaults.blurGradientEnd;

      // Map blur mode to number
      const modeMap: Record<BlurMode, number> = {
        none: 0,
        partial: 1,
        full: 2,
        gradient: 3,
      };

      // Animate to new values
      blurMode.value = modeMap[config.blurMode];
      blurIntensity.value = withTiming(intensity, ANIMATION_CONFIG);
      blurGradientStart.value = withTiming(gradientStart, ANIMATION_CONFIG);
      blurGradientEnd.value = withTiming(gradientEnd, ANIMATION_CONFIG);

      // Animate opacity based on mode
      switch (config.blurMode) {
        case 'none':
          partialBlurOpacity.value = withTiming(0, ANIMATION_CONFIG);
          fullBlurOpacity.value = withTiming(0, ANIMATION_CONFIG);
          break;
        case 'partial':
          partialBlurOpacity.value = withTiming(1, ANIMATION_CONFIG);
          fullBlurOpacity.value = withTiming(0, ANIMATION_CONFIG);
          break;
        case 'full':
          partialBlurOpacity.value = withTiming(0, ANIMATION_CONFIG);
          fullBlurOpacity.value = withTiming(1, ANIMATION_CONFIG);
          break;
        case 'gradient':
          partialBlurOpacity.value = withTiming(0, ANIMATION_CONFIG);
          fullBlurOpacity.value = withTiming(0, ANIMATION_CONFIG);
          break;
      }
    },
    [blurMode, blurIntensity, blurGradientStart, blurGradientEnd, partialBlurOpacity, fullBlurOpacity]
  );

  const value: BackgroundContextValue = {
    blurMode,
    blurIntensity,
    blurGradientStart,
    blurGradientEnd,
    partialBlurOpacity,
    fullBlurOpacity,
    setConfig,
  };

  return <BackgroundContext.Provider value={value}>{children}</BackgroundContext.Provider>;
}

/**
 * Hook to access background context
 */
export function useBackgroundContext() {
  const context = useContext(BackgroundContext);
  if (!context) {
    throw new Error('useBackgroundContext must be used within a BackgroundProvider');
  }
  return context;
}

/**
 * Hook for tab screens to register their blur configuration
 * Automatically updates when the screen gains focus
 */
export function useBackgroundConfig(config: BackgroundConfig) {
  const context = useContext(BackgroundContext);

  useFocusEffect(
    useCallback(() => {
      if (context) {
        context.setConfig(config);
      }
    }, [context, config.blurMode, config.blurIntensity, config.blurGradientStart, config.blurGradientEnd])
  );
}

/**
 * Optional hook for screens outside the provider (returns no-op if not in provider)
 */
export function useOptionalBackgroundConfig(config: BackgroundConfig) {
  const context = useContext(BackgroundContext);

  useFocusEffect(
    useCallback(() => {
      if (context) {
        context.setConfig(config);
      }
    }, [context, config.blurMode, config.blurIntensity, config.blurGradientStart, config.blurGradientEnd])
  );
}

