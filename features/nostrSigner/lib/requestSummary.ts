/**
 * @fileoverview Human-readable NIP-46 request summaries
 *
 * Pure translation from a request's safe preview (`Nip46ParamsPreview`) to a
 * structured summary the UI can render: a headline ("Like a Post"), a body
 * builder (same segment contract as the permission catalog), a typed `detail`
 * the approval sheet switches preview cards on, the referenced ids the UI may
 * fetch previews for, risk flags, and a short plain line for activity rows.
 *
 * `headline`/`body` are undefined for `detail.type 'generic'` — the catalog
 * entry renders verbatim, so every method/kind stays total. No React, no IO:
 * the engine imports this for activity logging and the sheet for rendering.
 * Every string derived from request params passes `boundDisplay`; nothing
 * here is ever logged.
 */

import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';
import { z } from 'zod';

import { appDataOperationFor } from './appDataOps';
import { boundDisplay, MAX_CONTEXT_LABEL_DISPLAY } from './boundedDisplay';
import { safeJsonParse } from './json';
import type { Nip46Method, UnsignedEvent } from './nip46Types';
import type { Nip46ParamsPreview } from '@/features/nostrSigner/data/nip46RequestsStore';

// ── Output contract ─────────────────────────────────────────────

/** Structurally identical to the catalog's CopySegment/PermissionCopyContext. */
export interface SummaryCopySegment {
  text: string;
  bold?: boolean;
}
export interface SummaryCopyContext {
  appName: string;
  peerLabel?: string;
  relayLabel?: string;
}

export type SummaryRisk =
  | 'never_sign_anomaly'
  | 'financial'
  | 'wallet_credential'
  | 'full_list_replace';

export type SummaryReaction =
  | { kind: 'like' }
  | { kind: 'dislike' }
  | { kind: 'emoji'; emoji: string };

export type SummaryDetail =
  | { type: 'post'; text: string }
  | { type: 'reply'; parentEventId: string; text: string }
  | { type: 'quote'; quotedEventId: string; text: string }
  | {
      type: 'react';
      reaction: SummaryReaction;
      targetEventId?: string;
      targetAuthorPubkey?: string;
    }
  | {
      type: 'repost';
      targetEventId?: string;
      embedded?: { id?: string; pubkey: string; text: string };
    }
  | {
      type: 'follow_diff';
      added: string[];
      removed: string[];
      addedCount: number;
      removedCount: number;
      total: number;
      baseline: 'available' | 'unavailable';
    }
  | { type: 'app_data'; operationLine: string }
  | { type: 'zap_request'; amountSats?: number; recipientPubkey?: string }
  | { type: 'delete'; targetEventIds: string[]; targetAddresses: string[] }
  | { type: 'login'; target?: string }
  | { type: 'article'; title?: string }
  | { type: 'anomaly'; kind: number }
  | { type: 'encrypt'; peerPubkey: string; plaintext: string }
  | { type: 'decrypt'; peerPubkey: string; ciphertextLength: number }
  | { type: 'generic' };

export interface RequestSummary {
  /** Overrides the catalog headline; undefined → catalog entry verbatim. */
  headline?: string;
  /** Overrides the catalog body; undefined → catalog entry verbatim. */
  body?: (ctx: SummaryCopyContext) => SummaryCopySegment[];
  detail: SummaryDetail;
  /** What the UI may fetch previews for. Bounded: ≤1 note, ≤10 pubkeys. */
  referenced: { noteIds: string[]; pubkeys: string[] };
  riskFlags: SummaryRisk[];
  /** Plain, bounded line for activity rows / queue subtitles. */
  activityLine: string;
}

export interface SummarizeRequestInput {
  method: Nip46Method;
  kind?: number;
  preview: Nip46ParamsPreview;
}

export interface SummarizeRequestContext {
  /**
   * The user's CURRENT follow set, for the kind-3 diff. Callers must only
   * pass this when the baseline belongs to the signing identity (the sheet
   * guards on active-profile === signer pubkey); omit to fall back to the
   * count-only "replaces your entire list" presentation.
   */
  currentFollows?: ReadonlySet<string>;
  /**
   * The signing identity's pubkey. When present, a peer≠self decrypt gets
   * conversation-flavored copy whose body trails into the peer card ("wants
   * to decrypt your conversation with:") instead of naming the peer inline —
   * the card names them once. Omitted (engine/activity paths) → generic copy.
   */
  selfPubkey?: string;
}

// ── Bounds ──────────────────────────────────────────────────────

const SUMMARY_TEXT_MAX = 300;
const ACTIVITY_LINE_MAX = 120;
const EMOJI_MAX = 8;
const FOLLOW_DIFF_DISPLAY_CAP = 10;
const REFERENCED_PUBKEY_CAP = 10;
const DELETE_TARGET_CAP = 10;
const MAX_ZAP_AMOUNT_MSATS = 1_000_000_000_000_000; // 1B sats — reject absurd values

// ── Tag helpers ─────────────────────────────────────────────────

type Tags = UnsignedEvent['tags'];

function tagValuesHex(tags: Tags, name: string): string[] {
  const values: string[] = [];
  for (const tag of tags) {
    if (tag[0] === name && isNostrPubkeyHex(tag[1])) values.push(tag[1].toLowerCase());
  }
  return values;
}

function firstTagValue(tags: Tags, name: string): string | undefined {
  for (const tag of tags) {
    if (tag[0] === name && typeof tag[1] === 'string' && tag[1].length > 0) return tag[1];
  }
  return undefined;
}

/**
 * NIP-10 parent resolution for kind 1/1111. Marked scheme first (`reply`
 * beats `root`; a lone `root` means a top-level reply to the root), then the
 * deprecated positional scheme (last unmarked `e` tag). `mention`-marked tags
 * never make a reply.
 */
function nip10ParentId(tags: Tags): string | undefined {
  let replyId: string | undefined;
  let rootId: string | undefined;
  let lastUnmarked: string | undefined;
  for (const tag of tags) {
    if (tag[0] !== 'e' || !isNostrPubkeyHex(tag[1])) continue;
    const marker = tag[3];
    if (marker === 'reply') replyId = tag[1].toLowerCase();
    else if (marker === 'root') rootId = tag[1].toLowerCase();
    else if (marker !== 'mention') lastUnmarked = tag[1].toLowerCase();
  }
  return replyId ?? rootId ?? lastUnmarked;
}

// ── Body building ───────────────────────────────────────────────

function appBody(suffix: string): (ctx: SummaryCopyContext) => SummaryCopySegment[] {
  return (ctx) => [{ text: ctx.appName, bold: true }, { text: suffix }];
}

interface Built {
  headline: string;
  bodySuffix: string;
  detail: SummaryDetail;
  referenced?: { noteIds?: string[]; pubkeys?: string[] };
  riskFlags?: SummaryRisk[];
  activityLine: string;
}

function toSummary(built: Built): RequestSummary {
  return {
    headline: built.headline,
    body: appBody(built.bodySuffix),
    detail: built.detail,
    referenced: {
      noteIds: built.referenced?.noteIds?.slice(0, 1) ?? [],
      pubkeys: built.referenced?.pubkeys?.slice(0, REFERENCED_PUBKEY_CAP) ?? [],
    },
    riskFlags: built.riskFlags ?? [],
    activityLine: boundDisplay(built.activityLine, ACTIVITY_LINE_MAX),
  };
}

const GENERIC: RequestSummary = {
  detail: { type: 'generic' },
  referenced: { noteIds: [], pubkeys: [] },
  riskFlags: [],
  activityLine: '',
};

// ── Per-kind builders ───────────────────────────────────────────

function summarizeNote(event: UnsignedEvent): RequestSummary {
  const text = boundDisplay(event.content.trim(), SUMMARY_TEXT_MAX);
  const parentId = nip10ParentId(event.tags);
  if (parentId !== undefined) {
    return toSummary({
      headline: 'Reply to a Post',
      bodySuffix: ' wants to publish this reply as you.',
      detail: { type: 'reply', parentEventId: parentId, text },
      referenced: { noteIds: [parentId] },
      activityLine: 'Replied to a post',
    });
  }
  const quotedId = firstTagValue(event.tags, 'q');
  if (quotedId !== undefined && isNostrPubkeyHex(quotedId)) {
    return toSummary({
      headline: 'Quote a Post',
      bodySuffix: ' wants to quote a post as you.',
      detail: { type: 'quote', quotedEventId: quotedId.toLowerCase(), text },
      referenced: { noteIds: [quotedId.toLowerCase()] },
      activityLine: 'Quoted a post',
    });
  }
  return toSummary({
    headline: 'Publish a Post',
    bodySuffix: ' wants to publish this post as you.',
    detail: { type: 'post', text },
    activityLine: 'Published a post',
  });
}

function summarizeReaction(event: UnsignedEvent): RequestSummary {
  const content = event.content.trim();
  const reaction: SummaryReaction =
    content === '' || content === '+'
      ? { kind: 'like' }
      : content === '-'
        ? { kind: 'dislike' }
        : { kind: 'emoji', emoji: boundDisplay(content, EMOJI_MAX) };
  const eTags = tagValuesHex(event.tags, 'e');
  const pTags = tagValuesHex(event.tags, 'p');
  // NIP-25: the LAST e/p tags are the reacted event and its author.
  const targetEventId = eTags[eTags.length - 1];
  const targetAuthorPubkey = pTags[pTags.length - 1];
  const verb =
    reaction.kind === 'like'
      ? 'like'
      : reaction.kind === 'dislike'
        ? 'dislike'
        : `react ${reaction.emoji} to`;
  return toSummary({
    headline:
      reaction.kind === 'like'
        ? 'Like a Post'
        : reaction.kind === 'dislike'
          ? 'Dislike a Post'
          : 'React to a Post',
    bodySuffix: ` wants to ${verb} a post as you.`,
    detail: {
      type: 'react',
      reaction,
      ...(targetEventId !== undefined && { targetEventId }),
      ...(targetAuthorPubkey !== undefined && { targetAuthorPubkey }),
    },
    referenced: {
      ...(targetEventId !== undefined && { noteIds: [targetEventId] }),
      ...(targetAuthorPubkey !== undefined && { pubkeys: [targetAuthorPubkey] }),
    },
    activityLine:
      reaction.kind === 'like'
        ? 'Liked a post'
        : reaction.kind === 'dislike'
          ? 'Disliked a post'
          : `Reacted ${reaction.emoji} to a post`,
  });
}

const EmbeddedNoteSchema = z.looseObject({
  id: z.string().optional(),
  pubkey: z.string(),
  content: z.string(),
});

function summarizeRepost(event: UnsignedEvent): RequestSummary {
  // Kind 6 content SHOULD be the stringified reposted event — render it
  // directly when it parses; otherwise fall back to fetching the e tag.
  let embedded: { id?: string; pubkey: string; text: string } | undefined;
  const parsed = safeJsonParse(event.content);
  if (parsed.isOk()) {
    const note = EmbeddedNoteSchema.safeParse(parsed.value);
    if (note.success && isNostrPubkeyHex(note.data.pubkey)) {
      embedded = {
        ...(isNostrPubkeyHex(note.data.id) && { id: note.data.id.toLowerCase() }),
        pubkey: note.data.pubkey.toLowerCase(),
        text: boundDisplay(note.data.content.trim(), SUMMARY_TEXT_MAX),
      };
    }
  }
  const targetEventId = embedded?.id ?? tagValuesHex(event.tags, 'e')[0];
  return toSummary({
    headline: 'Repost a Note',
    bodySuffix: ' wants to repost this note as you.',
    detail: {
      type: 'repost',
      ...(targetEventId !== undefined && { targetEventId }),
      ...(embedded !== undefined && { embedded }),
    },
    referenced: {
      // Embedded content renders instantly — only fetch when we lack it.
      ...(embedded === undefined && targetEventId !== undefined && { noteIds: [targetEventId] }),
      ...(embedded !== undefined && { pubkeys: [embedded.pubkey] }),
    },
    activityLine: 'Reposted a note',
  });
}

function summarizeFollows(
  event: UnsignedEvent,
  currentFollows: ReadonlySet<string> | undefined
): RequestSummary {
  const next = new Set(tagValuesHex(event.tags, 'p'));
  if (currentFollows === undefined) {
    return toSummary({
      headline: 'Change Your Follows',
      bodySuffix: ` wants to replace your entire follow list with ${next.size} accounts.`,
      detail: {
        type: 'follow_diff',
        added: [],
        removed: [],
        addedCount: 0,
        removedCount: 0,
        total: next.size,
        baseline: 'unavailable',
      },
      riskFlags: ['full_list_replace'],
      activityLine: `Updated your follow list (${next.size} accounts)`,
    });
  }
  const added: string[] = [];
  for (const pubkey of next) {
    if (!currentFollows.has(pubkey)) added.push(pubkey);
  }
  const removed: string[] = [];
  for (const pubkey of currentFollows) {
    if (!next.has(pubkey)) removed.push(pubkey);
  }
  const headline =
    added.length === 1 && removed.length === 0
      ? 'Follow a New Account'
      : added.length === 0 && removed.length === 1
        ? 'Unfollow an Account'
        : 'Change Your Follows';
  const bodySuffix =
    added.length === 1 && removed.length === 0
      ? ' wants to follow a new account as you.'
      : added.length === 0 && removed.length === 1
        ? ' wants to unfollow an account as you.'
        : ` wants to update who you follow (+${added.length} / −${removed.length}).`;
  const activityLine =
    added.length === 1 && removed.length === 0
      ? 'Followed a new account'
      : added.length === 0 && removed.length === 1
        ? 'Unfollowed an account'
        : `Updated your follows (+${added.length} / −${removed.length})`;
  return toSummary({
    headline,
    bodySuffix,
    detail: {
      type: 'follow_diff',
      added: added.slice(0, FOLLOW_DIFF_DISPLAY_CAP),
      removed: removed.slice(0, FOLLOW_DIFF_DISPLAY_CAP),
      addedCount: added.length,
      removedCount: removed.length,
      total: next.size,
      baseline: 'available',
    },
    referenced: { pubkeys: [...added, ...removed] },
    activityLine,
  });
}

function summarizeAppData(event: UnsignedEvent): RequestSummary {
  const operation = appDataOperationFor(event.tags, event.content);
  const operationLine = `${operation.verbPhrase.charAt(0).toUpperCase()}${operation.verbPhrase.slice(1)}`;
  return toSummary({
    headline: operation.headline,
    bodySuffix: ` wants to ${operation.verbPhrase}.`,
    detail: { type: 'app_data', operationLine },
    riskFlags: operation.risk === 'wallet_credential' ? ['wallet_credential'] : [],
    activityLine: operationLine,
  });
}

function summarizeZapRequest(event: UnsignedEvent): RequestSummary {
  const rawAmount = firstTagValue(event.tags, 'amount');
  const msats = rawAmount !== undefined ? Number(rawAmount) : NaN;
  const amountSats =
    Number.isInteger(msats) && msats > 0 && msats <= MAX_ZAP_AMOUNT_MSATS
      ? Math.floor(msats / 1000)
      : undefined;
  const recipientPubkey = tagValuesHex(event.tags, 'p')[0];
  const amountLabel = amountSats !== undefined ? `${amountSats} sats` : 'an unspecified amount';
  return toSummary({
    headline: 'Approve a Zap Request',
    bodySuffix: ` wants to request a zap of ${amountLabel}. Payment still happens in your lightning wallet.`,
    detail: {
      type: 'zap_request',
      ...(amountSats !== undefined && { amountSats }),
      ...(recipientPubkey !== undefined && { recipientPubkey }),
    },
    referenced: { ...(recipientPubkey !== undefined && { pubkeys: [recipientPubkey] }) },
    riskFlags: ['financial'],
    activityLine:
      amountSats !== undefined ? `Requested a ${amountSats} sat zap` : 'Requested a zap',
  });
}

function summarizeDelete(event: UnsignedEvent): RequestSummary {
  const targetEventIds = tagValuesHex(event.tags, 'e').slice(0, DELETE_TARGET_CAP);
  const targetAddresses: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] === 'a' && typeof tag[1] === 'string' && tag[1].length > 0) {
      targetAddresses.push(boundDisplay(tag[1], MAX_CONTEXT_LABEL_DISPLAY));
      if (targetAddresses.length >= DELETE_TARGET_CAP) break;
    }
  }
  const count = targetEventIds.length + targetAddresses.length;
  return toSummary({
    headline: 'Delete Your Content',
    bodySuffix: ` wants to permanently request deletion of ${count === 1 ? 'one of your events' : `${count} of your events`}.`,
    detail: { type: 'delete', targetEventIds, targetAddresses },
    activityLine:
      count === 1 ? 'Requested deletion of an event' : `Requested deletion of ${count} events`,
  });
}

function summarizeLogin(event: UnsignedEvent): RequestSummary {
  // 22242 names the relay in a `relay` tag; 27235 names the URL in `u`.
  const target = firstTagValue(event.tags, 'relay') ?? firstTagValue(event.tags, 'u');
  return {
    ...toSummary({
      headline: 'Log In to a Service',
      bodySuffix: '', // catalog body (relayLabel-aware) is better — keep it
      detail: { type: 'login', ...(target !== undefined && { target }) },
      activityLine:
        target !== undefined
          ? `Logged in to ${boundDisplay(target, MAX_CONTEXT_LABEL_DISPLAY)}`
          : 'Logged in to a service',
    }),
    body: undefined,
  };
}

function summarizeArticle(event: UnsignedEvent): RequestSummary {
  const title = firstTagValue(event.tags, 'title');
  return toSummary({
    headline: 'Publish an Article',
    bodySuffix:
      title !== undefined
        ? ` wants to publish the article "${boundDisplay(title, MAX_CONTEXT_LABEL_DISPLAY)}" as you.`
        : ' wants to publish a long-form article as you.',
    detail: {
      type: 'article',
      ...(title !== undefined && { title: boundDisplay(title, MAX_CONTEXT_LABEL_DISPLAY) }),
    },
    activityLine:
      title !== undefined
        ? `Published article "${boundDisplay(title, MAX_CONTEXT_LABEL_DISPLAY)}"`
        : 'Published an article',
  });
}

/**
 * Kinds a client should NEVER hand a user's signer: kind 14/15 NIP-17 rumors
 * MUST stay unsigned (a signature turns a deniable DM into provable speech),
 * kind 1059 gift wraps are signed by ephemeral throwaway keys, and 9735 /
 * 13194 / 23195 are service-side events. A request for one is a red flag.
 */
const ANOMALY_KINDS = new Set([14, 15, 1059, 9735, 13194, 23195]);

function summarizeAnomaly(kind: number): RequestSummary {
  return toSummary({
    headline: 'Unusual Signing Request',
    bodySuffix: ` wants to sign an event (kind ${kind}) that apps should never ask your key to sign.`,
    detail: { type: 'anomaly', kind },
    riskFlags: ['never_sign_anomaly'],
    activityLine: `Asked to sign an unusual event (kind ${kind})`,
  });
}

const SIMPLE_KIND_LINES: Record<number, { headline?: string; activityLine: string }> = {
  0: { activityLine: 'Updated your profile' },
  4: { activityLine: 'Signed a private message' },
  13: { activityLine: 'Signed a private message' },
  10000: { headline: 'Update Your Mute List', activityLine: 'Updated your mute list' },
  10002: { activityLine: 'Updated your relay list' },
  1984: { headline: 'Report Content', activityLine: 'Reported content' },
  30000: { headline: 'Update a List', activityLine: 'Updated a people list' },
};

function summarizeSignEvent(
  kind: number | undefined,
  event: UnsignedEvent,
  context: SummarizeRequestContext
): RequestSummary {
  if (kind === undefined) return GENERIC;
  if (ANOMALY_KINDS.has(kind)) return summarizeAnomaly(kind);
  switch (kind) {
    case 1:
    case 1111:
      return summarizeNote(event);
    case 7:
      return summarizeReaction(event);
    case 6:
    case 16:
      return summarizeRepost(event);
    case 3:
      return summarizeFollows(event, context.currentFollows);
    case 30078:
      return summarizeAppData(event);
    case 9734:
      return summarizeZapRequest(event);
    case 5:
      return summarizeDelete(event);
    case 22242:
    case 27235:
      return summarizeLogin(event);
    case 30023:
      return summarizeArticle(event);
    default: {
      const simple = SIMPLE_KIND_LINES[kind];
      if (simple === undefined) return GENERIC;
      return {
        ...GENERIC,
        ...(simple.headline !== undefined && { headline: simple.headline }),
        activityLine: simple.activityLine,
      };
    }
  }
}

// ── Entry point ─────────────────────────────────────────────────

export function summarizeRequest(
  input: SummarizeRequestInput,
  context: SummarizeRequestContext = {}
): RequestSummary {
  const { preview } = input;
  switch (preview.type) {
    case 'sign_event':
      return summarizeSignEvent(input.kind ?? preview.event.kind, preview.event, context);
    case 'encrypt':
      return {
        ...GENERIC,
        detail: { type: 'encrypt', peerPubkey: preview.peerPubkey, plaintext: preview.plaintext },
        referenced: { noteIds: [], pubkeys: [preview.peerPubkey] },
        activityLine: 'Encrypted a message',
      };
    case 'decrypt': {
      const isPeerDecrypt =
        context.selfPubkey !== undefined &&
        preview.peerPubkey.toLowerCase() !== context.selfPubkey.toLowerCase();
      return {
        ...GENERIC,
        ...(isPeerDecrypt && { headline: 'Read a Conversation' }),
        body: isPeerDecrypt
          ? (ctx) => [
              { text: ctx.appName, bold: true },
              { text: ' wants to decrypt your conversation with:' },
            ]
          : (ctx) => [
              { text: ctx.appName, bold: true },
              {
                text: ` wants to read your encrypted conversation with ${ctx.peerLabel ?? 'another user'}.`,
              },
            ],
        detail: {
          type: 'decrypt',
          peerPubkey: preview.peerPubkey,
          ciphertextLength: preview.ciphertextLength,
        },
        referenced: { noteIds: [], pubkeys: [preview.peerPubkey] },
        activityLine: 'Read encrypted data',
      };
    }
    case 'none':
      return GENERIC;
  }
}
