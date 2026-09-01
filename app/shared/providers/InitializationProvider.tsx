import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import { initLog, log, useInitMount } from '@/shared/lib/logger';

initLog('Module', 'InitializationProvider loaded');

/**
 * Initialization stage system
 *
 * Each provider registers one or more stages via `useInitializationStage`.
 * Stages can declare dependencies (`dependsOn`) and whether they are
 * **blocking** (default) or **non-blocking**.
 *
 *  - **Blocking** stages (`blocking: true`, the default) keep the splash
 *    screen visible. The app renders only after every blocking stage completes.
 *  - **Non-blocking** stages (`blocking: false`) run in the background. They
 *    do not contribute to `isInitializing`.
 *
 * The provider exposes a single boolean — `isInitializing` — to the rest of
 * the app. The native splash screen (`expo-splash-screen`) renders the
 * splash UI; consumers (see `app/_layout.tsx`) call `SplashScreen.hideAsync`
 * once `isInitializing` flips false and the root view has laid out.
 *
 * Current stage map:
 *
 *  | Stage ID               | Blocking | Depends On             | Provider              |
 *  |------------------------|----------|------------------------|-----------------------|
 *  | global-migrations      | yes      | —                      | GlobalMigrationGate   |
 *  | nostr                  | yes      | global-migrations      | NostrKeysProvider     |
 *  | coco                   | yes      | nostr                  | CocoProvider          |
 *  | nostr-ndk              | no       | coco                   | NostrNDKProvider      |
 *  | coco-background        | no       | coco                   | CocoProvider          |
 */

type StageStatus = 'pending' | 'loading' | 'complete' | 'error';

/** Configuration passed when registering a new initialization stage. */
interface StageConfig {
  /** Human-readable message — captured into init logs only. */
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
  status: StageStatus;
  dependsOn?: string[];
  /** When true (the default), this stage must complete before the app renders. */
  blocking: boolean;
}

interface InitializationContextValue {
  isInitializing: boolean;
  registerStage: (id: string, config: StageConfig) => void;
  updateStage: (
    id: string,
    updates: { message?: string; status?: StageStatus; error?: string }
  ) => void;
  canStageStart: (id: string) => boolean;
  /** Clear all stages, forcing the splash to show again until inner providers re-register. */
  resetStages: (options?: { holdUntilCancel?: boolean }) => void;
  /** Cancel a held reset when a profile switch/add flow aborts before stages re-register. */
  cancelResetStages: () => void;
}

const noop = () => {};

const InitializationContext = createContext<InitializationContextValue>({
  isInitializing: false,
  registerStage: noop,
  updateStage: noop,
  canStageStart: () => true,
  resetStages: noop,
  cancelResetStages: noop,
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
}

export function InitializationProvider({ children }: InitializationProviderProps) {
  const [stages, setStages] = useState<Map<string, Stage>>(new Map());
  // When true, forces isInitializing=true until real stages register (profile switch).
  const [forceReinitialize, setForceReinitialize] = useState(false);
  // When true, keeps the splash pinned even after stages re-register until explicitly released.
  const [holdSplashVisible, setHoldSplashVisible] = useState(false);
  useInitMount('InitializationProvider');

  // Synchronous map of stage id → blocking flag. Updated immediately in
  // registerStage so updateStage can check it before the next React render.
  const blockingFlagsRef = useRef<Map<string, boolean>>(new Map());
  // Track when each stage first transitioned to 'loading' so we can log a
  // duration when it reaches 'complete'.
  const stageStartTimes = useRef<Map<string, number>>(new Map());

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
        status: 'pending',
        dependsOn: config.dependsOn,
        blocking: isBlocking,
      });
      return newStages;
    });
  }, []);

  const updateStage = useCallback(
    (id: string, updates: { message?: string; status?: StageStatus; error?: string }) => {
      initLog('updateStage', `${id} status=${updates.status ?? '-'} msg=${updates.message ?? '-'}`);

      setStages((prev) => {
        const stage = prev.get(id);
        if (!stage || !updates.status || updates.status === stage.status) return prev;

        // Per-stage start→end duration: capture the first transition out of
        // 'pending' as the start, then log when the stage reaches 'complete'
        // or 'error'. Lets us see exactly how long each blocking step took,
        // separate from time spent waiting on deps.
        const nowMs = Date.now();
        if (stage.status === 'pending' && !stageStartTimes.current.has(id)) {
          stageStartTimes.current.set(id, nowMs);
          initLog('stageStart', `${id} → ${updates.status}`);
        }
        if (updates.status === 'complete') {
          const startedAt = stageStartTimes.current.get(id);
          const durationMs = startedAt ? nowMs - startedAt : -1;
          initLog('stageEnd', `${id} complete durationMs=${durationMs}`);
        }
        if (updates.status === 'error') {
          const startedAt = stageStartTimes.current.get(id);
          const durationMs = startedAt ? nowMs - startedAt : -1;
          initLog('stageEnd', `${id} error durationMs=${durationMs} msg=${updates.error ?? '-'}`);
        }

        const newStages = new Map(prev);
        newStages.set(id, { ...stage, status: updates.status });
        return newStages;
      });
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

  const isInitializing =
    forceReinitialize ||
    holdSplashVisible ||
    Array.from(stages.values()).some(
      (stage) => stage.blocking && (stage.status === 'loading' || stage.status === 'pending')
    );

  // Log isInitializing transitions. Written in an effect, not during render:
  // a render-phase ref write logs renders React went on to discard, and it is
  // the rule violation that stopped the compiler optimising this provider.
  const prevInitializing = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevInitializing.current === isInitializing) return;
    const blockingStages = Array.from(stages.values())
      .filter((s) => s.blocking)
      .map((s) => `${s.id}=${s.status}`)
      .join(', ');
    initLog(
      'isInitializing',
      `${String(prevInitializing.current)} → ${String(isInitializing)} | blocking=[${blockingStages}]`
    );
    prevInitializing.current = isInitializing;
  }, [isInitializing, stages]);

  // Clear forceReinitialize / holdSplashVisible once real stages have registered
  // (they'll keep isInitializing true via their own blocking status).
  // This ensures the splash is released after a profile switch even if
  // cancelResetStages() was never called (e.g. DevSettings.reload() in dev).
  useEffect(() => {
    if ((forceReinitialize || holdSplashVisible) && stages.size > 0) {
      setForceReinitialize(false);
      setHoldSplashVisible(false);
    }
  }, [forceReinitialize, holdSplashVisible, stages.size]);

  const resetStages = useCallback((options?: { holdUntilCancel?: boolean }) => {
    log.info('init.provider.reset_stages');
    setForceReinitialize(true);
    setHoldSplashVisible(options?.holdUntilCancel === true);
    setStages(new Map());
    blockingFlagsRef.current.clear();
    stageStartTimes.current.clear();
  }, []);

  const cancelResetStages = useCallback(() => {
    setForceReinitialize(false);
    setHoldSplashVisible(false);
  }, []);

  useEffect(() => {
    const stagesDebug = Array.from(stages.entries()).map(([id, s]) => ({ id, status: s.status }));
    log.debug('init.provider.state', {
      totalStages: stages.size,
      isInitializing,
      stages: stagesDebug,
    });
  }, [stages, isInitializing]);

  // Memoise the context value so consumers don't re-render on every parent
  // re-render — only when the actual surface (functions are stable refs from
  // useCallback; isInitializing is the only varying field) changes.
  const contextValue = useMemo<InitializationContextValue>(
    () => ({
      isInitializing,
      registerStage,
      updateStage,
      canStageStart,
      resetStages,
      cancelResetStages,
    }),
    [isInitializing, registerStage, updateStage, canStageStart, resetStages, cancelResetStages]
  );

  return (
    <InitializationContext.Provider value={contextValue}>{children}</InitializationContext.Provider>
  );
}

/**
 * Hook to trigger a full re-initialization (e.g. during profile switch).
 * Calling resetStages() clears all stages so the splash shows again.
 */
export function useInitializationReset() {
  const { resetStages, cancelResetStages } = useInitializationContext();
  return { resetStages, cancelResetStages };
}

export function useInitializationStage(stageId: string, config: StageConfig = {}) {
  const { registerStage, updateStage, canStageStart } = useInitializationContext();
  const hasRegistered = useRef(false);

  // Registration is once-per-stage, but `config` is an object literal rebuilt
  // on every render, so depending on it directly would be dishonest. Depend on
  // its primitive contents instead: every call site passes literals, so these
  // never change, and the `hasRegistered` guard covers the case where one does.
  //
  // The join/split round-trip is lossless because stage IDs are the closed,
  // comma-free set in the table at the top of this file. A stage ID containing
  // a comma would split into two phantom dependencies that never complete.
  const { message, dependsOn, blocking } = config;
  const dependsOnKey = dependsOn?.join(',') ?? '';

  useEffect(() => {
    if (hasRegistered.current) return;
    hasRegistered.current = true;
    registerStage(stageId, {
      message,
      blocking,
      dependsOn: dependsOnKey ? dependsOnKey.split(',') : undefined,
    });
  }, [stageId, registerStage, message, blocking, dependsOnKey]);

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
  // completing and this stage actually receiving canStart=true. In an effect,
  // not during render — see the isInitializing log above for why.
  const prevCanStart = useRef(false);
  useEffect(() => {
    if (canStart && !prevCanStart.current) {
      initLog('useStage', `${stageId} canStart flipped to true`);
    }
    prevCanStart.current = canStart;
  }, [canStart, stageId]);

  // Stable identity: `log`/`complete`/`error` are lifetime-stable (updateStage
  // and registerStage are `useCallback(…, [])`), so this object changes only
  // when `canStart` flips. Consumers can therefore depend on the whole `stage`
  // without their effects re-running on every render — which is what forced
  // them to suppress exhaustive-deps while this was a fresh object literal.
  return useMemo(
    () => ({
      log,
      complete,
      error,
      canStart,
    }),
    [log, complete, error, canStart]
  );
}
