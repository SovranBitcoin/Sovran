import { sendBLEMessage, sendBLEPrivateMessage, startBLE, startBLEPrivateChat } from 'bitchat-module';
import type { BitchatBLEIdentityMaterial } from 'bitchat-module';

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
  identityMaterial: BitchatBLEIdentityMaterial | null | undefined;
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
  identityMaterial,
  messageIdPrefix = 'bitchat',
  maxBytes = DEFAULT_MAX_BYTES,
  handshakeDelayMs = DEFAULT_HANDSHAKE_DELAY_MS,
  deps,
}: SendBLEPrivateMessageChunksOptions): Promise<SendBLEPrivateMessageChunksResult> {
  if (!profileScope) throw new Error('BitChat profile scope unavailable');
  if (!identityMaterial) throw new Error('BitChat identity material unavailable');
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
  await startBLEFn(effectiveNickname, profileScope, identityMaterial);
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

interface SendBLEPublicMessageDeps {
  startBLE?: typeof startBLE;
  sendBLEMessage?: typeof sendBLEMessage;
  now?: () => number;
}

interface SendBLEPublicMessageOptions {
  content: string;
  nickname: string;
  profileScope: string;
  identityMaterial: BitchatBLEIdentityMaterial | null | undefined;
  deps?: SendBLEPublicMessageDeps;
}

interface SendBLEPublicMessageResult {
  startupMs: number;
  sendMs: number;
}

/**
 * Send `content` as a SINGLE public BLE mesh message and let the transport
 * handle fragmentation/reassembly.
 *
 * Why public + one message instead of a private Noise DM:
 * bitchat's private-message wire format (`PrivateMessagePacket`) carries the
 * text in a TLV with a ONE-byte length prefix, so content is hard-capped at
 * 255 UTF-8 bytes — `encode()` returns nil and drops anything larger. That is
 * why a multi-KB ecash token previously had to be split into many separate
 * Noise DMs (`sendBLEPrivateMessageChunks`), which unmodified bitchat receivers
 * cannot reassemble — they surface as many disjoint messages, none of which is
 * a complete token.
 *
 * The public `.message` path instead carries up to 60_000 bytes (2-byte length
 * field), is transparently BLE-fragmented on send and reassembled into exactly
 * ONE message on receive, and stock bitchat already detects `cashu…` tokens and
 * renders them as a single tappable, redeemable chip. So the whole token lands
 * as one unit on an unmodified receiver with no receiver-side changes.
 *
 * Trade-off: a public message is broadcast across the mesh (signed but NOT
 * Noise-encrypted), so the bearer token is readable by any peer in BLE/relay
 * range. This is inherent — stock bitchat only renders Cashu tokens on the
 * public path — and matches the "drop" semantics of NearPay/Nut Drop.
 */
export async function sendBLEPublicMessage({
  content,
  nickname,
  profileScope,
  identityMaterial,
  deps,
}: SendBLEPublicMessageOptions): Promise<SendBLEPublicMessageResult> {
  if (!profileScope) throw new Error('BitChat profile scope unavailable');
  if (!identityMaterial) throw new Error('BitChat identity material unavailable');

  const startBLEFn = deps?.startBLE ?? startBLE;
  const sendMessageFn = deps?.sendBLEMessage ?? sendBLEMessage;
  const now = deps?.now ?? (() => performance.now());

  const effectiveNickname = nickname || 'sovran';

  const startupAt = now();
  await startBLEFn(effectiveNickname, profileScope, identityMaterial);
  const startupMs = now() - startupAt;

  const sendAt = now();
  await sendMessageFn(content);

  return { startupMs, sendMs: now() - sendAt };
}
