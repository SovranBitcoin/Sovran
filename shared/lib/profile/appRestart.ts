/**
 * @fileoverview App restart with priority chain.
 *
 * Encapsulates all restart logic so the profile orchestrator never has to
 * branch on build type. Priority:
 *
 *   1. __DEV__                → DevSettings.reload()
 *   2. Production (always)    → RNRestart.restart()
 *   3. Fallback (expo-updates)→ Updates.reloadAsync() if Updates.isEnabled
 *   4. Last resort            → return false (caller handles gracefully)
 */
import { DevSettings } from 'react-native';

import * as Updates from 'expo-updates';
import RNRestart from 'react-native-restart';

/**
 * Restart the app using the best available mechanism for the current build.
 * Returns `true` if a restart was triggered, `false` if all methods failed.
 */
export async function restartApp(): Promise<boolean> {
  if (__DEV__) {
    DevSettings.reload();
    return true;
  }

  try {
    RNRestart.restart();
    return true;
  } catch (e) {
    console.warn('[appRestart] RNRestart.restart() failed:', e);
  }

  if (Updates.isEnabled) {
    try {
      await Updates.reloadAsync();
      return true;
    } catch (e) {
      console.warn('[appRestart] Updates.reloadAsync() failed:', e);
    }
  }

  console.error('[appRestart] All restart methods failed');
  return false;
}
