/**
 * The error pill that stands in for a failed assistant turn.
 *
 * A failure belongs where the answer would have been: in the conversation, at
 * the turn that failed, with the recovery attached to it. A toast said the
 * same words somewhere else and then took the turn away with it, leaving the
 * user with a question they had already asked and nothing to press.
 *
 * What it offers is decided entirely by the catalogue id — see
 * `chatErrorActions`. This component owns only the destinations: the send
 * flow's own retry (handed down from the screen, so it stays absent while
 * another turn is in flight), the existing model picker, the AI provider list
 * and the wallet's receive flow.
 */
import { useCallback } from 'react';

import Icon from 'assets/icons';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { aiLog } from '@/shared/lib/logger';
import { modelPickerPopup } from '@/shared/lib/popup';
import { Button } from '@/shared/ui/primitives/Button';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

import {
  CHAT_ERROR_ACTION_LABELS,
  chatErrorActions,
  type ChatErrorActionId,
} from '../lib/chatErrorActions';
import { navigateToAddFunds } from '../lib/navigateToAddFunds';
import type { TurnError } from '../lib/turnErrors';

interface AiTurnErrorPillProps {
  /** The failed assistant message this pill stands in for. */
  messageId: string;
  error: TurnError;
  /**
   * Re-runs the turn. Omitted while another turn is streaming, which drops
   * the Retry action rather than offering a button the send flow would refuse.
   */
  onRetry?: (messageId: string) => void;
}

interface ActionButtonProps {
  action: ChatErrorActionId;
  messageId: string;
  onPress: (action: ChatErrorActionId) => void;
}

function ActionButton({ action, messageId, onPress }: ActionButtonProps) {
  const label = CHAT_ERROR_ACTION_LABELS[action];
  const handlePress = useCallback(() => onPress(action), [onPress, action]);
  return (
    <Button
      variant="secondary"
      size="compact"
      text={label}
      accessibilityLabel={label}
      onPress={handlePress}
      testID={`ai-message-error-${action}-${messageId}`}
    />
  );
}

export function AiTurnErrorPill({ messageId, error, onRetry }: AiTurnErrorPillProps) {
  const [danger, dangerInk, muted] = useThemeColor([
    'danger',
    'danger-soft-foreground',
    'muted',
  ] as const);

  const handleAction = useCallback(
    (action: ChatErrorActionId) => {
      aiLog.info('ai.turn_error.action', { messageId, errorId: error.id, action });
      switch (action) {
        case 'retry':
          onRetry?.(messageId);
          return;
        case 'change-model':
          modelPickerPopup();
          return;
        case 'change-provider':
          router.navigate('/(ai-flow)/providers');
          return;
        case 'top-up':
          navigateToAddFunds();
          return;
      }
    },
    [messageId, error.id, onRetry]
  );

  // Retry is the one action with a precondition outside this component: the
  // send flow refuses a second turn while one is in flight, so without
  // `onRetry` the button would be a dead control rather than a disabled one.
  const actions = chatErrorActions(error.id).filter(
    (action) => action !== 'retry' || onRetry !== undefined
  );

  return (
    <View
      testID={`ai-message-error-${messageId}`}
      accessibilityRole="alert"
      accessibilityLabel={error.detail ? `${error.text} ${error.detail}` : error.text}
      className="bg-danger-soft w-full gap-2 rounded-2xl px-3 py-2.5">
      <View className="flex-row items-start gap-2">
        <Icon name="ri:error-warning-fill" size={16} color={danger} />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text size={13} color={dangerInk}>
            {error.text}
          </Text>
          {error.detail ? (
            <Text size={12} color={muted} testID={`ai-message-error-detail-${messageId}`}>
              {error.detail}
            </Text>
          ) : null}
        </View>
      </View>
      {actions.length > 0 ? (
        <View className="flex-row flex-wrap items-center gap-1 pl-4">
          {actions.map((action) => (
            <ActionButton
              key={action}
              action={action}
              messageId={messageId}
              onPress={handleAction}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
