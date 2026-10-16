import type { Feature } from '@/shared/config/features';

type FeatureTab = { name: string; feature?: Feature };

/**
 * The tabs a build ships, in bar order (ADR 0021). With the feed present the
 * declared order stands, so Feed leads. Without it the wallet leads: the
 * first tab is where the app lands on launch.
 */
export function orderTabs<T extends FeatureTab>(
  tabs: readonly T[],
  enabled: (feature: Feature) => boolean
): T[] {
  const shipped = tabs.filter((tab) => !tab.feature || enabled(tab.feature));
  if (enabled('feed')) return shipped;
  return [
    ...shipped.filter((tab) => tab.name === 'index'),
    ...shipped.filter((tab) => tab.name !== 'index'),
  ];
}

type TabState = { index: number; routes: readonly { name: string }[] };

/**
 * Narrow a tab navigator's state to the tabs the build ships. Expo Router
 * creates a route for every tab folder, declared or not, so a bar that maps
 * over `state.routes` would otherwise draw the hidden ones. The index is
 * remapped; it is -1 while a hidden tab is briefly focused before the route
 * guard redirects.
 */
export function visibleTabState<S extends TabState>(state: S, shown: ReadonlySet<string>): S {
  if (state.routes.every((route) => shown.has(route.name))) return state;
  const focused = state.routes[state.index];
  const routes = state.routes.filter((route) => shown.has(route.name));
  return { ...state, routes, index: focused ? routes.indexOf(focused) : -1 };
}
