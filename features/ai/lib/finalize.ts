/**
 * Decide what to persist for an assistant message at stream completion.
 *
 * The placeholder text "(No response received)" is reserved for the case
 * where the stream produced chunks but neither content nor reasoning — the
 * model sent only metadata. A reasoning-only stream (DeepSeek-R1 truncated
 * after thinking, o-series with low-effort caps) returns an empty content
 * with `reasoningContent` populated; the bubble's `hasContent` check then
 * renders the reasoning section without an apologetic body.
 *
 * Returns `null` when nothing should be persisted (no chunks received at
 * all — typically a connect-time bail-out handled upstream).
 */
interface FinalizeInput {
  fullContent: string;
  fullReasoning: string;
  chunkCount: number;
}

interface FinalizePayload {
  content: string;
  reasoningContent?: string;
}

export function pickFinalizeMessage(input: FinalizeInput): FinalizePayload | null {
  const { fullContent, fullReasoning, chunkCount } = input;
  if (chunkCount === 0) return null;
  if (fullContent) {
    return {
      content: fullContent,
      reasoningContent: fullReasoning || undefined,
    };
  }
  if (fullReasoning) {
    return { content: '', reasoningContent: fullReasoning };
  }
  return { content: '(No response received)' };
}
