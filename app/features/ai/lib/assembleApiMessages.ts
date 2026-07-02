/**
 * Turn a conversation path (active branch or retry ancestry) into the
 * OpenAI-compatible message array for `chat/completions`. ONE assembly
 * function shared by `useAiSend`'s send and retry flows, so multimodal
 * behavior can't diverge between them.
 *
 * Inline-image window: only images from the newest `MAX_INLINE_IMAGE_TURNS`
 * attachment-bearing user turns (capped at `MAX_INLINE_IMAGES` images
 * total, newest turns first) are encoded into `image_url` parts. Older
 * attachment turns are assembled text-only — without the bound, every
 * historical image would be retransmitted in full (~500KB base64 each) on
 * every subsequent turn, growing per-request payload linearly with
 * conversation length. Persisted attachments and bubble rendering are
 * untouched; this is request assembly only.
 *
 * The encoder is injected (production: the memoized `encodeChatImage`)
 * so the windowing/degradation contract is unit-testable without native
 * image mocks. An encoder returning `null` (missing/expired local URI)
 * degrades that image, never the send.
 */
import type { RoutstrChatMessage, RoutstrContentPart } from '@/shared/lib/routstr/api';
import type { ChatAttachment, RoutstrMessage } from '@/shared/stores/profile/routstrStore';
import { aiLog } from '@/shared/lib/logger';

/** Newest N attachment-bearing user turns whose images ride inline. */
export const MAX_INLINE_IMAGE_TURNS = 2;
/** Hard cap on `image_url` parts per request across the window. */
export const MAX_INLINE_IMAGES = 4;

type ChatImageEncoder = (attachment: ChatAttachment) => Promise<string | null>;

interface AssembledApiMessages {
  messages: RoutstrChatMessage[];
  /** `image_url` parts actually included — drives the vision-aware
   *  candidate-chain filter and the request logs. */
  imageCount: number;
}

/**
 * @param path     Conversation messages in send order (active path for a
 *                 new send; exclusive ancestry for a retry).
 * @param encode   Attachment → data-URL encoder (memoized in production).
 */
export async function assembleApiMessages(
  path: RoutstrMessage[],
  encode: ChatImageEncoder
): Promise<AssembledApiMessages> {
  const sendable = path.filter((m) => m.content || (m.attachments?.length ?? 0) > 0);

  // Decide the inline window: indices of the newest attachment-bearing
  // user turns, walked newest-first under both the turn and image caps.
  const inlineBudget = new Map<number, number>(); // index → images allowed
  let turnsTaken = 0;
  let imagesTaken = 0;
  for (let i = sendable.length - 1; i >= 0; i--) {
    const m = sendable[i];
    if (m.role !== 'user' || !m.attachments?.length) continue;
    if (turnsTaken >= MAX_INLINE_IMAGE_TURNS || imagesTaken >= MAX_INLINE_IMAGES) break;
    const allowance = Math.min(m.attachments.length, MAX_INLINE_IMAGES - imagesTaken);
    inlineBudget.set(i, allowance);
    turnsTaken++;
    imagesTaken += allowance;
  }

  let imageCount = 0;
  const messages: RoutstrChatMessage[] = [];
  for (let i = 0; i < sendable.length; i++) {
    const m = sendable[i];
    const role = m.role as RoutstrChatMessage['role'];
    const allowance = inlineBudget.get(i) ?? 0;
    if (allowance === 0) {
      // Outside the window (or no attachments): plain string content, the
      // exact shape every pre-image conversation already sent.
      messages.push({ role, content: m.content });
      continue;
    }
    const parts: RoutstrContentPart[] = [];
    if (m.content) parts.push({ type: 'text', text: m.content });
    for (const attachment of m.attachments!.slice(0, allowance)) {
      const dataUrl = await encode(attachment);
      if (dataUrl == null) {
        aiLog.warn('ai.attach.encode_missing', {
          reason: 'assembly_degraded',
          messageId: m.id,
        });
        continue;
      }
      parts.push({ type: 'image_url', image_url: { url: dataUrl } });
      imageCount++;
    }
    // All images degraded and no text → nothing sendable in this turn;
    // fall back to the (possibly empty) string so the turn keeps its slot
    // in the conversation instead of silently vanishing.
    messages.push(parts.length > 0 ? { role, content: parts } : { role, content: m.content });
  }

  return { messages, imageCount };
}
