import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import { spacing } from '@/shared/styles/tokens';

export const DEFAULT_REPLY_SKELETON_COUNT = 3;
export const MAX_REPLY_SKELETON_COUNT = 5;

export const REPLY_SKELETON_VARIANTS = [
  {
    author: 'Display Name',
    timestamp: '12m',
    content: ['A short reply is loading'],
    metricWidth: spacing.lg,
  },
  {
    author: 'Longer Display Name',
    timestamp: '1h',
    content: ['Another reply placeholder is still loading'],
    metricWidth: spacing.xl,
  },
  {
    author: 'A Medium Author',
    timestamp: '5h',
    content: ['A medium-length response is still loading', 'with a compact second line'],
    metricWidth: spacing.md,
  },
  {
    author: 'Name',
    timestamp: 'now',
    content: ['Compact reply loading'],
    metricWidth: spacing.md,
  },
  {
    author: 'Casual Username',
    timestamp: '3d',
    content: ['Yet another reply is loading'],
    metricWidth: spacing['2xl'],
  },
] as const;

export const TARGET_SKELETON_VARIANT = {
  author: 'Display Name',
  npub: 'npub1skeleton...',
  date: 'May 16, 2026 at 12:00',
  content: [
    'This thread post is loading with the same content measure',
    'as a real post body in the detail view',
  ],
  metricWidth: spacing.xl,
} as const;

export type ReplySkeletonMatch = {
  eventId: string;
  originalIndex: number;
  sortedIndex: number;
  skeletonIndex: number | null;
  skeletonLineCount: number | null;
  estimatedLineCount: number;
  lineDelta: number | null;
  score: number | null;
  contentLength: number;
  contentPreview: string;
};

export type ReplySkeletonSortResult = {
  replies: FeedEvent[];
  matches: ReplySkeletonMatch[];
};

const REPLY_GUTTER_OFFSET = 76;
const AVG_CHAR_WIDTH_PX = 9.6;
const FALLBACK_REPLY_WIDTH_PX = 390;
const EMOJI_OR_QUOTED_REGEX = /\p{Extended_Pictographic}|nostr:(?:npub|nprofile|note|nevent)1\w+/gu;

export function charsPerLineForWidth(viewportWidth: number): number {
  const widthForContent = Math.max(0, viewportWidth - REPLY_GUTTER_OFFSET);
  if (widthForContent <= 0) return 32;
  return Math.max(20, Math.round(widthForContent / AVG_CHAR_WIDTH_PX));
}

function effectiveContentLength(content: string): number {
  const replaced = content.replace(/https?:\/\/\S+/g, '            ');
  const emojiOrMentionCount = (replaced.match(EMOJI_OR_QUOTED_REGEX) ?? []).length;
  const stripped = replaced.replace(EMOJI_OR_QUOTED_REGEX, '');
  return stripped.length + emojiOrMentionCount * 3;
}

export function estimateReplyLineCount(content: string, charsPerLine?: number): number {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return 1;

  const perLine = charsPerLine ?? charsPerLineForWidth(FALLBACK_REPLY_WIDTH_PX);
  const explicitLineCount = content.split(/\n+/).filter((line) => line.trim().length > 0).length;
  const wrappedLineCount = Math.ceil(effectiveContentLength(content) / perLine);
  return Math.max(
    1,
    Math.min(MAX_REPLY_SKELETON_COUNT, Math.max(explicitLineCount, wrappedLineCount))
  );
}

function contentPreview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 80) return normalized;
  return `${normalized.slice(0, 79)}…`;
}

function buildMatch(params: {
  event: FeedEvent;
  originalIndex: number;
  sortedIndex: number;
  skeletonIndex: number | null;
  estimatedLineCount: number;
  score: number | null;
}): ReplySkeletonMatch {
  const skeletonLineCount =
    params.skeletonIndex == null
      ? null
      : REPLY_SKELETON_VARIANTS[params.skeletonIndex % REPLY_SKELETON_VARIANTS.length].content
          .length;
  return {
    eventId: params.event.id,
    originalIndex: params.originalIndex,
    sortedIndex: params.sortedIndex,
    skeletonIndex: params.skeletonIndex,
    skeletonLineCount,
    estimatedLineCount: params.estimatedLineCount,
    lineDelta: skeletonLineCount == null ? null : params.estimatedLineCount - skeletonLineCount,
    score: params.score,
    contentLength: params.event.content.length,
    contentPreview: contentPreview(params.event.content),
  };
}

export function sortRepliesForSkeletons(
  replies: readonly FeedEvent[],
  skeletonCount: number,
  charsPerLine?: number
): ReplySkeletonSortResult {
  const matchCount = Math.min(MAX_REPLY_SKELETON_COUNT, skeletonCount, replies.length);
  if (matchCount <= 1) {
    const passthroughMatches = replies.map((event, originalIndex) =>
      buildMatch({
        event,
        originalIndex,
        sortedIndex: originalIndex,
        skeletonIndex: originalIndex < matchCount ? originalIndex : null,
        estimatedLineCount: estimateReplyLineCount(event.content, charsPerLine),
        score: originalIndex < matchCount ? 0 : null,
      })
    );
    return { replies: [...replies], matches: passthroughMatches };
  }

  const candidateCount = replies.length;
  const pool = replies.slice(0, candidateCount).map((event, originalIndex) => ({
    event,
    originalIndex,
    lineCount: estimateReplyLineCount(event.content, charsPerLine),
  }));
  const selected: {
    event: FeedEvent;
    originalIndex: number;
    estimatedLineCount: number;
    skeletonIndex: number;
    score: number;
  }[] = [];

  for (let slot = 0; slot < matchCount; slot += 1) {
    const targetLineCount =
      REPLY_SKELETON_VARIANTS[slot % REPLY_SKELETON_VARIANTS.length].content.length;
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let candidateIndex = 0; candidateIndex < pool.length; candidateIndex += 1) {
      const candidate = pool[candidateIndex];
      const score = Math.abs(candidate.lineCount - targetLineCount) * 100 + candidate.originalIndex;
      if (score < bestScore) {
        bestIndex = candidateIndex;
        bestScore = score;
      }
    }

    const [best] = pool.splice(bestIndex, 1);
    selected.push({
      event: best.event,
      originalIndex: best.originalIndex,
      estimatedLineCount: best.lineCount,
      skeletonIndex: slot,
      score: bestScore,
    });
  }

  pool.sort((a, b) => a.originalIndex - b.originalIndex);
  const ordered = [
    ...selected,
    ...pool.map((candidate) => ({
      event: candidate.event,
      originalIndex: candidate.originalIndex,
      estimatedLineCount: candidate.lineCount,
      skeletonIndex: null,
      score: null,
    })),
    ...replies.slice(candidateCount).map((event, index) => ({
      event,
      originalIndex: candidateCount + index,
      estimatedLineCount: estimateReplyLineCount(event.content),
      skeletonIndex: null,
      score: null,
    })),
  ];

  return {
    replies: ordered.map((entry) => entry.event),
    matches: ordered.map((entry, sortedIndex) =>
      buildMatch({
        event: entry.event,
        originalIndex: entry.originalIndex,
        sortedIndex,
        skeletonIndex: entry.skeletonIndex,
        estimatedLineCount: entry.estimatedLineCount,
        score: entry.score,
      })
    ),
  };
}

export function softSortRepliesForSkeletons(
  replies: readonly FeedEvent[],
  skeletonCount: number,
  charsPerLine?: number
): FeedEvent[] {
  return sortRepliesForSkeletons(replies, skeletonCount, charsPerLine).replies;
}
