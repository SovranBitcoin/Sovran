/**
 * The canonical "Repost or Quote" chooser. Every repost/retweet button across
 * the app opens this so the behaviour is identical everywhere — a plain repost
 * (kind 6) or a quote (opens the composer with the post quoted).
 *
 * Pass `onQuote` to enable the Quote row; omit it to grey it out ("Coming soon").
 */
import { actionMenuPopup } from '@/shared/lib/popup/popups/actionMenu';

export function openRepostMenu({
  reposted,
  onRepost,
  onQuote,
}: {
  /** Whether the viewer has already reposted — flips the first row to "Undo repost". */
  reposted: boolean;
  onRepost: () => void;
  onQuote?: () => void;
}): void {
  actionMenuPopup({
    title: 'Repost',
    buttons: [
      {
        text: reposted ? 'Undo repost' : 'Repost',
        icon: 'garden:arrow-retweet-fill-16',
        onPress: (close) => {
          close();
          onRepost();
        },
      },
      {
        text: 'Quote',
        icon: 'mdi:format-quote-close',
        disabled: !onQuote,
        reason: onQuote ? undefined : 'Coming soon',
        onPress: (close) => {
          close();
          onQuote?.();
        },
      },
    ],
  });
}
