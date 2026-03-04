import { CocoManager } from '@/shared/lib/cashu/manager';
import { rehydrateProfileStores } from '@/shared/lib/cashu/profileScopedStorage';
import { useProfileStore } from '@/shared/stores/global/profileStore';

type TransitionControls = {
  resetStages: () => void;
  cancelResetStages: () => void;
};

type ExistingProfileTransition = TransitionControls & {
  accountIndex: number;
};

type CreateProfileTransition = TransitionControls & {
  getKeysForAccount: (accountIndex: number) => Promise<{ pubkey: string } | null>;
};

let transitionInProgress = false;

function beginTransition(): boolean {
  if (transitionInProgress) return false;
  transitionInProgress = true;
  return true;
}

function endTransition(): void {
  transitionInProgress = false;
}

async function runProfileTransition(
  accountIndex: number,
  resetStages: () => void,
  cancelResetStages: () => void,
  flowName: string
): Promise<boolean> {
  try {
    resetStages();
    await CocoManager.cleanup();

    const switched = useProfileStore.getState().switchProfile(accountIndex);
    if (!switched) {
      throw new Error(`Target profile does not exist: ${accountIndex}`);
    }

    await rehydrateProfileStores();
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
    resetStages();

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

    await rehydrateProfileStores();
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
