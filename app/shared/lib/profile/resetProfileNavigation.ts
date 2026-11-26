import type { useNavigationContainerRef } from 'expo-router';

type RootNavigation = Pick<ReturnType<typeof useNavigationContainerRef>, 'isReady' | 'resetRoot'>;

interface ObservableRootNavigation extends RootNavigation {
  addListener(event: 'ready' | 'state', listener: () => void): () => void;
}

/** Expo Router's root is the drawer group; omit state/params so no A history is reused. */
export function resetProfileNavigation(navigation: RootNavigation): void {
  if (!navigation.isReady()) throw new Error('Profile navigation is not ready');
  navigation.resetRoot({ index: 0, routes: [{ name: '(drawer)' }] });
}

/** The target's navigator only registers once its keys and wallet have opened. */
export function resetProfileNavigationWhenReady(
  navigation: ObservableRootNavigation,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      removeReady();
      removeState();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new Error('Profile navigation reset cancelled'));
    };
    const reset = () => {
      if (!navigation.isReady()) return;
      cleanup();
      try {
        resetProfileNavigation(navigation);
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    const removeReady = navigation.addListener('ready', reset);
    const removeState = navigation.addListener('state', reset);
    signal.addEventListener('abort', abort);
    if (signal.aborted) abort();
    else reset();
  });
}
