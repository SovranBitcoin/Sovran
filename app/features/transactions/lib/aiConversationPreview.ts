/**
 * @fileoverview The exchange a grouped AI request paid for, reduced to a preview.
 *
 * The payment annotation keeps the ASSISTANT message's id (`useAiSend` opens
 * the payment scope around the answer it is about to stream), so the prompt
 * that caused it is that message's parent. Messages persisted before the tree
 * link existed carry no `parentId`, so the nearest earlier user turn stands in
 * — which is what the tree would have said for a conversation with no branches.
 *
 * Pure, and typed against the smallest shape it needs, so the card's "is this
 * conversation still here?" decision is testable without a store.
 */

/** The fields of a `RoutstrMessage` this preview actually reads. */
export interface PreviewableMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  parentId?: string | null;
}

interface AiConversationPreview {
  /** What we asked. Empty when only the answer survived. */
  prompt: string;
  /** What came back. Empty when only the prompt survived. */
  reply: string;
}

/**
 * The prompt/answer pair to preview, or `null` when there is nothing left to
 * show — an empty session, or one whose messages were all cleared. `null` is
 * the signal to render nothing at all: a card with no content is a dead link.
 */
export function aiConversationPreview(
  messages: readonly PreviewableMessage[],
  messageId: string | undefined
): AiConversationPreview | null {
  if (messages.length === 0) return null;

  const replyIndex = messageId ? messages.findIndex((message) => message.id === messageId) : -1;
  const reply = replyIndex >= 0 ? messages[replyIndex] : null;

  const linkedPrompt = reply?.parentId
    ? messages.find((message) => message.id === reply.parentId)
    : undefined;
  const precedingPrompt = messages
    .slice(0, replyIndex >= 0 ? replyIndex : messages.length)
    .filter((message) => message.role === 'user')
    .pop();
  const prompt = linkedPrompt ?? precedingPrompt ?? null;

  if (!reply && !prompt) return null;

  return {
    prompt: prompt?.content.trim() ?? '',
    reply: reply?.content.trim() ?? '',
  };
}
