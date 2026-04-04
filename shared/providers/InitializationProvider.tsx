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
import { initLog, log } from '@/shared/lib/logger';
import { Dimensions } from 'react-native';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import Icon from '@/assets/icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Path as SvgPath,
  Rect as SvgRect,
  Defs,
  ClipPath,
  G,
  LinearGradient as SvgLinearGradient,
  Stop,
} from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  withRepeat,
  Easing as REasing,
  createAnimatedComponent,
  runOnJS,
} from 'react-native-reanimated';

/**
 * Initialization stage system
 *
 * Each provider registers one or more stages via `useInitializationStage`.
 * Stages can declare dependencies (`dependsOn`) and whether they are
 * **blocking** (default) or **non-blocking**.
 *
 *  - **Blocking** stages (`blocking: true`, the default) keep the splash
 *    screen visible. The app renders only after every blocking stage completes.
 *  - **Non-blocking** stages (`blocking: false`) run in the background.
 *    They still appear in the log UI for debugging but do not prevent the
 *    app from rendering.
 *
 * Current stage map:
 *
 *  | Stage ID               | Blocking | Depends On             | Provider              |
 *  |------------------------|----------|------------------------|-----------------------|
 *  | legacy-redux-bootstrap | yes      | —                      | LegacyMigrationGate   |
 *  | global-migrations      | yes      | legacy-redux-bootstrap | GlobalMigrationGate   |
 *  | migrations             | yes      | global-migrations      | MigrationGate         |
 *  | nostr                  | yes      | migrations             | NostrKeysProvider     |
 *  | coco                   | yes      | nostr                  | CocoProvider          |
 *  | nostr-ndk              | no       | coco                   | NostrNDKProvider      |
 *  | coco-background        | no       | coco                   | CocoProvider          |
 */

// ── Initialization display type ──────────────────────────────
// 'text'   = scrolling text steps (custom React overlay)
// 'logo'   = animated S logo (custom React overlay)
// 'splash' = keep the native Expo splash screen visible until init completes
export const INITIALIZATION_DISPLAY_TYPE: 'text' | 'logo' | 'splash' = 'splash';

// ── Animated Logo SVG Constants ──────────────────────────────
const PATH1_LENGTH = 850;
const PATH2_LENGTH = 290;
const LOGO_EASE = REasing.bezier(0.4, 0, 0.2, 1);

const SHAPE_BODY_D =
  'M219.746 260.45C180.994 183.892 264.298 139.013 321.504 133.469C321.504 133.469 274.385 138.982 258.758 180.724C242.154 225.075 279.517 262.521 330.24 295.561C353.313 310.59 377.914 325.92 395.577 344.136C421.675 371.855 431.956 415.15 392.413 453.693C357.646 487.581 298.313 507.377 257.175 489.068C219.214 472.173 201.166 439.479 210.52 402.742C223.964 349.944 274.579 333.048 274.579 333.048C245.845 352.848 242.81 380.039 244 399.046C246.167 433.669 276.161 456.333 276.161 456.333C306.477 479.828 340.748 471.909 356.829 456.069C370.01 444.189 380.22 422.806 368.955 396.143C363.396 382.985 353.665 365.783 307.795 335.16C271.68 311.929 234.35 289.301 219.746 260.45Z';

const SHAPE_CURL_D =
  'M353.141 149.573C315.443 149.573 289.081 165.94 280.909 180.988C296.199 164.356 327.306 158.285 351.032 173.332C374.758 188.38 383.721 208.707 383.721 231.675C383.721 254.642 378.185 270.746 354.195 288.961C398.22 268.898 421.946 242.762 422.473 207.651C423 172.54 390.838 149.573 353.141 149.573Z';

const STROKE_BODY_D =
  'M321.256 133C257 144.5 202.321 202 257 271C299 324 383 340.5 394 385.5C405 430.5 380.252 458.658 349.5 473C295.977 497.962 231.26 477.061 227.252 413.031C225.687 388.031 230.252 358.031 274.331 332.579';

const STROKE_CURL_D =
  'M354.195 288.961C394 263 404.473 246.611 405 211.5C405.858 154.333 313 142 280.909 180.988';

const AnimatedSvgPath = createAnimatedComponent(SvgPath);

type StageStatus = 'pending' | 'loading' | 'complete' | 'error';

/** Configuration passed when registering a new initialization stage. */
export interface StageConfig {
  /** Human-readable message shown in the splash log. */
  message?: string;
  /** IDs of stages that must complete before this one can start. */
  dependsOn?: string[];
  /**
   * When `true` (the default), the splash screen stays visible until this
   * stage completes. Set to `false` for work that can happen after the app
   * is already visible (e.g. relay connections, recovery operations).
   */
  blocking?: boolean;
}

interface Stage {
  id: string;
  message: string;
  status: StageStatus;
  dependsOn?: string[];
  /** When true (the default), this stage must complete before the app renders. */
  blocking: boolean;
  error?: string;
  timestamp: number;
}

interface InitializationContextValue {
  stages: Map<string, Stage>;
  logHistory: { message: string; timestamp: number; stageId: string }[];
  currentStage: Stage | null;
  isInitializing: boolean;
  registerStage: (id: string, config: StageConfig) => void;
  updateStage: (
    id: string,
    updates: { message?: string; status?: StageStatus; error?: string }
  ) => void;
  canStageStart: (id: string) => boolean;
  startTestAnimation: () => void;
  /** Clear all stages and log history, forcing the initialization screen to show immediately. */
  resetStages: (options?: { holdUntilCancel?: boolean }) => void;
  /** Cancel force re-initialization when a profile switch/add flow aborts before stages re-register. */
  cancelResetStages: () => void;
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
  resetStages: () => {},
  cancelResetStages: () => {},
});

const useInitializationContext = () => {
  return useContext(InitializationContext);
};

export function useInitializationState() {
  const { isInitializing } = useInitializationContext();
  return { isInitializing };
}

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
  // When true, forces isInitializing=true until real stages register
  const [forceReinitialize, setForceReinitialize] = useState(false);
  // When true, keeps the splash pinned even after stages re-register until explicitly released.
  const [holdSplashVisible, setHoldSplashVisible] = useState(false);
  // Synchronous map of stage id → blocking flag. Updated immediately in
  // registerStage so updateStage can check it before the next React render.
  const blockingFlagsRef = useRef<Map<string, boolean>>(new Map());
  // Track pending log updates per stage to debounce rapid calls
  const pendingLogUpdates = useRef<
    Map<string, { message: string; timeout: ReturnType<typeof setTimeout> }>
  >(new Map());

  const registerStage = useCallback((id: string, config: StageConfig) => {
    const isBlocking = config.blocking !== false;
    blockingFlagsRef.current.set(id, isBlocking);

    initLog(
      'registerStage',
      `${id} (blocking=${isBlocking}, dependsOn=${config.dependsOn?.join(',') ?? 'none'})`
    );

    setStages((prev) => {
      if (prev.has(id)) {
        return prev;
      }
      const newStages = new Map(prev);
      newStages.set(id, {
        id,
        message: config.message || `Initializing ${id}...`,
        status: 'pending',
        dependsOn: config.dependsOn,
        blocking: isBlocking,
        timestamp: Date.now(),
      });
      return newStages;
    });
  }, []);

  const updateStage = useCallback(
    (id: string, updates: { message?: string; status?: StageStatus; error?: string }) => {
      initLog('updateStage', `${id} status=${updates.status ?? '-'} msg=${updates.message ?? '-'}`);

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

      // Non-blocking stages run in the background — don't add their
      // messages to the visible log history so they can't hold up the
      // splash fade-out animation.
      if (blockingFlagsRef.current.get(id) === false) return;

      // Handle log history updates (blocking stages only)
      if (updates.message || updates.status === 'complete') {
        // If status is 'complete', flush any pending log for this stage immediately
        if (updates.status === 'complete') {
          const pending = pendingLogUpdates.current.get(id);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingLogUpdates.current.delete(id);
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
          const pending = pendingLogUpdates.current.get(id);
          if (pending) {
            clearTimeout(pending.timeout);
          }

          const now = Date.now();
          setLogHistory((prevLog) => {
            const recentEntry = prevLog.find(
              (entry) =>
                entry.stageId === id && entry.message === message && now - entry.timestamp < 100
            );

            if (recentEntry) {
              return prevLog;
            }

            log.debug('init.provider.log_history', { message });
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
      // Stage not registered yet — don't allow it to start prematurely.
      // This prevents isInitializing from flickering false→true when a
      // blocking stage registers one render after its dependency completes.
      if (!stage) return false;

      if (!stage.dependsOn || stage.dependsOn.length === 0) {
        return true;
      }

      const result = stage.dependsOn.every((depId) => {
        const depStage = stages.get(depId);
        return depStage && depStage.status === 'complete';
      });

      if (result && stage.status === 'pending') {
        initLog('canStageStart', `${id} → true (deps satisfied)`);
      }
      return result;
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
    forceReinitialize ||
    holdSplashVisible ||
    Array.from(stages.values()).some(
      (stage) => stage.blocking && (stage.status === 'loading' || stage.status === 'pending')
    );

  // Log isInitializing transitions
  const prevInitializing = useRef<boolean | null>(null);
  if (prevInitializing.current !== isInitializing) {
    const blockingStages = Array.from(stages.values())
      .filter((s) => s.blocking)
      .map((s) => `${s.id}=${s.status}`)
      .join(', ');
    initLog(
      'isInitializing',
      `${String(prevInitializing.current)} → ${String(isInitializing)} | blocking=[${blockingStages}]`
    );
    prevInitializing.current = isInitializing;
  }

  // Clear forceReinitialize once real stages have registered (they'll keep isInitializing true)
  useEffect(() => {
    if (forceReinitialize && stages.size > 0) {
      setForceReinitialize(false);
    }
  }, [forceReinitialize, stages.size]);

  const resetStages = useCallback((options?: { holdUntilCancel?: boolean }) => {
    log.info('init.provider.reset_stages');
    // Force the loading screen to show immediately
    setForceReinitialize(true);
    setHoldSplashVisible(options?.holdUntilCancel === true);
    // Clear all stages so inner providers can re-register fresh
    setStages(new Map());
    blockingFlagsRef.current.clear();
    // Clear log history so the animation starts from scratch
    setLogHistory([]);
    // Clear any pending log updates
    pendingLogUpdates.current.forEach((update) => clearTimeout(update.timeout));
    pendingLogUpdates.current.clear();
  }, []);

  const cancelResetStages = useCallback(() => {
    setForceReinitialize(false);
    setHoldSplashVisible(false);
  }, []);

  const startTestAnimation = useCallback(() => {
    log.debug('init.provider.test_animation_start');
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
            blocking: true,
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
              log.debug('init.provider.test_animation_done');
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
    const stagesDebug = Array.from(stages.entries()).map(([id, s]) => ({ id, status: s.status }));
    log.debug('init.provider.state', { totalStages: stages.size, logHistory: logHistory.length, currentStageId: currentStage?.id, currentStageMessage: currentStage?.message, isInitializing, stages: stagesDebug });
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
    resetStages,
    cancelResetStages,
  };

  // Render children directly without Animated.View wrapper to preserve native blur effects (liquid glass)
  // The InitializationScreenInternal handles its own overlay and fade out
  return (
    <InitializationContext.Provider value={contextValue}>
      {children}
      {INITIALIZATION_DISPLAY_TYPE === 'splash' ? null : INITIALIZATION_DISPLAY_TYPE === 'logo' ? (
        <LogoInitializationScreen />
      ) : (
        <InitializationScreenInternal />
      )}
    </InitializationContext.Provider>
  );
}

function AnimatedCheckmark({
  isCompleted,
  color,
}: {
  isCompleted: boolean;
  isActive: boolean;
  color: string;
}) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.set(withTiming(isCompleted ? 1 : 0, { duration: 300 }));
  }, [isCompleted, opacity]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    marginRight: 4,
  }));

  return (
    <Animated.View style={animStyle}>
      <Icon name="mdi-light:check" size={20} color={color} />
    </Animated.View>
  );
}

function PulsingText({ children }: { children: string }) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.set(
      withRepeat(
        withSequence(withTiming(0.5, { duration: 1000 }), withTiming(1, { duration: 1000 })),
        -1
      )
    );
  }, [pulse]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: pulse.get(),
  }));

  return (
    <Animated.Text
      numberOfLines={1}
      style={[
        {
          color: 'rgba(255, 255, 255, 1)',
          fontSize: 14,
          fontWeight: '500',
          lineHeight: 20,
          textAlign: 'center',
          flexShrink: 1,
        },
        animStyle,
      ]}>
      {children}
    </Animated.Text>
  );
}

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
  const fade = useSharedValue(shouldAnimate ? 0 : 1);

  useEffect(() => {
    if (shouldAnimate) {
      fade.set(withTiming(1, { duration: 300 }));
    }
  }, [shouldAnimate, fade]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: fade.get(),
  }));

  return (
    <Animated.View
      style={[
        {
          height: height,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          backgroundColor: 'transparent',
        },
        animStyle,
      ]}>
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

// ── Animated Logo Splash (SVG with looping overlap-70% stroke animation) ────
function AnimatedLogoSplash() {
  const dash1 = useSharedValue(PATH1_LENGTH);
  const dash2 = useSharedValue(PATH2_LENGTH);
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const logoSize = Math.min(screenW, screenH) * 1.25;

  useEffect(() => {
    // Fast overlap sequence (1s loop, tuned for ~131ms blocking init):
    //   0–400ms   path1 in      | path2 in starts at 280ms (70% overlap)
    // 400–480ms   hold
    // 480–880ms   path1 out     | path2 out starts at 760ms (70% overlap)
    // 880–1000ms  hold → reset

    dash1.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 400, easing: LOGO_EASE }),
        withDelay(80, withTiming(0, { duration: 0 })),
        withTiming(-PATH1_LENGTH, { duration: 400, easing: LOGO_EASE }),
        withDelay(120, withTiming(PATH1_LENGTH, { duration: 0 }))
      ),
      -1
    );

    dash2.value = withRepeat(
      withSequence(
        withDelay(280, withTiming(0, { duration: 120, easing: LOGO_EASE })),
        withDelay(360, withTiming(-PATH2_LENGTH, { duration: 120, easing: LOGO_EASE })),
        withDelay(120, withTiming(PATH2_LENGTH, { duration: 0 }))
      ),
      -1
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedProps1 = useAnimatedProps(() => ({
    strokeDashoffset: dash1.value,
  }));

  const animatedProps2 = useAnimatedProps(() => ({
    strokeDashoffset: dash2.value,
  }));

  return (
    <Svg width={logoSize} height={logoSize} viewBox="0 0 631 631">
      <Defs>
        <SvgLinearGradient id="logoGrad" x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0" stopColor="#FF976B" />
          <Stop offset="0.5048" stopColor="#F82E30" />
          <Stop offset="1" stopColor="#7E004E" />
        </SvgLinearGradient>
        <ClipPath id="clipBody">
          <SvgPath d={SHAPE_BODY_D} />
        </ClipPath>
        <ClipPath id="clipCurl">
          <SvgPath d={SHAPE_CURL_D} />
        </ClipPath>
      </Defs>
      <SvgRect width={630.564} height={630.564} rx={315.282} fill="black" />
      <G clipPath="url(#clipBody)">
        <AnimatedSvgPath
          d={STROKE_BODY_D}
          stroke="url(#logoGrad)"
          strokeWidth={57}
          fill="none"
          strokeDasharray={`${PATH1_LENGTH}`}
          animatedProps={animatedProps1}
        />
      </G>
      <G clipPath="url(#clipCurl)">
        <AnimatedSvgPath
          d={STROKE_CURL_D}
          stroke="url(#logoGrad)"
          strokeWidth={57}
          fill="none"
          strokeDasharray={`${PATH2_LENGTH}`}
          animatedProps={animatedProps2}
        />
      </G>
    </Svg>
  );
}

// ── Logo Initialization Screen ───────────────────────────────
function LogoInitializationScreen() {
  const { isInitializing } = useInitializationContext();
  const [shouldRender, setShouldRender] = useState(true);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!isInitializing && shouldRender) {
      opacity.set(
        withTiming(0, { duration: 500, easing: REasing.out(REasing.ease) }, () => {
          runOnJS(setShouldRender)(false);
        })
      );
    } else if (isInitializing) {
      opacity.set(1);
      setShouldRender(true);
    }
  }, [isInitializing, shouldRender, opacity]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    pointerEvents: opacity.get() > 0 ? ('auto' as const) : ('none' as const),
  }));

  if (!shouldRender && !isInitializing) return null;
  if (!shouldRender) return null;

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        backgroundColor: '#030303',
      }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            backgroundColor: '#030303',
            justifyContent: 'center',
            alignItems: 'center',
          },
          animStyle,
        ]}>
        <AnimatedLogoSplash />
      </Animated.View>
    </View>
  );
}

function InitializationScreenInternal() {
  const { logHistory, currentStage, isInitializing } = useInitializationContext();
  const [seenTimestamps, setSeenTimestamps] = useState<Set<number>>(new Set());
  const [shouldRender, setShouldRender] = useState(true);
  const [visualActiveIndex, setVisualActiveIndex] = useState(0);
  const activeTransitionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafId = useRef<number | null>(null);
  const lastTransitionTime = useRef<number>(Date.now());
  const MINIMUM_ACTIVE_TIME = 200;

  const listTranslateY = useSharedValue(0);
  const screenOpacity = useSharedValue(1);
  const ITEM_HEIGHT = 64;
  const containerHeight = Dimensions.get('window').height;

  const hasShownAllSteps = logHistory.length === 0 || visualActiveIndex >= logHistory.length - 1;
  const [readyToFade, setReadyToFade] = useState(false);
  const fadeDelayTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fadeRafId = useRef<number | null>(null);
  useEffect(() => {
    if (hasShownAllSteps && !isInitializing && logHistory.length > 0) {
      if (fadeDelayTimeout.current) clearTimeout(fadeDelayTimeout.current);
      if (fadeRafId.current) cancelAnimationFrame(fadeRafId.current);
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
      if (fadeDelayTimeout.current) clearTimeout(fadeDelayTimeout.current);
      if (fadeRafId.current) cancelAnimationFrame(fadeRafId.current);
    };
  }, [hasShownAllSteps, isInitializing, logHistory.length]);

  // Fade out when done; runs entirely on UI thread via Reanimated
  useEffect(() => {
    const canFade = !isInitializing && hasShownAllSteps && (readyToFade || logHistory.length === 0);
    if (canFade && shouldRender) {
      screenOpacity.set(
        withTiming(0, { duration: 500, easing: REasing.out(REasing.ease) }, () => {
          runOnJS(setShouldRender)(false);
        })
      );
    } else if (isInitializing) {
      screenOpacity.set(1);
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

  const [visuallyCompletedStages, setVisuallyCompletedStages] = useState<Set<string>>(new Set());

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
      requestAnimationFrame(() => {
        setSeenTimestamps((prev) => new Set([...prev, ...newTimestamps]));
      });
    }
  }, [logHistory, seenTimestamps]);

  const targetActiveIndex = logHistory.length - 1;

  useEffect(() => {
    if (logHistory.length === 0) {
      setVisualActiveIndex(0);
      lastTransitionTime.current = Date.now();
      return;
    }

    if (targetActiveIndex > visualActiveIndex) {
      if (activeTransitionTimeout.current) clearTimeout(activeTransitionTimeout.current);
      if (rafId.current) cancelAnimationFrame(rafId.current);

      const timeSinceLastTransition = Date.now() - lastTransitionTime.current;
      const remainingTime = Math.max(0, MINIMUM_ACTIVE_TIME - timeSinceLastTransition);

      activeTransitionTimeout.current = setTimeout(() => {
        rafId.current = requestAnimationFrame(() => {
          lastTransitionTime.current = Date.now();
          setVisualActiveIndex((prev) => Math.min(prev + 1, targetActiveIndex));
        });
      }, remainingTime);
    }

    return () => {
      if (activeTransitionTimeout.current) clearTimeout(activeTransitionTimeout.current);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [targetActiveIndex, visualActiveIndex, logHistory.length]);

  const activeIndex = visualActiveIndex;

  // Scroll the list via UI-thread animation
  useEffect(() => {
    if (activeIndex >= 0 && logHistory.length > 0) {
      listTranslateY.set(
        withTiming(-(activeIndex * 32), {
          duration: 400,
          easing: REasing.out(REasing.cubic),
        })
      );
    } else if (logHistory.length === 0) {
      listTranslateY.set(0);
    }
  }, [activeIndex, logHistory.length, listTranslateY]);

  const screenAnimStyle = useAnimatedStyle(() => ({
    opacity: screenOpacity.get(),
    pointerEvents: screenOpacity.get() > 0 ? ('auto' as const) : ('none' as const),
  }));

  const listAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: listTranslateY.get() }],
  }));

  if (!shouldRender && !isInitializing) return null;
  if (!shouldRender) return null;

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        backgroundColor: '#030303',
      }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            backgroundColor: '#030303',
            justifyContent: 'center',
            alignItems: 'center',
          },
          screenAnimStyle,
        ]}>
        <View
          style={{
            width: '100%',
            maxWidth: 640,
            height: '100%',
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'hidden',
            backgroundColor: '#030303',
          }}>
          <Animated.View style={[{ width: '100%', backgroundColor: 'transparent' }, listAnimStyle]}>
            {logHistory.map((entry, index) => {
              const stageId = entry.stageId;
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

/**
 * Hook to trigger a full re-initialization (e.g. during profile switch).
 * Calling resetStages() immediately shows the loading screen and clears all stages.
 */
export function useInitializationReset() {
  const { resetStages, cancelResetStages } = useInitializationContext();
  return { resetStages, cancelResetStages };
}

export function useInitializationStage(stageId: string, config: StageConfig = {}) {
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

  // Track canStart transitions so we can see the gap between a dependency
  // completing and this stage actually receiving canStart=true.
  const prevCanStart = useRef(false);
  if (canStart && !prevCanStart.current) {
    initLog('useStage', `${stageId} canStart flipped to true`);
  }
  prevCanStart.current = canStart;

  return {
    log,
    complete,
    error,
    canStart,
  };
}
