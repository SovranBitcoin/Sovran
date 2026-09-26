/**
 * @fileoverview The conversation card on the AI-request detail screen.
 *
 * The same idea as `ZappedPostSection`: a payment screen should show what the
 * money bought, and tapping it should open the thing itself. A zap's card
 * previews the post; this one previews the exchange — the prompt we sent and
 * the answer we paid for — and opens the AI chat on that conversation.
 *
 * Shape borrowed from the zap card: a pill (the model that answered) stuck
 * across the card's top edge, plain typography inside, tap anywhere. The
 * pill lives OUTSIDE the card because the card clips its own content.
 *
 * Silent by design. AI history is local and erasable, so a request whose
 * conversation is gone renders NOTHING rather than a card that taps into a
 * blank chat — `aiConversationPreview` returning null is that decision, and
 * `openAiSession` refuses a vanished session as a second line of defence.
 */

import { useMemo } from 'react';

import type { AiRequestGroup } from 'wallet';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';

import { aiConversationPreview } from '@/features/transactions/lib/aiConversationPreview';
import { openAiSession } from '@/features/transactions/lib/openAiSession';

interface AiConversationSectionProps {
  group: Pick<AiRequestGroup, 'sessionId' | 'messageId' | 'model'>;
}

export function AiConversationSection({ group }: AiConversationSectionProps) {
  const foreground = useThemeColor('foreground');
  const sessions = useRoutstrStore((state) => state.sessions);

  const sessionId = group.sessionId;
  const session = useMemo(
    () => (sessionId ? sessions.find((candidate) => candidate.id === sessionId) : undefined),
    [sessions, sessionId]
  );
  const preview = useMemo(
    () => (session ? aiConversationPreview(session.messages, group.messageId) : null),
    [session, group.messageId]
  );

  if (!session || !preview) return null;

  const title = session.title || 'Conversation';

  return (
    <Log name="AiConversationSection">
      <Pressable
        onPress={() => openAiSession(session.id)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Conversation: ${title}. Opens the AI chat on it.`}
        testID="ai-request-conversation"
        className="mx-4 pt-4">
        <GradientCard>
          {/* pt-7 clears the half of the pill that overlaps into the card. */}
          <View className="px-5 pb-4 pt-7">
            {preview.prompt ? (
              <Text bold size={13} numberOfLines={2} className="text-foreground/70 mb-1.5">
                {preview.prompt}
              </Text>
            ) : null}
            {preview.reply ? (
              <Text size={13} numberOfLines={3} className="text-foreground/55">
                {preview.reply}
              </Text>
            ) : null}
          </View>
        </GradientCard>
        {/* Declared after the card so it paints on top of it. */}
        <HStack className="bg-surface-tertiary absolute top-0 z-10 h-8 max-w-[85%] items-center gap-2 self-center rounded-full px-3">
          <Icon name="mdi:robot-outline" size={16} color={foreground} />
          <Text medium size={13} numberOfLines={1} className="text-foreground">
            {group.model ?? title}
          </Text>
        </HStack>
      </Pressable>
    </Log>
  );
}
