/**
 * @fileoverview Open the AI chat on the conversation a payment bought.
 *
 * The AI chat is a TAB, not a screen inside the transactions modal, so this
 * cannot push the way `ZappedPostSection` pushes a thread into its own flow
 * group. The conversation to show is store state (`currentSessionId`), not a
 * route param, so opening one is two moves: point the store at the session,
 * then leave the modal and land on the tab. The navigate is deferred until the
 * dismissal settles — navigating mid-dismissal remounts the modal header and
 * lands on a blank screen.
 *
 * Refuses a session that is no longer there, so a stale annotation can never
 * dump the user on someone else's conversation.
 */

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { runAfterInteractions } from '@/shared/lib/interactions';
import { log } from '@/shared/lib/logger';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

/** The AI tab's canonical route, as `DrawerContent` spells it. */
const AI_TAB_ROUTE = '/(drawer)/(tabs)/ai' as const;

export function openAiSession(sessionId: string): void {
  const store = useRoutstrStore.getState();
  if (!store.sessions.some((session) => session.id === sessionId)) {
    log.warn('tx.ai.session_missing', { sessionId });
    return;
  }
  log.info('tx.ai.open_session', { sessionId });
  store.switchSession(sessionId);
  if (router.canDismiss()) router.dismissAll();
  runAfterInteractions(() => {
    router.navigate(AI_TAB_ROUTE);
  });
}
