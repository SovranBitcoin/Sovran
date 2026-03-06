/**
 * @fileoverview Profile session orchestration for switch/create/import flows.
 *
 * Coordinates CocoManager cleanup, profileStore updates, and a hard app reload for
 * switch/create/import flows. Uses a single transition guard to prevent concurrent
 * profile switches. Callers must provide resetStages/cancelResetStages from
 * InitializationProvider to keep the app covered until reload or failure fallback.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DevSettings } from 'react-native';

import * as Updates from 'expo-updates';

import { CocoManager } from '@/shared/lib/cashu/manager';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';

type TransitionControls = {
  resetStages: (options?: { holdUntilCancel?: boolean }) => void;
  cancelResetStages: () => void;
};

type ExistingProfileTransition = TransitionControls & {
  accountIndex: number;
};

type CreateProfileTransition = TransitionControls & {
  getKeysForAccount: (accountIndex: number) => Promise<{ pubkey: string } | null>;
};

let transitionInProgress = false;
let transitionStartedAt = 0;
const TRANSITION_EXPIRY_MS = 10_000;
const UI_OVERLAY_SETTLE_MS = 350;

function beginTransition(): boolean {
  if (transitionInProgress) {
    if (Date.now() - transitionStartedAt > TRANSITION_EXPIRY_MS) {
      console.warn('[ProfileSessionOrchestrator] Stale transition guard expired');
      transitionInProgress = false;
    } else {
      return false;
    }
  }
  transitionInProgress = true;
  transitionStartedAt = Date.now();
  return true;
}

function endTransition(): void {
  transitionInProgress = false;
}

async function waitForUiOverlaySettle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, UI_OVERLAY_SETTLE_MS);
  });
}

async function flushProfileStoreToDisk(): Promise<void> {
  const { activeAccountIndex, profiles, cocoMigrationComplete } = useProfileStore.getState();

  await AsyncStorage.setItem(
    'profile-store',
    JSON.stringify({
      state: {
        activeAccountIndex,
        profiles,
        cocoMigrationComplete,
      },
      version: 0,
    })
  );
}

async function reloadAtTransitionEnd(): Promise<boolean> {
  usePopupStore.getState().destroySheet();
  usePaymentStatusStore.getState().setActive(null);
  await waitForUiOverlaySettle();

  if (__DEV__) {
    DevSettings.reload();
    return true;
  }

  if (!Updates.isEnabled) {
    console.warn(
      '[ProfileSessionOrchestrator] expo-updates is disabled; skipping final app reload'
    );
    return false;
  }

  await Updates.reloadAsync();
  return true;
}

async function runProfileTransition(
  accountIndex: number,
  resetStages: (options?: { holdUntilCancel?: boolean }) => void,
  cancelResetStages: () => void,
  flowName: string
): Promise<boolean> {
  try {
    resetStages({ holdUntilCancel: true });
    usePopupStore.getState().close();
    await CocoManager.cleanup();

    const switched = useProfileStore.getState().switchProfile(accountIndex);
    if (!switched) {
      throw new Error(`Target profile does not exist: ${accountIndex}`);
    }

    await flushProfileStoreToDisk();
    const reloaded = await reloadAtTransitionEnd();
    if (!reloaded) {
      cancelResetStages();
    }
    return true;
  } catch (error) {
    console.error(`[ProfileSessionOrchestrator] ${flowName} failed:`, error);
    cancelResetStages();
    return false;
  }
}

export function isProfileTransitionInProgress(): boolean {
  return transitionInProgress;
}

export async function switchToExistingProfile({
  accountIndex,
  resetStages,
  cancelResetStages,
}: ExistingProfileTransition): Promise<boolean> {
  if (!beginTransition()) return false;
  try {
    return await runProfileTransition(accountIndex, resetStages, cancelResetStages, 'switch');
  } finally {
    endTransition();
  }
}

export async function createAndSwitchProfile({
  getKeysForAccount,
  resetStages,
  cancelResetStages,
}: CreateProfileTransition): Promise<boolean> {
  if (!beginTransition()) return false;
  try {
    resetStages({ holdUntilCancel: true });
    usePopupStore.getState().close();

    const profileStore = useProfileStore.getState();
    const nextIndex = profileStore.getNextAccountIndex();
    const newKeys = await getKeysForAccount(nextIndex);
    if (!newKeys?.pubkey) {
      console.warn('[ProfileSessionOrchestrator] Failed to derive keys for new profile');
      cancelResetStages();
      return false;
    }

    profileStore.addProfile(nextIndex, newKeys.pubkey);

    await CocoManager.cleanup();
    const switched = useProfileStore.getState().switchProfile(nextIndex);
    if (!switched) {
      throw new Error(`Failed to activate newly-created profile: ${nextIndex}`);
    }

    await flushProfileStoreToDisk();
    const reloaded = await reloadAtTransitionEnd();
    if (!reloaded) {
      cancelResetStages();
    }
    return true;
  } catch (error) {
    console.error('[ProfileSessionOrchestrator] create failed:', error);
    cancelResetStages();
    return false;
  } finally {
    endTransition();
  }
}

export async function switchToImportedProfile({
  accountIndex,
  resetStages,
  cancelResetStages,
}: ExistingProfileTransition): Promise<boolean> {
  if (!beginTransition()) return false;
  try {
    return await runProfileTransition(accountIndex, resetStages, cancelResetStages, 'import');
  } finally {
    endTransition();
  }
}
