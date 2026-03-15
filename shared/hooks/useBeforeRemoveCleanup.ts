import { useRef } from 'react';
import { useNavigation, usePreventRemove } from '@react-navigation/native';

/**
 * Run async cleanup when the user tries to leave the screen (back, swipe, hardware back).
 *
 * Uses React Navigation's usePreventRemove so removal is properly coordinated with
 * native-stack (recommended over beforeRemove for Expo/native-stack). When the user
 * tries to leave, we prevent removal, run cleanup, then dispatch the action to complete leave.
 *
 * @param active - True when there is something that might need cleanup (e.g. !!createdOperationId).
 *                 When false, back/leave is not intercepted.
 * @param shouldCleanup - Called when leave was prevented; return true to run cleanup before leaving.
 * @param cleanup - Async rollback/teardown (e.g. cancelMeltQuote). Errors are logged; leave still proceeds.
 */
export function useBeforeRemoveCleanup(options: {
  active: boolean;
  shouldCleanup: () => boolean;
  cleanup: () => Promise<void>;
}): void {
  const navigation = useNavigation();
  const optsRef = useRef(options);
  optsRef.current = options;

  usePreventRemove(options.active, ({ data }) => {
    const { shouldCleanup, cleanup } = optsRef.current;
    const needsCleanup = shouldCleanup();
    if (!needsCleanup) {
      navigation.dispatch(data.action);
      return;
    }

    (async () => {
      try {
        await cleanup();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('Cannot rollback') ||
          msg.includes('not found') ||
          msg.includes('No melt operation')
        ) {
          // Already finalized/rolled back or op gone – allow leave
        } else {
          console.warn('[useBeforeRemoveCleanup] cleanup failed:', err);
        }
      }
      navigation.dispatch(data.action);
    })();
  });
}
