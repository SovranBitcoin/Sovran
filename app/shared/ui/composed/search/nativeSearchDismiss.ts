import { Keyboard } from 'react-native';

type DismissHandler = () => boolean;

let activeDismissHandler: DismissHandler | null = null;
let pendingNavigation = false;

/**
 * Registers the active iOS `Stack.SearchBar` deactivation callback.
 *
 * Returns an unregister function that only clears its own registration so
 * remounts and StrictMode double-effects never clobber a newer handler.
 */
export function registerNativeSearchDismiss(handler: DismissHandler): () => void {
  activeDismissHandler = handler;
  return () => {
    if (activeDismissHandler === handler) {
      activeDismissHandler = null;
    }
  };
}

/**
 * Dismisses the keyboard and, when iOS 26's native `UISearchController` is
 * active inside the `role="search"` tab, deactivates it (`cancelSearch()`) and
 * waits two frames before running `navigate`.
 *
 * Pushing a root-stack route (like `/profile`) while a nested
 * `UITabBarController`'s search controller is still active leaves iOS 26's
 * bottom native tab bar corrupted when popping back. Letting UIKit commit
 * `_controller.active = NO` first keeps the footer tabs intact on return.
 */
export function runAfterNativeSearchDismiss(navigate: () => void): void {
  Keyboard.dismiss();
  if (pendingNavigation) return;
  const didDismissController = activeDismissHandler ? activeDismissHandler() : false;
  if (!didDismissController) {
    navigate();
    return;
  }
  pendingNavigation = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pendingNavigation = false;
      navigate();
    });
  });
}
