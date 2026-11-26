import { useNavigation } from 'expo-router';
import { StackActions } from 'expo-router/react-navigation';

/**
 * The backup journey's pages, root routes in the order a person meets them.
 * The prompt that offers the backup (`cta`) is not one: it sits beneath.
 */
const BACKUP_ROUTES: ReadonlySet<string> = new Set([
  'backup-intro',
  'backup-words',
  'backup-verify',
  'backup-done',
]);

/**
 * Every page of a prompt and the backup it leads to. While any is open,
 * CtaHost presents no other prompt, and leaving the journey closes them all.
 */
const PROMPT_ROUTES: ReadonlySet<string> = new Set(['cta', 'cta-sample', ...BACKUP_ROUTES]);

type NavRoute = {
  name: string;
  state?: {
    routes?: readonly NavRoute[];
  };
};

type Routes = readonly NavRoute[] | undefined;

/**
 * Walk nested navigation states too: Expo Router's `useRootNavigationState()`
 * returns the outer navigator whose single route (`__root`) holds the app
 * stack under `route.state.routes`.
 */
function hasRouteInTree(routes: Routes, targets: ReadonlySet<string>): boolean {
  if (!routes) return false;
  for (const route of routes) {
    if (targets.has(route.name)) return true;
    if (route.state?.routes && hasRouteInTree(route.state.routes, targets)) return true;
  }
  return false;
}

/** Whether the root stack holds a backup page, so the backup session is live. */
export function isBackupJourneyOpen(routes: Routes): boolean {
  return hasRouteInTree(routes, BACKUP_ROUTES);
}

/** Whether the root stack holds a prompt or backup page. */
export function isPromptOpen(routes: Routes): boolean {
  return hasRouteInTree(routes, PROMPT_ROUTES);
}

/** How many prompt and backup pages sit on top of the root stack. */
function promptDepth(routes: Routes): number {
  let depth = 0;
  for (let at = (routes?.length ?? 0) - 1; at >= 0 && PROMPT_ROUTES.has(routes![at].name); at--) {
    depth += 1;
  }
  return depth;
}

/**
 * Close the whole journey, not just this page: the backup pages and the prompt
 * that led to them, back to where the person was before.
 */
export function useLeaveBackupJourney(): () => void {
  const navigation = useNavigation();
  return () => {
    const depth = promptDepth(navigation.getState()?.routes);
    navigation.dispatch(StackActions.pop(Math.max(1, depth)));
  };
}
