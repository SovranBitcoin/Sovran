import { useState } from 'react';
import { ChatMessageBubble } from '@/shared/ui/composed/chat';
import type { ChatBubbleRenderArgs } from '@/shared/ui/composed/chat/types';
import { Button } from '@/shared/ui/primitives/Button';
import { shouldCensorDm } from '@/features/feed/lib/moderation';

export function ModeratedDmBubble({
  message,
  isFirstInGroup,
  isLastInGroup,
  enabled,
  words,
  scope,
}: ChatBubbleRenderArgs & {
  enabled: boolean;
  words: string[];
  scope: string;
}) {
  // Recycling a list cell or switching accounts must not reveal a different message.
  const identity = JSON.stringify([scope, message.id, message.content, enabled, words]);
  const [disclosure, setDisclosure] = useState({ identity, revealed: false });
  if (disclosure.identity !== identity) setDisclosure({ identity, revealed: false });
  if (
    !message.isOwn &&
    shouldCensorDm(message.content, enabled, words) &&
    (!disclosure.revealed || disclosure.identity !== identity)
  ) {
    return (
      <Button
        text="Reveal censored message"
        variant="secondary"
        onPress={() => setDisclosure({ identity, revealed: true })}
      />
    );
  }
  return (
    <ChatMessageBubble
      message={message}
      isFirstInGroup={isFirstInGroup}
      isLastInGroup={isLastInGroup}
    />
  );
}
