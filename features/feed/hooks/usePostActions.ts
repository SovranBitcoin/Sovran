import { useCallback } from 'react';

import { actionMenuPopup } from '@/shared/lib/popup';
import { useFeedIgnoreStore } from '@/features/feed/stores/ignoreStore';

import { tryNpubEncode } from '../components/nostr/feedParse';
import type { FeedEvent } from '../components/nostr/feedTypes';

/**
 * Post "more" menu — Ignore post / Ignore person.
 *
 * Deliberately wired ONLY in the thread/detail view, not the feed list:
 * ignoring is a considered action, so it belongs where the user has tapped into
 * a post, not on every feed row. The feed reactively hides ignored posts/people
 * via the ignore store (no imperative list removal needed).
 */
export function usePostActions(options?: {
  /** Resolve a display name for the "Ignore person" row description. */
  getProfileName?: (pubkey: string) => string | undefined;
}) {
  const ignoreEvent = useFeedIgnoreStore((s) => s.ignoreEvent);
  const ignorePubkey = useFeedIgnoreStore((s) => s.ignorePubkey);
  const getProfileName = options?.getProfileName;

  return useCallback(
    (event: FeedEvent) => {
      const fallback = tryNpubEncode(event.pubkey).slice(0, 12) + '…';
      actionMenuPopup({
        title: 'Post',
        buttons: [
          {
            text: 'Ignore post',
            icon: 'mdi:eye-off-outline',
            testID: 'thread-ignore-post',
            onPress: (close) => {
              close();
              ignoreEvent(event.id);
            },
          },
          {
            text: 'Ignore person',
            description: getProfileName?.(event.pubkey) ?? fallback,
            icon: 'mdi:account-cancel-outline',
            testID: 'thread-ignore-person',
            onPress: (close) => {
              close();
              ignorePubkey(event.pubkey);
            },
          },
        ],
      });
    },
    [ignoreEvent, ignorePubkey, getProfileName]
  );
}
