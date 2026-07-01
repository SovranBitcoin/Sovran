import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { actionMenuPopup } from '@/shared/lib/popup';
import { formatRelative } from '@/shared/lib/date';

/**
 * Open the heroui-Menu (bottom-sheet) listing prior AI conversations. Tap a
 * row to resume; the "New conversation" footer button is sticky.
 *
 * Replaces the standalone AiSessionsScreen — per CLAUDE.md / project memory,
 * "pick one of N" is canonically a heroui Menu, not a pushed screen.
 */
export function openAiSessionsMenu() {
  const state = useRoutstrStore.getState();
  const sessions = [...state.sessions].sort((a, b) => b.createdAt - a.createdAt);
  const currentSessionId = state.currentSessionId;

  actionMenuPopup({
    title: 'Conversations',
    buttons:
      sessions.length === 0
        ? [
            {
              text: 'No conversations yet',
              icon: 'mdi:message-text',
              disabled: true,
              reason: 'Start a new chat to see it here.',
            },
          ]
        : sessions.map((session) => {
            const subtitle =
              session.messages.length > 0
                ? formatRelative(
                    session.messages[session.messages.length - 1].timestamp,
                    'conversation-list'
                  )
                : formatRelative(session.createdAt, 'conversation-list');
            const isCurrent = session.id === currentSessionId;
            return {
              text: session.title || 'New conversation',
              description: subtitle,
              icon: isCurrent ? 'mdi:check' : 'mdi:robot',
              variant: isCurrent ? ('primary' as const) : undefined,
              testID: `ai-sessions-row-${session.id}`,
              onPress: (close: () => void) => {
                useRoutstrStore.getState().switchSession(session.id);
                close();
              },
            };
          }),
    footerButtons: [
      {
        text: 'New conversation',
        icon: 'lucide:square-pen',
        testID: 'ai-sessions-new',
        onPress: (close: () => void) => {
          useRoutstrStore.getState().createSession();
          close();
        },
      },
    ],
  });
}
