import { useContext, useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { NavigationContext } from 'expo-router/react-navigation';

/** Run visual work only while its screen and app are active. Event-driven cleanup
 * also works when navigation freezes React rendering. Hosts outside navigation
 * (for example global payment toasts) follow app activity alone. */
export function useVisualActivityEffect(effect: () => void | (() => void), enabled = true): void {
  const navigation = useContext(NavigationContext);

  useEffect(() => {
    if (!enabled) return;
    let appState = AppState.currentState;
    let windowFocused = true;
    let running = false;
    let cleanup: void | (() => void);
    const update = () => {
      const active =
        appState !== 'background' &&
        appState !== 'inactive' &&
        windowFocused &&
        (navigation?.isFocused() ?? true);
      if (active === running) return;
      running = active;
      if (active) cleanup = effect();
      else {
        cleanup?.();
        cleanup = undefined;
      }
    };
    const focus = navigation?.addListener('focus', update);
    const blur = navigation?.addListener('blur', update);
    const state = AppState.addEventListener('change', (next) => {
      appState = next;
      update();
    });
    const windowBlur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', () => {
            windowFocused = false;
            update();
          })
        : undefined;
    const windowFocus =
      Platform.OS === 'android'
        ? AppState.addEventListener('focus', () => {
            windowFocused = true;
            update();
          })
        : undefined;
    update();
    return () => {
      focus?.();
      blur?.();
      state.remove();
      windowBlur?.remove();
      windowFocus?.remove();
      cleanup?.();
    };
  }, [effect, enabled, navigation]);
}
