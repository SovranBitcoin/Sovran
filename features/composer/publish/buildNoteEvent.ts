/**
 * @fileoverview Serializes the composer's block model into an unsigned kind:1.
 *
 * Walks blocks in order, emitting text runs and media urls inline at their
 * position (so the feed's positional parser renders them where the author put
 * them), and attaches one NIP-92 `imeta` tag per media block. Adds NIP-10
 * reply/root markers, quote (`q`) tags + an inline `nostr:nevent…`, mention
 * `p` tags, and a NIP-36 content-warning. Pure + unit-tested.
 */
import { buildImetaTag } from '@/shared/lib/nostr/media/imeta';
import type { ComposerBlock } from '@/features/composer/config/types';

export type ComposerTarget =
  | { mode: 'new' }
  | {
      mode: 'reply';
      parentId: string;
      parentPubkey: string;
      parentPTags?: readonly string[];
      rootId?: string;
      relayHint?: string;
    }
  | {
      mode: 'quote';
      quotedId: string;
      quotedPubkey: string;
      quotedNevent?: string;
      relayHint?: string;
    };

export interface BuildNoteInput {
  blocks: readonly ComposerBlock[];
  target: ComposerTarget;
  mentionPubkeys?: readonly string[];
  /** Explicit content-warning reason. Empty string = warning with no reason. */
  contentWarning?: string;
  createdAt?: number;
}

export interface UnsignedNote {
  kind: 1;
  content: string;
  created_at: number;
  tags: string[][];
}

/** Builds the unsigned kind:1 note from the composer state. */
export function buildNoteEvent(input: BuildNoteInput): UnsignedNote {
  const { blocks, target } = input;

  // ── content: text runs + inline media urls, in block order ──
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.kind === 'text') {
      if (block.text.trim().length > 0) parts.push(block.text);
    } else if (block.descriptor?.url) {
      parts.push(block.descriptor.url);
    }
  }
  let content = parts.join('\n');
  if (target.mode === 'quote' && target.quotedNevent) {
    const ref = `nostr:${target.quotedNevent}`;
    content = content.length > 0 ? `${content}\n\n${ref}` : ref;
  }

  // ── tags ──
  const tags: string[][] = [];
  for (const block of blocks) {
    if (block.kind === 'media' && block.descriptor) {
      tags.push(buildImetaTag({ ...block.descriptor, alt: block.alt ?? block.descriptor.alt }));
    }
  }

  const pSet = new Set<string>();
  if (target.mode === 'reply') {
    const hint = target.relayHint ?? '';
    if (target.rootId && target.rootId !== target.parentId) {
      tags.push(['e', target.rootId, hint, 'root']);
      tags.push(['e', target.parentId, hint, 'reply']);
    } else {
      tags.push(['e', target.parentId, hint, 'root']);
    }
    for (const p of target.parentPTags ?? []) pSet.add(p);
    pSet.add(target.parentPubkey);
  } else if (target.mode === 'quote') {
    tags.push(['q', target.quotedId, target.relayHint ?? '', target.quotedPubkey]);
    pSet.add(target.quotedPubkey);
  }
  for (const pubkey of input.mentionPubkeys ?? []) pSet.add(pubkey);
  for (const pubkey of pSet) tags.push(['p', pubkey]);

  const hasSensitive = blocks.some((b) => b.kind === 'media' && b.sensitive);
  if (input.contentWarning !== undefined) {
    tags.push(
      input.contentWarning ? ['content-warning', input.contentWarning] : ['content-warning']
    );
  } else if (hasSensitive) {
    tags.push(['content-warning']);
  }

  return {
    kind: 1,
    content,
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
  };
}
