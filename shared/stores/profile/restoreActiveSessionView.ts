/**
 * Repopulate the runtime working-copy fields (`conversationHistory`,
 * `activeChildren`) of the routstr store from the active session row. Lives
 * outside `routstrStore.ts` so unit tests can exercise the rehydrate
 * invariant without dragging the full zustand-persist + schema graph into
 * the test environment.
 *
 * These fields are no longer persisted standalone (audit 14.json F-003) —
 * `sessions[currentSessionId].messages` is the canonical source of truth.
 */
export interface RestoreActiveSessionViewState<TMessage, TActiveChildren> {
  currentSessionId: string | null;
  sessions: readonly {
    id: string;
    messages: TMessage[];
    activeChildren?: TActiveChildren;
  }[];
  conversationHistory: TMessage[];
  activeChildren: TActiveChildren;
}

export function restoreActiveSessionView<TMessage, TActiveChildren extends Record<string, string>>(
  state: RestoreActiveSessionViewState<TMessage, TActiveChildren>
): void {
  if (!state.currentSessionId) return;
  const session = state.sessions.find((s) => s.id === state.currentSessionId);
  if (!session) return;
  state.conversationHistory = session.messages;
  state.activeChildren = session.activeChildren ?? ({} as TActiveChildren);
}
