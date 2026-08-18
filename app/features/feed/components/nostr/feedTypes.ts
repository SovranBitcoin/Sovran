export interface NoteMetrics {
  likeCount: number;
  repostCount: number;
  replyCount: number;
  satsZapped: number;
}

export interface FeedEvent {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
}

export interface ProfileInfo {
  name: string;
  picture?: string;
}

interface ReposterInfo {
  pubkey: string;
  event: FeedEvent;
}

export type ContentSegment =
  | { kind: 'text'; text: string }
  | { kind: 'newline' }
  | { kind: 'url'; url: string }
  | { kind: 'relay'; url: string }
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string }
  | { kind: 'hashtag'; tag: string }
  | { kind: 'lightning'; meltTarget: string }
  | { kind: 'npub'; pubkey: string; bech32: string }
  | { kind: 'nprofile'; pubkey: string; bech32: string }
  | { kind: 'nevent'; eventId: string }
  | { kind: 'note'; eventId: string }
  | { kind: 'naddr'; identifier: string };

export interface VideoPostRecord {
  eventId: string;
  videoUrl: string;
  content: string;
  pubkey: string;
  created_at: number;
}

/** Unified feed item — either an original note or a repost (Kind 6/16) */
export type FeedItem =
  | {
      type: 'note';
      event: FeedEvent;
      rootEvent?: FeedEvent;
      rootEventId?: string;
      replyPreviewEvents?: FeedEvent[];
      timestamp: number;
    }
  | {
      type: 'repost';
      repostEvent: FeedEvent;
      originalEvent: FeedEvent | undefined;
      originalEventId: string;
      rootEvent?: FeedEvent;
      rootEventId?: string;
      reposters?: ReposterInfo[];
      timestamp: number;
    };

export const DEFAULT_METRICS: NoteMetrics = Object.freeze({
  likeCount: 0,
  repostCount: 0,
  replyCount: 0,
  satsZapped: 0,
});
