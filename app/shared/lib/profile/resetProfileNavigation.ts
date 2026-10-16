import type { useNavigationContainerRef } from 'expo-router';

type RootNavigation = Pick<ReturnType<typeof useNavigationContainerRef>, 'isReady' | 'resetRoot'>;

/** Expo Router's root is the drawer group; omit state/params so no A history is reused. */
export function resetProfileNavigation(navigation: RootNavigation): void {
  if (!navigation.isReady()) throw new Error('Profile navigation is not ready');
  navigation.resetRoot({ index: 0, routes: [{ name: '(drawer)' }] });
}
