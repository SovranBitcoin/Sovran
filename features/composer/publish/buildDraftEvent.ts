/**
 * @fileoverview NIP-37 draft event (kind:31234) construction — pure.
 *
 * A draft wraps the unsigned event the user is composing: its `content` is the
 * NIP-44-self-encrypted JSON of that target event, and tags carry a stable `d`
 * identifier + the drafted `k`ind (so the client can list/replace drafts).
 * Deleting a draft publishes the same `d` with empty content. The encryption
 * itself happens in the draft store (it needs the signer); this module builds
 * the wrapper shape and serializes the target — both unit-testable.
 */

/** NIP-37 draft event kind (parameterized replaceable). */
export const DRAFT_KIND = 31234;

interface UnsignedTargetEvent {
  kind: number;
  content: string;
  created_at: number;
  tags: string[][];
}

interface UnsignedDraftEvent {
  kind: number;
  content: string;
  created_at: number;
  tags: string[][];
}

/** The plaintext (pre-encryption) payload for a draft: the serialized target. */
export function serializeDraftTarget(target: UnsignedTargetEvent): string {
  return JSON.stringify(target);
}

/** Parses a decrypted draft payload back into the target event (null on error). */
export function parseDraftTarget(plaintext: string): UnsignedTargetEvent | null {
  try {
    const raw = JSON.parse(plaintext) as Record<string, unknown>;
    if (typeof raw.kind !== 'number' || typeof raw.content !== 'string') return null;
    return {
      kind: raw.kind,
      content: raw.content,
      created_at: typeof raw.created_at === 'number' ? raw.created_at : 0,
      tags: Array.isArray(raw.tags) ? (raw.tags as string[][]) : [],
    };
  } catch {
    return null;
  }
}

/**
 * Builds the unsigned kind:31234 draft wrapper. `encryptedContent` is the
 * NIP-44-self-encrypted {@link serializeDraftTarget} output (or '' to delete).
 */
export function buildDraftEvent(opts: {
  draftId: string;
  draftedKind: number;
  encryptedContent: string;
  anchors?: string[][];
  createdAt?: number;
}): UnsignedDraftEvent {
  const tags: string[][] = [
    ['d', opts.draftId],
    ['k', String(opts.draftedKind)],
    ...(opts.anchors ?? []),
  ];
  return {
    kind: DRAFT_KIND,
    content: opts.encryptedContent,
    created_at: opts.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
  };
}

/** Builds the deletion form of a draft (same `d`, empty content). */
export function buildDraftDeletion(
  draftId: string,
  draftedKind: number,
  createdAt?: number
): UnsignedDraftEvent {
  return buildDraftEvent({ draftId, draftedKind, encryptedContent: '', createdAt });
}
