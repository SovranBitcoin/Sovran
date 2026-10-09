/**
 * The lock and the shared steps behind every flow that changes accounts.
 *
 * Two guards, both taken before a flow touches anything:
 *   - `transitionInFlight`, in memory, refuses a second flow in this runtime;
 *   - a timestamp in AsyncStorage survives the native restart most flows end
 *     in, and is cleared on the next start (`clearTransitionGuardOnStartup`).
 *
 * A flow takes them through `acquireTransition()` and gives them back with
 * `lock.release()`, which also drops the splash if the flow was holding it.
 * The flows themselves are in `profileSessionOrchestrator.ts`.
 *
 * The layout registers two things here at runtime, so no flow needs them
 * passed in: the splash controls (`registerTransitionControls`) and how to
 * derive the keys for a new account (`registerKeyDerivation`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ResultAsync } from 'neverthrow';

import { log, redactError } from '../logger';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { restartApp } from '@/shared/lib/profile/appRestart';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import {
  PROFILE_STORE_PERSIST_VERSION,
  useProfileStore,
} from '@/shared/stores/global/profileStore';

// ── AsyncStorage-based transition guard ──────────────────────────
const TRANSITION_KEY = 'profile-transition-in-progress';
const TRANSITION_EXPIRY_MS = 10_000;

type TransitionGuard = { startedAt: number };

async function beginTransition(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(TRANSITION_KEY);
    if (raw) {
      const guard: TransitionGuard = JSON.parse(raw);
      if (Date.now() - guard.startedAt < TRANSITION_EXPIRY_MS) {
        return false;
      }
      log.warn('profile.orchestrator.stale_guard');
    }
    await AsyncStorage.setItem(TRANSITION_KEY, JSON.stringify({ startedAt: Date.now() }));
    return true;
  } catch {
    return true;
  }
}

async function endTransition(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TRANSITION_KEY);
  } catch {
    // best-effort
  }
}

/** Call on app startup to clear any stale transition guard left by a previous run. */
export async function clearTransitionGuardOnStartup(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TRANSITION_KEY);
  } catch {
    // best-effort
  }
}

// ── Registered controls (set at runtime by layout components) ────
export type TransitionControls = {
  resetStages: (options?: {
    holdUntilCancel?: boolean;
    keepStagesThatOutliveAccount?: boolean;
  }) => void;
  cancelResetStages: () => void;
};

export type KeyDerivationFn = (accountIndex: number) => Promise<{ pubkey: string } | null>;

let registeredControls: TransitionControls | null = null;
let registeredKeyDerivation: KeyDerivationFn | null = null;

export function registerTransitionControls(controls: TransitionControls): void {
  registeredControls = controls;
}

export function registerKeyDerivation(fn: KeyDerivationFn): void {
  registeredKeyDerivation = fn;
}

export function keyDerivation(): KeyDerivationFn | null {
  return registeredKeyDerivation;
}

/**
 * Persist the switch target WITHOUT flipping the in-memory store. The
 * in-memory flip drives RootLayout's keyed remount
 * (`key={account-${activeAccountIndex}}`), and a remount before the native
 * restart boots the new profile in-process — SecureStore reads, coco init,
 * SQLite migrations, PBKDF2 seed warm — only to race the restart: two full
 * boots per switch plus a native-crash window with expo-sqlite work in
 * flight (BTC-13). Persist-first lets the restart boot from the target
 * directly; the in-memory flip is kept only as the failed-restart fallback.
 */
export function persistSwitchTargetToDisk(accountIndex: number): ResultAsync<void, Error> {
  const { profiles } = useProfileStore.getState();
  return ResultAsync.fromPromise(
    AsyncStorage.setItem(
      'profile-store',
      JSON.stringify({
        state: { activeAccountIndex: accountIndex, profiles },
        version: PROFILE_STORE_PERSIST_VERSION,
      })
    ),
    (error) => (error instanceof Error ? error : new Error(String(error)))
  );
}

/** The opt-in protocol awaits its explicit account-index write, including failures. */
export function activateProfileInMemory(accountIndex: number): void {
  const profileOptions = useProfileStore.persist.getOptions();
  useProfileStore.persist.setOptions({
    storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  try {
    if (!useProfileStore.getState().switchProfile(accountIndex)) {
      throw new Error('Profile activation failed');
    }
  } finally {
    useProfileStore.persist.setOptions({ storage: profileOptions.storage });
  }
}

export async function teardownAndRestart(): Promise<boolean> {
  usePopupStore.getState().destroySheet();
  usePaymentStatusStore.getState().setActive(null);

  const restarted = restartApp();
  if (!restarted) {
    log.error('profile.orchestrator.restart_failed');
  }
  return restarted;
}

// ── Synchronous in-memory guard (supplements the async AsyncStorage guard) ──
let transitionInFlight = false;

export function isTransitionInFlight(): boolean {
  return transitionInFlight;
}

/**
 * coco's Manager.dispose() → NPC plugin shutdown awaits any in-flight sync
 * with NO timeout (BTC-14): a stalled sync would pin the profile switch on
 * the transition splash until the user force-kills (reported as a crash).
 * Bound the teardown wait — the native restart that follows reclaims
 * everything native-side anyway.
 */
const COCO_CLEANUP_TIMEOUT_MS = 5_000;

export async function cleanupCocoWithTimeout(): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      CocoManager.cleanup(),
      new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          log.warn('profile.orchestrator.cleanup_timeout', {
            timeoutMs: COCO_CLEANUP_TIMEOUT_MS,
          });
          resolve();
        }, COCO_CLEANUP_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    log.warn('profile.orchestrator.cleanup_failed', { error: redactError(error) });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/** What a flow holds while it changes accounts. See the header for the two guards. */
interface TransitionLock {
  /**
   * Take the on-disk guard as well. False when a transition started in an
   * earlier runtime is still recent; the caller then releases and gives up.
   */
  takeDiskGuard(): Promise<boolean>;
  /** Cover the app with the splash until `release`. */
  holdSplash(
    controls: Partial<TransitionControls>,
    options: Parameters<TransitionControls['resetStages']>[0]
  ): void;
  /**
   * Give back everything this lock took: the splash if held, the in-memory
   * guard, the on-disk guard if taken. Every exit from a flow that is not a
   * restart goes through here. Leaving the in-memory guard set refuses every
   * later flow for the rest of the session.
   *
   * A flow that restarts the runtime does not release: the reload clears the
   * in-memory guard, and the next start clears the one on disk.
   */
  release(): Promise<void>;
}

/** Take the in-memory guard, or `null` when another flow holds it. */
export function acquireTransition(): TransitionLock | null {
  if (transitionInFlight) return null;
  transitionInFlight = true;
  let diskGuardTaken = false;
  let cancelSplash: (() => void) | undefined;
  let splashHeld = false;
  return {
    async takeDiskGuard() {
      diskGuardTaken = await beginTransition();
      return diskGuardTaken;
    },
    holdSplash(controls, options) {
      splashHeld = true;
      cancelSplash = controls.cancelResetStages;
      controls.resetStages?.(options);
    },
    async release() {
      if (splashHeld) cancelSplash?.();
      transitionInFlight = false;
      if (diskGuardTaken) {
        diskGuardTaken = false;
        await endTransition();
      }
    },
  };
}

/** The splash controls a caller passed, or the ones the layout registered. */
export function splashControls(opts?: Partial<TransitionControls>): Partial<TransitionControls> {
  return {
    resetStages: opts?.resetStages ?? registeredControls?.resetStages,
    cancelResetStages: opts?.cancelResetStages ?? registeredControls?.cancelResetStages,
  };
}
