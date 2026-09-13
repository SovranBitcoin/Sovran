import type { NavigationState, PartialState } from 'expo-router/react-navigation';

/** Whether the focused tab has no pushed screen competing for the back gesture. */
export function isNestedStackAtRoot(route: {
  state?: NavigationState | PartialState<NavigationState>;
}): boolean {
  let state = route.state;
  let isTabsState = true;

  while (state) {
    // JS and native tabs both use TabRouter. Their index selects a tab, not
    // stack depth. Partial restored states may omit the navigator type.
    const isStack = state.type === 'stack' || (!state.type && !isTabsState);
    const index = state.index ?? (isStack ? state.routes.length - 1 : 0);
    if (isStack && index > 0) return false;

    state = state.routes[index]?.state;
    isTabsState = false;
  }

  return true;
}
