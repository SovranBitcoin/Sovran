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

type Routes = readonly { name: string }[] | undefined;

/** Whether the root stack holds a backup page, so the backup session is live. */
export function isBackupJourneyOpen(routes: Routes): boolean {
  return routes?.some((route) => BACKUP_ROUTES.has(route.name)) ?? false;
}

/** Whether the root stack holds a prompt or backup page. */
export function isPromptOpen(routes: Routes): boolean {
  return routes?.some((route) => PROMPT_ROUTES.has(route.name)) ?? false;
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
