import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { openPicker } from '@/shared/lib/picker/openPicker';
import { formatRelative } from '@/shared/lib/date';

const NEW_ID = 'new';

/**
 * Open the picker sheet listing prior AI conversations. Tap a row to resume;
 * "New conversation" sits in the footer.
 *
 * Replaces the standalone AiSessionsScreen: "pick one of N" is the picker
 * sheet, not a pushed screen.
 */
export async function openAiSessionsMenu(): Promise<void> {
  const state = useRoutstrStore.getState();
  const sessions = [...state.sessions].sort((a, b) => b.createdAt - a.createdAt);
  const currentSessionId = state.currentSessionId;

  const result = await openPicker({
    title: 'Conversations',
    options:
      sessions.length === 0
        ? [
            {
              id: 'empty',
              title: 'No conversations yet',
              leading: { icon: { name: 'mdi:message-text' } },
              disabled: true,
              reason: 'Start a new chat to see it here.',
              testID: 'ai-sessions-empty',
            },
          ]
        : sessions.map((session) => {
            const lastAt =
              session.messages.length > 0
                ? session.messages[session.messages.length - 1].timestamp
                : session.createdAt;
            return {
              id: session.id,
              title: session.title || 'New conversation',
              description: formatRelative(lastAt, 'conversation-list'),
              leading: { icon: { name: 'mdi:robot' } },
              selected: session.id === currentSessionId,
              testID: `ai-sessions-row-${session.id}`,
            };
          }),
    actions: [
      {
        id: NEW_ID,
        title: 'New conversation',
        icon: 'lucide:square-pen',
        variant: 'primary',
        testID: 'ai-sessions-new',
      },
    ],
  }).result;

  if (result.kind === 'action' && result.id === NEW_ID) {
    useRoutstrStore.getState().createSession();
  } else if (result.kind === 'option' && result.id !== currentSessionId) {
    useRoutstrStore.getState().switchSession(result.id);
  }
}
