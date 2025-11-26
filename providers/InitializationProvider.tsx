import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
  useRef,
  memo,
} from 'react';
import { Animated, Easing, Dimensions } from 'react-native';
import { View } from '@/components/ui/View';
import { Text } from '@/components/ui/Text';
import Icon from '@/assets/icons';
import { LinearGradient } from 'expo-linear-gradient';

export type StageStatus = 'pending' | 'loading' | 'complete' | 'error';

export interface Stage {
  id: string;
  message: string;
  status: StageStatus;
  dependsOn?: string[];
  error?: string;
  timestamp: number;
}

interface InitializationContextValue {
  stages: Map<string, Stage>;
  logHistory: { message: string; timestamp: number; stageId: string }[];
  currentStage: Stage | null;
  isInitializing: boolean;
  registerStage: (
    id: string,
    config: { message?: string; dependsOn?: string[]; blocking?: boolean }
  ) => void;
  updateStage: (
    id: string,
    updates: { message?: string; status?: StageStatus; error?: string }
  ) => void;
  canStageStart: (id: string) => boolean;
  startTestAnimation: () => void;
}

const InitializationContext = createContext<InitializationContextValue>({
  stages: new Map(),
  logHistory: [],
  currentStage: null,
  isInitializing: false,
  registerStage: () => {},
  updateStage: () => {},
  canStageStart: () => true,
  startTestAnimation: () => {},
});

export { InitializationContext };

export const useInitializationContext = () => {
  return useContext(InitializationContext);
};

interface InitializationProviderProps {
  children: ReactNode;
  forceVisible?: boolean;
  testMode?: boolean;
}

export function InitializationProvider({
  children,
  forceVisible = false,
  testMode = false,
}: InitializationProviderProps) {
  const [stages, setStages] = useState<Map<string, Stage>>(new Map());
  const [logHistory, setLogHistory] = useState<
    { message: string; timestamp: number; stageId: string }[]
  >([]);
  const [isTestMode, setIsTestMode] = useState(testMode);
  // Track pending log updates per stage to debounce rapid calls
  const pendingLogUpdates = useRef<Map<string, { message: string; timeout: NodeJS.Timeout }>>(
    new Map()
  );

  const registerStage = useCallback(
    (id: string, config: { message?: string; dependsOn?: string[]; blocking?: boolean }) => {
      setStages((prev) => {
        if (prev.has(id)) {
          return prev;
        }
        console.log(`[InitializationProvider] Registering stage: ${id}`, config);
        const newStages = new Map(prev);
        newStages.set(id, {
          id,
          message: config.message || `Initializing ${id}...`,
          status: 'pending',
          dependsOn: config.dependsOn,
          timestamp: Date.now(),
        });
        console.log(`[InitializationProvider] Stage ${id} registered as pending`);
        return newStages;
      });
    },
    []
  );

  const updateStage = useCallback(
    (id: string, updates: { message?: string; status?: StageStatus; error?: string }) => {
      console.log(`[InitializationProvider] Updating stage: ${id}`, updates);

      // Always update stage status immediately (for status changes like 'complete', 'error')
      setStages((prev) => {
        const newStages = new Map(prev);
        const stage = newStages.get(id);
        if (stage) {
          const updatedStage = {
            ...stage,
            ...updates,
            timestamp: Date.now(),
          };
          newStages.set(id, updatedStage);
        }
        return newStages;
      });

      // Handle log history updates
      if (updates.message || updates.status === 'complete') {
        // If status is 'complete', flush any pending log for this stage immediately
        if (updates.status === 'complete') {
          const pending = pendingLogUpdates.current.get(id);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingLogUpdates.current.delete(id);
            // Add the pending message immediately
            setLogHistory((prevLog) => {
              const recentEntry = prevLog.find(
                (entry) => entry.stageId === id && entry.message === pending.message
              );
              if (recentEntry) return prevLog;
              return [...prevLog, { message: pending.message, timestamp: Date.now(), stageId: id }];
            });
          }
          return;
        }

        // For message updates, add immediately but dedupe rapid identical messages
        if (updates.message) {
          const message = updates.message;
          // Clear any pending update for this stage
          const pending = pendingLogUpdates.current.get(id);
          if (pending) {
            clearTimeout(pending.timeout);
          }

          // Add to log immediately (no debounce) for better visual feedback
          const now = Date.now();
          setLogHistory((prevLog) => {
            // Dedupe: don't add if same message was added very recently for this stage
            const recentEntry = prevLog.find(
              (entry) =>
                entry.stageId === id && entry.message === message && now - entry.timestamp < 100
            );

            if (recentEntry) {
              return prevLog;
            }

            console.log(`[InitializationProvider] Adding to log history: ${message}`);
            return [
              ...prevLog,
              {
                message,
                timestamp: now,
                stageId: id,
              },
            ];
          });

          // Track as pending in case stage completes immediately after
          pendingLogUpdates.current.set(id, {
            message,
            timeout: setTimeout(() => {
              pendingLogUpdates.current.delete(id);
            }, 50),
          });
        }
      }
    },
    []
  );

  const canStageStart = useCallback(
    (id: string): boolean => {
      const stage = stages.get(id);
      if (!stage || !stage.dependsOn || stage.dependsOn.length === 0) {
        return true;
      }

      return stage.dependsOn.every((depId) => {
        const depStage = stages.get(depId);
        return depStage && depStage.status === 'complete';
      });
    },
    [stages]
  );

  // Find currentStage based on the most recent log entry, not just the first 'loading' stage
  // This ensures the pulsing animation matches what's actually being displayed
  const currentStage = (() => {
    if (logHistory.length === 0) {
      // Fallback to first loading stage if no log history yet
      return (
        Array.from(stages.values()).find(
          (stage) => stage.status === 'loading' || stage.status === 'error'
        ) || null
      );
    }

    // Get the most recent log entry
    const mostRecentLog = logHistory[logHistory.length - 1];
    const stageId = mostRecentLog.stageId;
    const stage = stages.get(stageId);

    // If the stage exists and is still loading/error, use it
    if (stage && (stage.status === 'loading' || stage.status === 'error')) {
      return stage;
    }

    // Fallback to first loading stage if most recent log's stage is complete
    return (
      Array.from(stages.values()).find(
        (stage) => stage.status === 'loading' || stage.status === 'error'
      ) || null
    );
  })();

  const isInitializing =
    forceVisible ||
    isTestMode ||
    Array.from(stages.values()).some(
      (stage) => stage.status === 'loading' || stage.status === 'pending'
    );

  const startTestAnimation = useCallback(() => {
    console.log('[InitializationProvider] Starting test animation');
    setIsTestMode(true);
    setStages(new Map());
    setLogHistory([]);

    const mockSteps = [
      { message: 'Initializing application...', delay: 500 },
      { message: 'Loading configuration...', delay: 800 },
      { message: 'Connecting to services...', delay: 1000 },
      { message: 'Verifying credentials...', delay: 700 },
      { message: 'Syncing data...', delay: 900 },
      { message: 'Preparing workspace...', delay: 600 },
      { message: 'Loading user preferences...', delay: 500 },
      { message: 'Finalizing setup...', delay: 800 },
      { message: 'Initializing application...', delay: 500 },
      { message: 'Loading configuration...', delay: 800 },
      { message: 'Connecting to services...', delay: 1000 },
      { message: 'Verifying credentials...', delay: 700 },
      { message: 'Syncing data...', delay: 900 },
      { message: 'Preparing workspace...', delay: 600 },
      { message: 'Loading user preferences...', delay: 500 },
      { message: 'Finalizing setup...', delay: 800 },
    ];

    let currentDelay = 0;
    mockSteps.forEach((step, index) => {
      currentDelay += step.delay;
      setTimeout(() => {
        setLogHistory((prev) => [
          ...prev,
          {
            message: step.message,
            timestamp: Date.now(),
            stageId: `test-${index}`,
          },
        ]);

        setStages((prev) => {
          const newStages = new Map(prev);
          if (index > 0) {
            const prevStageId = `test-${index - 1}`;
            const prevStage = newStages.get(prevStageId);
            if (prevStage) {
              newStages.set(prevStageId, { ...prevStage, status: 'complete' });
            }
          }
          newStages.set(`test-${index}`, {
            id: `test-${index}`,
            message: step.message,
            status: 'loading',
            timestamp: Date.now(),
          });
          return newStages;
        });

        if (index === mockSteps.length - 1) {
          setTimeout(() => {
            setStages((prev) => {
              const newStages = new Map(prev);
              const lastStage = newStages.get(`test-${index}`);
              if (lastStage) {
                newStages.set(`test-${index}`, { ...lastStage, status: 'complete' });
              }
              return newStages;
            });
            setTimeout(() => {
              console.log('[InitializationProvider] Test animation complete');
              setIsTestMode(false);
            }, 1000);
          }, 500);
        }
      }, currentDelay);
    });
  }, []);

  // Cleanup pending timeouts on unmount
  useEffect(() => {
    const pendingUpdates = pendingLogUpdates.current;
    return () => {
      pendingUpdates.forEach((update) => {
        clearTimeout(update.timeout);
      });
      pendingUpdates.clear();
    };
  }, []);

  useEffect(() => {
    console.log('[InitializationProvider] State update:');
    console.log('  - Total stages:', stages.size);
    console.log('  - Log history entries:', logHistory.length);
    console.log('  - Current stage:', currentStage?.id, currentStage?.message);
    console.log('  - Is initializing:', isInitializing);
    console.log(
      '  - All stages:',
      Array.from(stages.entries()).map(([id, s]) => ({ id, status: s.status }))
    );
  }, [stages, logHistory, currentStage, isInitializing]);

  const contextValue: InitializationContextValue = {
    stages,
    logHistory,
    currentStage,
    isInitializing,
    registerStage,
    updateStage,
    canStageStart,
    startTestAnimation,
  };

  // Render children directly without Animated.View wrapper to preserve native blur effects (liquid glass)
  // The InitializationScreenInternal handles its own overlay and fade out
  return (
    <InitializationContext.Provider value={contextValue}>
      {children}
      <InitializationScreenInternal />
    </InitializationContext.Provider>
  );
}

// Animated checkmark icon that fades in when complete
function AnimatedCheckmark({
  isCompleted,
  color,
}: {
  isCompleted: boolean;
  isActive: boolean;
  color: string;
}) {
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacityAnim, {
      toValue: isCompleted ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isCompleted, opacityAnim]);

  return (
    <Animated.View style={{ opacity: opacityAnim, marginRight: 4 }}>
      <Icon name="mdi-light:check" size={20} color={color} />
    </Animated.View>
  );
}

// Pulsing text for active loading step
function PulsingText({ children }: { children: string }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.5,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  return (
    <Animated.Text
      numberOfLines={1}
      style={{
        color: 'rgba(255, 255, 255, 1)',
        fontSize: 14,
        fontWeight: '500',
        lineHeight: 20,
        textAlign: 'center',
        opacity: pulseAnim,
        flexShrink: 1,
      }}>
      {children}
    </Animated.Text>
  );
}

// Animated Step Item with fade-in
const AnimatedStepItem = memo(function AnimatedStepItem({
  height,
  entry,
  isActive,
  isCompleted,
  shouldAnimate,
}: {
  height: number;
  entry: { message: string; timestamp: number; stageId: string };
  isActive: boolean;
  isCompleted: boolean;
  shouldAnimate: boolean;
}) {
  const fadeAnim = useRef(new Animated.Value(shouldAnimate ? 0 : 1)).current;
  const translateYAnim = useRef(new Animated.Value(shouldAnimate ? 15 : 0)).current;

  useEffect(() => {
    if (shouldAnimate) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(translateYAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [shouldAnimate, fadeAnim, translateYAnim]);

  return (
    <Animated.View
      style={{
        height: height,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        backgroundColor: 'transparent',
        opacity: fadeAnim,
        // transform: [{ translateY: translateYAnim }],
      }}>
      {/* Icon - always present, fades in when complete, no spacing */}
      <AnimatedCheckmark
        isCompleted={isCompleted}
        isActive={isActive}
        color={
          isActive
            ? 'rgba(255, 255, 255, 1)'
            : isCompleted
              ? 'rgba(255, 255, 255, 0.35)'
              : 'rgba(255, 255, 255, 0.5)'
        }
      />
      {/* Text - right next to icon with no spacing */}
      {isActive ? (
        <PulsingText>{entry.message}</PulsingText>
      ) : (
        <Text
          numberOfLines={1}
          style={{
            color: isCompleted ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.5)',
            fontSize: 14,
            fontWeight: '500',
            lineHeight: 20,
            textAlign: 'center',
            flexShrink: 1,
          }}>
          {entry.message}
        </Text>
      )}
    </Animated.View>
  );
});

function InitializationScreenInternal() {
  const { logHistory, currentStage, isInitializing } = useInitializationContext();
  const [seenTimestamps, setSeenTimestamps] = useState<Set<number>>(new Set());
  const [shouldRender, setShouldRender] = useState(true);
  // Track visual active index separately - ensures minimum visibility time
  const [visualActiveIndex, setVisualActiveIndex] = useState(0);
  const activeTransitionTimeout = useRef<NodeJS.Timeout | null>(null);
  const rafId = useRef<number | null>(null);
  const lastTransitionTime = useRef<number>(Date.now());
  const MINIMUM_ACTIVE_TIME = 200; // Minimum ms each step stays visually active (reduced for snappier feel)

  // Animated value for translating the entire list
  // Start at 0 - items are initially centered by the container
  const translateY = useRef(new Animated.Value(0)).current;
  // Animated opacity for fade out
  const screenOpacity = useRef(new Animated.Value(1)).current;
  const ITEM_HEIGHT = 64; // Height of each step item
  const containerHeight = Dimensions.get('window').height;

  // Calculate if we've finished showing all steps visually
  const hasShownAllSteps = logHistory.length === 0 || visualActiveIndex >= logHistory.length - 1;
  // Track if we're ready to fade (has shown all steps for minimum time)
  const [readyToFade, setReadyToFade] = useState(false);
  const fadeDelayTimeout = useRef<NodeJS.Timeout | null>(null);

  // Wait for minimum time on last step before allowing fade
  const fadeRafId = useRef<number | null>(null);
  useEffect(() => {
    if (hasShownAllSteps && !isInitializing && logHistory.length > 0) {
      // Clear any existing timeout
      if (fadeDelayTimeout.current) {
        clearTimeout(fadeDelayTimeout.current);
      }
      if (fadeRafId.current) {
        cancelAnimationFrame(fadeRafId.current);
      }
      // Wait minimum time before allowing fade, use rAF for smooth transition
      fadeDelayTimeout.current = setTimeout(() => {
        fadeRafId.current = requestAnimationFrame(() => {
          setReadyToFade(true);
        });
      }, MINIMUM_ACTIVE_TIME);
    } else {
      setReadyToFade(false);
      if (fadeDelayTimeout.current) {
        clearTimeout(fadeDelayTimeout.current);
        fadeDelayTimeout.current = null;
      }
      if (fadeRafId.current) {
        cancelAnimationFrame(fadeRafId.current);
        fadeRafId.current = null;
      }
    }

    return () => {
      if (fadeDelayTimeout.current) {
        clearTimeout(fadeDelayTimeout.current);
      }
      if (fadeRafId.current) {
        cancelAnimationFrame(fadeRafId.current);
      }
    };
  }, [hasShownAllSteps, isInitializing, logHistory.length]);

  // Fade out when initialization completes AND we've shown all steps for minimum time
  useEffect(() => {
    // Only fade out when initialization is done AND we've shown all steps AND waited minimum time
    const canFade = !isInitializing && hasShownAllSteps && (readyToFade || logHistory.length === 0);
    if (canFade && shouldRender) {
      Animated.timing(screenOpacity, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
        easing: Easing.out(Easing.ease),
      }).start(() => {
        // Hide the screen after fade out completes
        setShouldRender(false);
      });
    } else if (isInitializing) {
      // Reset opacity when initialization starts again
      screenOpacity.setValue(1);
      setShouldRender(true);
    }
  }, [
    isInitializing,
    shouldRender,
    screenOpacity,
    hasShownAllSteps,
    readyToFade,
    logHistory.length,
  ]);

  // Track completed stages for visual feedback
  const [visuallyCompletedStages, setVisuallyCompletedStages] = useState<Set<string>>(new Set());

  // Update visually completed stages based on visual active index
  // A stage is visually complete when its index is less than the visual active index
  useEffect(() => {
    if (logHistory.length === 0) return;

    const newVisuallyCompleted = new Set<string>();
    logHistory.forEach((entry, index) => {
      if (index < visualActiveIndex) {
        newVisuallyCompleted.add(entry.stageId);
      }
    });

    setVisuallyCompletedStages(newVisuallyCompleted);
  }, [visualActiveIndex, logHistory]);

  useEffect(() => {
    const currentTime = Date.now();
    const newTimestamps = new Set<number>();

    logHistory.forEach((entry) => {
      const isRecent = currentTime - entry.timestamp < 3000;
      if ((isRecent || seenTimestamps.size === 0) && !seenTimestamps.has(entry.timestamp)) {
        newTimestamps.add(entry.timestamp);
      }
    });

    if (newTimestamps.size > 0) {
      // Use requestAnimationFrame for smoother state updates
      requestAnimationFrame(() => {
        setSeenTimestamps((prev) => new Set([...prev, ...newTimestamps]));
      });
    }
  }, [logHistory, seenTimestamps]);

  // The target active index is the last log entry (most recent)
  const targetActiveIndex = logHistory.length - 1;

  // Manage visual active index with minimum visibility time using requestAnimationFrame
  useEffect(() => {
    if (logHistory.length === 0) {
      setVisualActiveIndex(0);
      lastTransitionTime.current = Date.now();
      return;
    }

    // If the target is ahead of visual, transition with minimum time
    if (targetActiveIndex > visualActiveIndex) {
      // Clear any pending transitions
      if (activeTransitionTimeout.current) {
        clearTimeout(activeTransitionTimeout.current);
      }
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }

      // Calculate how long since last transition
      const timeSinceLastTransition = Date.now() - lastTransitionTime.current;
      const remainingTime = Math.max(0, MINIMUM_ACTIVE_TIME - timeSinceLastTransition);

      // Schedule transition using setTimeout + requestAnimationFrame for smoother updates
      activeTransitionTimeout.current = setTimeout(() => {
        // Use requestAnimationFrame to sync with display refresh
        rafId.current = requestAnimationFrame(() => {
          lastTransitionTime.current = Date.now();
          setVisualActiveIndex((prev) => {
            // Move one step at a time to ensure each gets minimum visibility
            const next = Math.min(prev + 1, targetActiveIndex);
            return next;
          });
        });
      }, remainingTime);
    }

    return () => {
      if (activeTransitionTimeout.current) {
        clearTimeout(activeTransitionTimeout.current);
      }
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [targetActiveIndex, visualActiveIndex, logHistory.length]);

  // Use visual active index for display
  const activeIndex = visualActiveIndex;

  // Animate translateY to keep active item centered
  useEffect(() => {
    if (activeIndex >= 0 && logHistory.length > 0) {
      // When container uses justifyContent: 'center', items start centered
      // The first item (index 0) is already at the center, so offset = 0
      // For each subsequent item, we need to move up by (activeIndex * ITEM_HEIGHT)
      // to bring that item to the center position
      Animated.timing(translateY, {
        toValue: -(activeIndex * 32),
        duration: 400,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }).start();
    } else if (logHistory.length === 0) {
      // Reset to center when list is empty
      Animated.timing(translateY, {
        toValue: 0,
        duration: 0,
        useNativeDriver: true,
      }).start();
    }
  }, [activeIndex, logHistory.length, translateY]);

  if (!shouldRender && !isInitializing) {
    return null;
  }

  if (!shouldRender) {
    return null;
  }

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        backgroundColor: '#000',
      }}>
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
          backgroundColor: '#000',
          justifyContent: 'center',
          alignItems: 'center',
          opacity: screenOpacity,
          // Ensure black background stays during fade
          pointerEvents: isInitializing ? 'auto' : 'none',
        }}>
        <View
          style={{
            width: '100%',
            maxWidth: 640,
            height: '100%',
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'hidden',
            backgroundColor: '#000',
          }}>
          {/* Container that starts in the middle */}
          <Animated.View
            style={{
              width: '100%',
              backgroundColor: 'transparent',
              transform: [{ translateY }],
            }}>
            {logHistory.map((entry, index) => {
              const stageId = entry.stageId;
              // Use visual states for smooth transitions
              const isVisuallyActive = index === visualActiveIndex;
              const isVisuallyCompleted =
                visuallyCompletedStages.has(stageId) && index < visualActiveIndex;
              const shouldAnimate = !seenTimestamps.has(entry.timestamp);

              return (
                <AnimatedStepItem
                  height={ITEM_HEIGHT}
                  key={`${entry.stageId}-${entry.timestamp}-${index}`}
                  entry={entry}
                  isActive={isVisuallyActive}
                  isCompleted={isVisuallyCompleted}
                  shouldAnimate={shouldAnimate}
                />
              );
            })}
          </Animated.View>

          {/* Top gradient overlay - fades steps as they go up */}
          <LinearGradient
            colors={['rgba(0, 0, 0, 1)', 'rgba(0, 0, 0, 0)']}
            locations={[0, 0.8]}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: containerHeight * 0.75,
              pointerEvents: 'none',
              zIndex: 1,
            }}
          />

          {/* Error message */}
          {currentStage?.error && (
            <View
              style={{
                position: 'absolute',
                bottom: 60,
                left: 20,
                right: 20,
                marginHorizontal: 16,
                paddingHorizontal: 20,
                paddingVertical: 16,
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                borderRadius: 12,
                borderWidth: 1,
                borderColor: 'rgba(239, 68, 68, 0.3)',
              }}>
              <Text
                style={{
                  color: 'rgba(252, 165, 165, 1)',
                  fontSize: 14,
                  lineHeight: 20,
                  textAlign: 'center',
                }}>
                {currentStage.error}
              </Text>
            </View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

export function useInitializationStage(
  stageId: string,
  config: { message?: string; dependsOn?: string[]; blocking?: boolean } = {}
) {
  const { registerStage, updateStage, canStageStart } = useInitializationContext();
  const hasRegistered = useRef(false);

  useEffect(() => {
    if (!hasRegistered.current) {
      registerStage(stageId, config);
      hasRegistered.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageId]);

  const log = useCallback(
    (message: string) => {
      updateStage(stageId, { message, status: 'loading' });
    },
    [stageId, updateStage]
  );

  const complete = useCallback(() => {
    updateStage(stageId, { status: 'complete' });
  }, [stageId, updateStage]);

  const error = useCallback(
    (errorMessage: string) => {
      updateStage(stageId, { status: 'error', error: errorMessage });
    },
    [stageId, updateStage]
  );

  const canStart = canStageStart(stageId);

  return {
    log,
    complete,
    error,
    canStart,
  };
}
