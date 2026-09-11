import { useCallback } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { actionMenuPopup } from '@/shared/lib/popup';
import { buildShareLinks } from '@/shared/lib/nostr/njump';
import { getOwnWriteRelays } from '@/shared/lib/nostr/outbox/relayListStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useFeedIgnoreStore } from '@/features/feed/stores/ignoreStore';

import { useModerationActions } from './useModerationActions';
import { useDeletePost } from './useDeletePost';
import { tryNpubEncode } from '../components/nostr/feedParse';
import type { FeedEvent } from '../components/nostr/feedTypes';

type MenuButton = NonNullable<Parameters<typeof actionMenuPopup>[0]['buttons']>[number];

/** Post menu: sharing, local hiding, account blocking, reports, and own-post deletion. */
export function usePostActions(options?: {
  /** Resolve a display name for the "Block person" row description. */
  getProfileName?: (pubkey: string) => string | undefined;
}) {
  const ignoreEvent = useFeedIgnoreStore((s) => s.ignoreEvent);
  const { block, report } = useModerationActions();
  const getProfileName = options?.getProfileName;
  const deletePost = useDeletePost();
  const myPubkey = useNostrKeysContext().keys?.pubkey;

  return useCallback(
    (event: FeedEvent) => {
      const fallback = tryNpubEncode(event.pubkey).slice(0, 12) + '…';
      const isAuthor = !!myPubkey && event.pubkey.toLowerCase() === myPubkey.toLowerCase();
      // Confirm before the irreversible kind:5 broadcast.
      const confirmDelete = (): void => {
        actionMenuPopup({
          title: 'Delete post?',
          buttons: [
            {
              text: 'Delete',
              icon: 'mdi:trash-can-outline',
              variant: 'dangerous',
              description: 'Requests deletion from all relays. Some may keep a copy.',
              onPress: (close) => {
                close();
                void deletePost(event);
              },
            },
          ],
        });
      };
      const deleteButtons: MenuButton[] = isAuthor
        ? [
            {
              text: 'Delete post',
              icon: 'mdi:trash-can-outline',
              variant: 'dangerous',
              testID: 'post-delete',
              // Chain to the confirm by swapping the sheet content in place
              // (`keepOpen`, no `close()`). Calling close() first dismisses the
              // host, which then drops the re-opened confirm's button dispatch —
              // proven via logs: the confirm was tapped but deletePost never ran.
              keepOpen: true,
              onPress: () => confirmDelete(),
            },
          ]
        : [];
      const links = buildShareLinks(event, getOwnWriteRelays()[0]);
      const shareButtons: MenuButton[] = links
        ? [
            {
              text: 'Share',
              icon: 'mdi:share-variant-outline',
              onPress: (close) => {
                close();
                void Share.share({ message: links.njumpUrl });
              },
            },
            {
              text: 'Copy link',
              icon: 'mdi:link-variant',
              onPress: (close) => {
                close();
                void Clipboard.setStringAsync(links.njumpUrl);
              },
            },
          ]
        : [];
      const buttons: MenuButton[] = [
        ...shareButtons,
        {
          text: 'Hide post',
          icon: 'mdi:eye-off-outline',
          testID: 'thread-ignore-post',
          onPress: (close) => {
            close();
            ignoreEvent(event.id);
          },
        },
        ...(!isAuthor
          ? [
              {
                text: 'Block person',
                description: getProfileName?.(event.pubkey) ?? fallback,
                icon: 'mdi:account-cancel-outline' as const,
                testID: 'thread-ignore-person',
                onPress: (close: () => void) => {
                  close();
                  void block(event.pubkey, true);
                },
              },
              {
                text: 'Report post',
                icon: 'material-symbols:report-rounded' as const,
                keepOpen: true,
                onPress: () => report(event.pubkey, event.id),
              },
            ]
          : []),
        ...deleteButtons,
      ];
      actionMenuPopup({ title: 'Post', buttons });
    },
    [ignoreEvent, block, report, getProfileName, deletePost, myPubkey]
  );
}
