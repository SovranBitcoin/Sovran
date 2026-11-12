import { Text } from '@/shared/ui/primitives/Text';
import { useFeedIgnoreStore } from '../stores/ignoreStore';

/**
 * How the person's blocks and DM word filter (`wordFilter`, for `ModeratedDmBubble`) apply to one
 * conversation; never blocked without `pubkey`. While `blocked` the screen shows no messages and no
 * composer, `banner` says how to unblock, and `guardSend` drops a send that lands after the block.
 */
export function useBlockedConversation(pubkey: string | undefined) {
  const blocked = useFeedIgnoreStore((s) => !!pubkey && s.ignoredPubkeys.includes(pubkey));
  return {
    blocked,
    banner: blocked ? (
      <Text>This person is blocked. Open “Block or report” to unblock them.</Text>
    ) : undefined,
    guardSend: (send: (text: string) => unknown) => (text: string) =>
      pubkey && useFeedIgnoreStore.getState().ignoredPubkeys.includes(pubkey)
        ? undefined
        : send(text),
    wordFilter: {
      enabled: useFeedIgnoreStore((s) => s.dmFilterEnabled),
      words: useFeedIgnoreStore((s) => s.dmFilterWords),
    },
  };
}
