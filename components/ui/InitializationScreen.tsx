import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, ScrollView } from 'react-native';
import { View } from './View';
import { Text } from './Text';
import { useInitializationContext } from '@/providers/InitializationProvider';

/**
 * InitializationScreen displays loading states with modern AI-inspired animations
 * Design inspired by v0, Claude, and ChatGPT loading patterns:
 * - Current step centered and prominent
 * - Text pulse animation (skeleton-loader style)
 * - Smooth vertical scrolling with progressive fade
 * - Clean, shadcn-inspired aesthetic
 */
export function InitializationScreen() {
  console.log('[InitializationScreen] Component rendering');
  const { logHistory, currentStage, isInitializing } = useInitializationContext();
  const scrollViewRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Mount logging
  useEffect(() => {
    console.log('[InitializationScreen] Component mounted');
    return () => {
      console.log('[InitializationScreen] Component unmounted');
    };
  }, []);

  // Debug logging
  useEffect(() => {
    console.log('[InitializationScreen] State update:');
    console.log('  - isInitializing:', isInitializing);
    console.log('  - logHistory length:', logHistory.length);
    console.log('  - currentStage:', currentStage);
  }, [isInitializing, logHistory, currentStage]);

  // Smooth pulse animation for current step (skeleton-loader style)
  useEffect(() => {
    if (currentStage) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.4,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();

      return () => {
        animation.stop();
      };
    } else {
      pulseAnim.setValue(1);
    }
  }, [currentStage, pulseAnim]);

  // Smooth scroll to keep current step centered
  useEffect(() => {
    if (logHistory.length > 0 && scrollViewRef.current) {
      // Delay to allow content to render
      const timer = setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 150);

      return () => clearTimeout(timer);
    }
  }, [logHistory.length]);

  if (!isInitializing) {
    return null;
  }

  return (
    <View style={styles.overlay}>
      <View style={styles.container}>
        <View style={styles.content}>
          {/* Previous steps - scrollable with progressive fade */}
          <ScrollView
            ref={scrollViewRef}
            style={styles.historyContainer}
            contentContainerStyle={styles.historyContent}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}>
            {logHistory.map((entry, index) => {
              // Progressive fade: newer items more visible
              const position = logHistory.length - index;
              const opacity = Math.max(0.2, Math.min(1, position / 8));

              return (
                <View
                  key={`${entry.stageId}-${entry.timestamp}-${index}`}
                  style={styles.historyEntry}>
                  <Text style={[styles.historyText, { opacity }]}>{entry.message}</Text>
                </View>
              );
            })}
          </ScrollView>

          {/* Current step - centered and prominent with pulse animation */}
          {currentStage && (
            <View style={styles.currentStepContainer}>
              <Animated.View style={styles.currentStepContent}>
                <Animated.Text
                  style={[
                    styles.currentStepText,
                    {
                      opacity: pulseAnim,
                    },
                  ]}>
                  {currentStage.message}
                </Animated.Text>

                {/* Subtle animated indicator */}
                <View style={styles.indicatorContainer}>
                  <Animated.View
                    style={[
                      styles.indicator,
                      {
                        opacity: pulseAnim.interpolate({
                          inputRange: [0.4, 1],
                          outputRange: [0.3, 1],
                        }),
                      },
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.indicator,
                      styles.indicatorDelayed,
                      {
                        opacity: pulseAnim.interpolate({
                          inputRange: [0.4, 1],
                          outputRange: [0.2, 0.8],
                        }),
                      },
                    ]}
                  />
                  <Animated.View
                    style={[
                      styles.indicator,
                      styles.indicatorDelayed2,
                      {
                        opacity: pulseAnim.interpolate({
                          inputRange: [0.4, 1],
                          outputRange: [0.1, 0.6],
                        }),
                      },
                    ]}
                  />
                </View>
              </Animated.View>

              {/* Error state */}
              {currentStage.error && (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{currentStage.error}</Text>
                </View>
              )}
            </View>
          )}

          {/* Spacer to keep current step centered */}
          <View style={styles.bottomSpacer} />
        </View>
      </View>
    </View>
  );
}

const { height } = Dimensions.get('window');

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    backgroundColor: '#000',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 480,
    height: '100%',
    paddingHorizontal: 24,
    justifyContent: 'center',
  },

  // History/Previous steps
  historyContainer: {
    maxHeight: height * 0.35,
    marginBottom: 24,
  },
  historyContent: {
    paddingTop: 32,
    paddingBottom: 8,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  historyEntry: {
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  historyText: {
    color: '#71717a', // zinc-500
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 20,
    letterSpacing: -0.2,
  },

  // Current step - centered
  currentStepContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    minHeight: 120,
  },
  currentStepContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentStepText: {
    color: '#fafafa', // zinc-50
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 24,
    letterSpacing: -0.3,
    paddingHorizontal: 16,
  },

  // Subtle animated indicator dots
  indicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    gap: 6,
  },
  indicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#71717a', // zinc-500
  },
  indicatorDelayed: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  indicatorDelayed2: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },

  // Bottom spacer
  bottomSpacer: {
    height: height * 0.35,
  },

  // Error state
  errorContainer: {
    marginTop: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.1)', // red-500 with opacity
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: {
    color: '#ef4444', // red-500
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 18,
  },
});
