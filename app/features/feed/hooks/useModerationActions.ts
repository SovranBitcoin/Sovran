import { useNostrNDKContext } from '@/shared/providers/NostrNDKProvider';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { actionMenuPopup, popup } from '@/shared/lib/popup';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import {
  BlockSyncError,
  publishReport,
  setPersonBlocked,
  syncMuteList,
} from '@/shared/lib/nostr/moderation';
import { REPORT_REASONS, type ReportReason } from '../lib/moderation';
import { useFeedIgnoreStore } from '../stores/ignoreStore';

export function useModerationActions() {
  const { ndk } = useNDK();
  const { isInitialized } = useNostrNDKContext();
  const ownPubkey = useNostrKeysContext().keys?.pubkey;

  const block = async (pubkey: string, blocked: boolean) => {
    if (!isInitialized || !ndk || !ownPubkey) {
      popup({ message: 'Account is still loading', type: 'error' });
      return;
    }
    await setPersonBlocked(ndk, ownPubkey, pubkey, blocked).then(
      () => {
        popup({
          message: blocked ? 'Person blocked' : 'Person unblocked',
          type: 'success',
          variant: 'toast',
        });
      },
      (error: unknown) => {
        popup({
          message:
            error instanceof BlockSyncError
              ? blocked
                ? 'Blocked on this device'
                : 'Unblocked on this device'
              : blocked
                ? 'Could not block this person'
                : 'Could not unblock this person',
          text:
            error instanceof BlockSyncError
              ? 'Could not sync this change to your other apps. You can retry in Settings → Moderation.'
              : 'Try again once your account has finished loading.',
          type: 'error',
          variant: error instanceof BlockSyncError ? 'toast' : undefined,
        });
      }
    );
  };

  const report = (pubkey: string, publicEventId?: string) => {
    actionMenuPopup({
      title: 'Report reason',
      buttons: Object.entries(REPORT_REASONS).map(([reason, label]) => ({
        text: label,
        icon: 'material-symbols:report-rounded',
        keepOpen: true,
        onPress: () =>
          actionMenuPopup({
            title: 'Publish a public report?',
            buttons: [
              {
                text: 'Publish report',
                icon: 'material-symbols:report-rounded',
                variant: 'dangerous',
                description:
                  'Your account, the reported account, reason, and public post ID (if selected) will be public on Nostr. Private message text is never included. Relay delivery does not guarantee moderator review or removal.',
                onPress: (close) => {
                  close();
                  if (!isInitialized || !ndk || !ownPubkey) {
                    popup({ message: 'Account is still loading', type: 'error' });
                    return;
                  }
                  void publishReport(
                    ndk,
                    ownPubkey,
                    pubkey,
                    reason as ReportReason,
                    publicEventId
                  ).then(
                    () => popup({ message: 'Report published to Nostr', type: 'success' }),
                    () =>
                      popup({
                        message: 'Report could not be published',
                        text: 'Try again when connected.',
                        type: 'error',
                      })
                  );
                },
              },
            ],
          }),
      })),
    });
  };

  const personMenu = (pubkey: string) => {
    if (pubkey === ownPubkey) return;
    const blocked = useFeedIgnoreStore.getState().ignoredPubkeys.includes(pubkey);
    actionMenuPopup({
      title: 'Block or report',
      buttons: [
        {
          text: blocked ? 'Unblock person' : 'Block person',
          icon: 'mdi:account-cancel-outline',
          description: blocked
            ? 'Show their posts and messages again.'
            : 'Hide their posts and messages. They can still see your public posts.',
          onPress: (close) => {
            close();
            void block(pubkey, !blocked);
          },
        },
        {
          text: 'Report person',
          icon: 'material-symbols:report-rounded',
          keepOpen: true,
          onPress: () => report(pubkey),
        },
      ],
    });
  };
  const refresh = async () => {
    if (!isInitialized || !ndk || !ownPubkey) {
      popup({ message: 'Account is still loading', type: 'error' });
      return;
    }
    try {
      await syncMuteList(ndk, ownPubkey);
      popup({ message: 'Blocked people updated', type: 'success', variant: 'toast' });
    } catch {
      popup({
        message: 'Could not update blocked people',
        text: 'Check your connection and try again. Your current blocks are still in place.',
        type: 'error',
      });
    }
  };
  return { block, report, personMenu, refresh };
}
