import { useMemo } from 'react';

type GroupedKey = { isFirst: boolean; isLast: boolean };

/**
 * Computes "first/last in sender group" flags so consecutive messages from
 * the same author render as one tightly-stacked bubble cluster. Lifted from
 * GeohashChatScreen so multiple chat surfaces (BitChat, White Noise) share
 * one implementation.
 */
export function useMessageGrouping<T extends { id: string; senderPubkey: string }>(
  messages: readonly T[]
): Map<string, GroupedKey> {
  return useMemo(() => {
    const map = new Map<string, GroupedKey>();
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const prev = i > 0 ? messages[i - 1] : null;
      const next = i < messages.length - 1 ? messages[i + 1] : null;
      const isFirst = !prev || prev.senderPubkey !== msg.senderPubkey;
      const isLast = !next || next.senderPubkey !== msg.senderPubkey;
      map.set(msg.id, { isFirst, isLast });
    }
    return map;
  }, [messages]);
}
