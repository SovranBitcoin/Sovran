import type { AppStateStatus } from 'react-native';

interface Pausable {
  pause(): void;
  resume(): void;
}

interface AppStateSource {
  currentState: AppStateStatus;
  addEventListener(
    type: 'change',
    listener: (state: AppStateStatus) => void
  ): { remove(): void } | undefined;
}

/**
 * Keep a relay client quiet while the app is in the background: it stops
 * redialling dropped relays and closes sockets that carry nothing, and picks
 * everything back up when the app returns.
 *
 * Only `background` pauses. `inactive` (the iOS app switcher, a system sheet)
 * leaves the app on screen, and tearing sockets down for it would cost a
 * reconnect every time a permission dialog appears. Returns a stop function.
 */
export function pauseInBackground(client: Pausable, appState: AppStateSource): () => void {
  if (appState.currentState === 'background') client.pause();
  const subscription = appState.addEventListener('change', (state) => {
    if (state === 'background') client.pause();
    else if (state === 'active') client.resume();
  });
  // Jest's react-native mock hands back no subscription.
  return () => subscription?.remove();
}
