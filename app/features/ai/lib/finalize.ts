/**
 * Decide what a completed stream meant, and what to persist for it.
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

/**
 * Whether the stream stopped because the completion budget ran out.
 *
 * `finish_reason` rides on the last chunk of an OpenAI-compatible stream and
 * the app's chunk spine has always validated it — nothing read it. That was
 * survivable while `max_tokens` was a formality at 4096; it stops being
 * survivable the moment the budget is set to what a turn is expected to write,
 * because then it can actually bite, and an answer silently cut short is worse
 * than an answer that cost too much to reserve. `length` is the OpenAI
 * spelling; `MAX_TOKENS` is the Gemini-compatible one some nodes forward
 * verbatim.
 *
 * Anything else — `stop`, `tool_calls`, `content_filter`, absent entirely — is
 * not our budget's doing and must not be reported as though it were.
 */
export function isBudgetTruncation(finishReason: string | null | undefined): boolean {
  if (typeof finishReason !== 'string') return false;
  const normalized = finishReason.toLowerCase();
  return normalized === 'length' || normalized === 'max_tokens';
}
