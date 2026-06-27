import { z } from 'zod';

export const NaggNoteMetrics = z
  .object({
    likeCount: z.number().int().nonnegative(),
    repostCount: z.number().int().nonnegative(),
    replyCount: z.number().int().nonnegative(),
    satsZapped: z.number().int().nonnegative(),
  })
  .passthrough();

export const NaggFeedEvent = z
  .object({
    id: z.string().min(1),
    kind: z.number().int(),
    pubkey: z.string().min(1),
    content: z.string(),
    tags: z.array(z.array(z.string())),
    created_at: z.number().int().nonnegative(),
  })
  .passthrough();

export const NaggProfileInfo = z
  .object({
    name: z.string(),
    picture: z.string().optional(),
  })
  .passthrough();

const NaggNoteItem = z
  .object({
    type: z.literal('note'),
    event: NaggFeedEvent,
    rootEvent: NaggFeedEvent.nullable().optional(),
    rootEventId: z.string().min(1).optional(),
    replyPreviewEvents: z.array(NaggFeedEvent).optional(),
  })
  .passthrough();

const NaggRepostItem = z
  .object({
    type: z.literal('repost'),
    repostEvent: NaggFeedEvent,
    originalEvent: NaggFeedEvent.nullable().optional(),
    originalEventId: z.string().min(1).optional(),
    rootEvent: NaggFeedEvent.nullable().optional(),
    rootEventId: z.string().min(1).optional(),
    reposters: z
      .array(
        z
          .object({
            pubkey: z.string().min(1),
            event: NaggFeedEvent,
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

export const NaggFeedItem = z.discriminatedUnion('type', [NaggNoteItem, NaggRepostItem]);

export const NaggFeedResponse = z
  .object({
    items: z.array(NaggFeedItem),
    metrics: z.record(z.string(), NaggNoteMetrics),
    profiles: z.record(z.string(), NaggProfileInfo),
    quoted: z.record(z.string(), NaggFeedEvent),
    paginationUntil: z.number().int().nonnegative(),
    paginationOffset: z.number().int().nonnegative(),
  })
  .passthrough();

export const NaggEnrichmentResponse = z
  .object({
    metrics: z.record(z.string(), NaggNoteMetrics).default({}),
    profiles: z.record(z.string(), NaggProfileInfo).default({}),
    quoted: z.record(z.string(), NaggFeedEvent).default({}),
  })
  .passthrough();

export const NaggThreadResponse = z
  .object({
    root: NaggFeedEvent.nullable().optional(),
    events: z.array(NaggFeedEvent).default([]),
    metrics: z.record(z.string(), NaggNoteMetrics).default({}),
    profiles: z.record(z.string(), NaggProfileInfo).default({}),
    quoted: z.record(z.string(), NaggFeedEvent).default({}),
  })
  .passthrough();

export type NaggFeedResponseData = z.infer<typeof NaggFeedResponse>;
export type NaggEnrichmentResponseData = z.infer<typeof NaggEnrichmentResponse>;
export type NaggThreadResponseData = z.infer<typeof NaggThreadResponse>;
