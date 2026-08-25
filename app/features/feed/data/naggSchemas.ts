import { z } from 'zod';

const NaggNoteMetrics = z.looseObject({
  likeCount: z.number().int().nonnegative(),
  repostCount: z.number().int().nonnegative(),
  replyCount: z.number().int().nonnegative(),
  satsZapped: z.number().int().nonnegative(),
});

const NaggFeedEvent = z.looseObject({
  id: z.string().min(1),
  kind: z.number().int(),
  pubkey: z.string().min(1),
  content: z.string(),
  tags: z.array(z.array(z.string())),
  created_at: z.number().int().nonnegative(),
});

const NaggProfileInfo = z.looseObject({
  name: z.string(),
  picture: z.string().optional(),
});

const NaggNoteItem = z.looseObject({
  type: z.literal('note'),
  event: NaggFeedEvent,
  rootEvent: NaggFeedEvent.nullable().optional(),
  rootEventId: z.string().min(1).optional(),
  replyPreviewEvents: z.array(NaggFeedEvent).optional(),
});

const NaggRepostItem = z.looseObject({
  type: z.literal('repost'),
  repostEvent: NaggFeedEvent,
  originalEvent: NaggFeedEvent.nullable().optional(),
  originalEventId: z.string().min(1).optional(),
  rootEvent: NaggFeedEvent.nullable().optional(),
  rootEventId: z.string().min(1).optional(),
  reposters: z
    .array(
      z.looseObject({
        pubkey: z.string().min(1),
        event: NaggFeedEvent,
      })
    )
    .optional(),
});

const NaggFeedItem = z.discriminatedUnion('type', [NaggNoteItem, NaggRepostItem]);

export const NaggFeedResponse = z.looseObject({
  items: z.array(NaggFeedItem),
  metrics: z.record(z.string(), NaggNoteMetrics),
  profiles: z.record(z.string(), NaggProfileInfo),
  quoted: z.record(z.string(), NaggFeedEvent),
  paginationUntil: z.number().int().nonnegative(),
  paginationOffset: z.number().int().nonnegative(),
});
