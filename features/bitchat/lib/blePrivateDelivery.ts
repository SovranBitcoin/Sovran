import { sendBLEPrivateMessage, startBLE, startBLEPrivateChat } from 'bitchat-module';

import { mintLocalId } from '@/shared/lib/id';

interface SendBLEPrivateMessageChunksDeps {
  startBLE?: typeof startBLE;
  startBLEPrivateChat?: typeof startBLEPrivateChat;
  sendBLEPrivateMessage?: typeof sendBLEPrivateMessage;
  createMessageId?: () => string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface SendBLEPrivateMessageChunksOptions {
  peerID: string;
  content: string;
  nickname: string;
  profileScope: string;
  messageIdPrefix?: string;
  maxBytes?: number;
  handshakeDelayMs?: number;
  deps?: SendBLEPrivateMessageChunksDeps;
}

interface SendBLEPrivateMessageChunksResult {
  chunks: number;
  messageIds: string[];
  startupMs: number;
  handshakeMs: number;
  sendMs: number;
  handshakeError?: string;
}

const DEFAULT_MAX_BYTES = 255;
const DEFAULT_HANDSHAKE_DELAY_MS = 250;
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false });

/**
 * Split text into chunks whose UTF-8 byte length is <= maxBytes.
 *
 * BitChat private-message content is carried in a TLV with a one-byte length
 * prefix, so app-layer chunking is the safe boundary. The splitter backs off
 * UTF-8 continuation bytes and prefers a recent newline for readability.
 */
export function chunkUtf8(text: string, maxBytes = DEFAULT_MAX_BYTES): string[] {
  if (!text) return [];
  if (maxBytes <= 0) throw new Error('maxBytes must be positive');

  const bytes = UTF8_ENCODER.encode(text);
  if (bytes.length <= maxBytes) return [text];

  const chunks: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    let end = Math.min(i + maxBytes, bytes.length);
    if (end < bytes.length) {
      while (end > i && (bytes[end] & 0xc0) === 0x80) end--;
      if (end === i) throw new Error('maxBytes is too small for the next UTF-8 code point');
      const floor = Math.max(i + 1, end - 64);
      for (let j = end - 1; j >= floor; j--) {
        if (bytes[j] === 0x0a) {
          end = j + 1;
          break;
        }
      }
    }
    chunks.push(UTF8_DECODER.decode(bytes.subarray(i, end)));
    i = end;
  }
  return chunks;
}

export async function sendBLEPrivateMessageChunks({
  peerID,
  content,
  nickname,
  profileScope,
  messageIdPrefix = 'bitchat',
  maxBytes = DEFAULT_MAX_BYTES,
  handshakeDelayMs = DEFAULT_HANDSHAKE_DELAY_MS,
  deps,
}: SendBLEPrivateMessageChunksOptions): Promise<SendBLEPrivateMessageChunksResult> {
  if (!profileScope) throw new Error('BitChat profile scope unavailable');
  if (!peerID) throw new Error('BitChat peer unavailable');

  const startBLEFn = deps?.startBLE ?? startBLE;
  const startPrivateChatFn = deps?.startBLEPrivateChat ?? startBLEPrivateChat;
  const sendPrivateMessageFn = deps?.sendBLEPrivateMessage ?? sendBLEPrivateMessage;
  const createMessageId = deps?.createMessageId ?? (() => mintLocalId(messageIdPrefix));
  const sleep =
    deps?.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps?.now ?? (() => performance.now());

  const effectiveNickname = nickname || 'sovran';
  const chunks = chunkUtf8(content, maxBytes);

  const startupAt = now();
  await startBLEFn(effectiveNickname, profileScope);
  const startupMs = now() - startupAt;

  const handshakeAt = now();
  let handshakeError: string | undefined;
  await startPrivateChatFn(peerID).catch((err: unknown) => {
    handshakeError = err instanceof Error ? err.message : String(err);
  });
  const handshakeMs = now() - handshakeAt;
  await sleep(handshakeDelayMs);

  const sendAt = now();
  const messageIds: string[] = [];
  for (const chunk of chunks) {
    const messageId = createMessageId();
    await sendPrivateMessageFn(peerID, chunk, effectiveNickname, messageId);
    messageIds.push(messageId);
  }

  return {
    chunks: chunks.length,
    messageIds,
    startupMs,
    handshakeMs,
    sendMs: now() - sendAt,
    ...(handshakeError ? { handshakeError } : {}),
  };
}
